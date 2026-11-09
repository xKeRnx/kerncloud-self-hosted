import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { encrypt, decrypt, hashToken, redact } from "./security.ts";
import { lockTask, event } from "./store.ts";
import { saveArtifact } from "./artifacts.ts";
import { storeBinary } from "./object-storage.ts";
import { executionSignal } from "./execution-control.ts";
import {
  bridgeScope,
  bridgeScopeAllows,
  bridgeAction,
  bridgePermission,
  bridgeNeedsApproval,
  bridgeTools,
} from "../core/bridge.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const secret = () => "kcb_" + randomBytes(32).toString("hex");
const eligible = `NOT EXISTS(SELECT 1 FROM users u WHERE u.id=w.owner_id AND u.suspended) AND p.active AND p.max_customer_hosts>0 AND a.subscription_status IN('active','local_test') AND (a.access_expires_at IS NULL OR a.access_expires_at>now())`;
export async function bridgeToolsFor(c: Pick<PoolClient, "query">, task: any) {
  const found = await c.query(
    "SELECT 1 FROM bridge_devices d JOIN bridge_tokens t ON t.id=d.token_id JOIN runs r ON r.id=$2 AND r.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.enabled AND d.deleted_at IS NULL AND t.revoked_at IS NULL AND t.deleted_at IS NULL AND t.expires_at>now() AND t.scope->'project_ids' ? r.project_id AND t.scope->'agent_ids' ? $3 LIMIT 1",
    [task.workspace_id, task.run_id, task.agent_id],
  );
  return found.rowCount ? bridgeTools : [];
}
async function account(
  c: Pick<PoolClient, "query">,
  workspace: string,
  requireEligible = true,
) {
  const a = (
    await c.query(
      `SELECT a.id,p.max_customer_hosts,(${eligible}) eligible FROM workspaces w JOIN accounts a ON a.owner_id=w.owner_id JOIN plans p ON p.id=a.plan_id WHERE w.id=$1`,
      [workspace],
    )
  ).rows[0];
  if (!a || (requireEligible && !a.eligible))
    throw new HttpError(403, "Dein aktives Abo enthält keine Bridge-Geräte.");
  return a;
}
async function validateScope(
  c: PoolClient,
  w: string,
  scope: z.infer<typeof bridgeScope>,
) {
  for (const [table, ids] of [
    ["workspace_projects", scope.project_ids],
    ["agents", scope.agent_ids],
  ] as const) {
    const r = await c.query(
      `SELECT id FROM ${table} WHERE workspace_id=$1 AND id=ANY($2::text[])`,
      [w, ids],
    );
    if (r.rowCount !== new Set(ids).size)
      throw new HttpError(
        403,
        "Freigabe enthält ein fremdes oder fehlendes Projekt/Agent.",
      );
  }
}
export async function bridgeManage(actor: string, w: any, body?: unknown) {
  if (body !== undefined) {
    const b = z
      .object({
        action: z.enum([
          "create",
          "edit",
          "rotate",
          "revoke",
          "delete",
          "pause",
          "resume",
          "review",
        ]),
        job_id: z.string().uuid().optional(),
        note: z.string().trim().min(10).max(1000).optional(),
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(100).optional(),
        scope: bridgeScope.optional(),
        expires_at: z.string().datetime().optional(),
      })
      .strict()
      .parse(body);
    return transaction(async (c) => {
      const a = await account(
        c,
        w.id,
        ["create", "rotate", "resume"].includes(b.action),
      );
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
      if (b.action === "review") {
        if (!b.job_id || !b.note)
          throw new HttpError(400, "Konkrete Aktion und Prüfergebnis angeben.");
        const j = (
          await c.query(
            "SELECT j.* FROM bridge_jobs j WHERE j.id=$1 AND j.workspace_id=$2 AND j.status='uncertain' FOR UPDATE OF j",
            [b.job_id, w.id],
          )
        ).rows[0];
        if (!j) throw new HttpError(404, "Unklare Aktion fehlt.");
        const result = {
          ok: false,
          reviewed: true,
          note: redact(b.note),
          executed_again: false,
        };
        await c.query(
          "UPDATE bridge_jobs SET status='done',result=$2,finished_at=now() WHERE id=$1",
          [j.id, JSON.stringify(result)],
        );
        await c.query(
          "UPDATE operations SET status='done',result=$2,failed=true WHERE id=$1",
          [
            j.operation_id,
            JSON.stringify({
              result: JSON.stringify(result),
              yield: false,
              isError: true,
            }),
          ],
        );
        await audit(c, actor, "bridge.review", j.id);
        return { ok: true };
      }
      let row: any;
      let token: string | undefined;
      if (b.action === "create") {
        if (!b.name || !b.scope || !b.expires_at)
          throw new HttpError(400, "Name, Ablaufdatum und Freigaben angeben.");
        const n = Number(
          (
            await c.query(
              "SELECT count(*) n FROM bridge_tokens WHERE workspace_id=$1 AND deleted_at IS NULL",
              [w.id],
            )
          ).rows[0].n,
        );
        if (n >= 50)
          throw new HttpError(
            409,
            "Höchstens 50 Bridge-Token-Einträge je Workspace.",
          );
        await validateScope(c, w.id, b.scope);
        token = secret();
        row = { id: randomUUID() };
        await c.query(
          "INSERT INTO bridge_tokens(id,workspace_id,name,token_hash,scope,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            row.id,
            w.id,
            b.name,
            hashToken(token),
            JSON.stringify(b.scope),
            expiry(b.expires_at),
          ],
        );
      } else {
        row = (
          await c.query(
            "SELECT * FROM bridge_tokens WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [b.id, w.id],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, "Bridge-Token fehlt.");
        if (b.scope) await validateScope(c, w.id, b.scope);
        if (b.action === "edit") {
          await c.query(
            "UPDATE bridge_tokens SET name=$2,scope=$3,expires_at=$4 WHERE id=$1",
            [
              row.id,
              b.name ?? row.name,
              JSON.stringify(b.scope ?? row.scope),
              b.expires_at ? expiry(b.expires_at) : row.expires_at,
            ],
          );
          await c.query(
            "UPDATE bridge_devices SET name=$2,revision=revision+1 WHERE token_id=$1",
            [row.id, b.name ?? row.name],
          );
        }
        if (b.action === "rotate") {
          token = secret();
          await c.query(
            "UPDATE bridge_tokens SET token_hash=$2,used_at=NULL,revoked_at=NULL,expires_at=$3 WHERE id=$1",
            [
              row.id,
              hashToken(token),
              b.expires_at
                ? expiry(b.expires_at)
                : expiry(new Date(Date.now() + 7 * 86400000).toISOString()),
            ],
          );
          await c.query(
            "UPDATE bridge_devices SET credential_hash=$2,enabled=false,revision=revision+1 WHERE token_id=$1",
            [row.id, hashToken(secret())],
          );
        }
        if (["revoke", "delete"].includes(b.action)) {
          await c.query(
            "UPDATE bridge_tokens SET revoked_at=now(),deleted_at=CASE WHEN $2 THEN now() ELSE deleted_at END WHERE id=$1",
            [row.id, b.action === "delete"],
          );
          await c.query(
            "UPDATE bridge_devices SET enabled=false,revision=revision+1,deleted_at=CASE WHEN $2 THEN now() ELSE deleted_at END WHERE token_id=$1",
            [row.id, b.action === "delete"],
          );
        }
        if (["pause", "resume"].includes(b.action))
          await c.query(
            "UPDATE bridge_devices SET enabled=$2,revision=revision+1 WHERE token_id=$1",
            [row.id, b.action === "resume"],
          );
        await c.query(
          "UPDATE bridge_jobs SET status=CASE WHEN status='queued' THEN 'canceled' ELSE 'uncertain' END,finished_at=now() WHERE device_id IN(SELECT id FROM bridge_devices WHERE token_id=$1) AND status IN('queued','running')",
          [row.id],
        );
      }
      await audit(c, actor, "bridge." + b.action, row.id);
      return {
        ok: true,
        id: row.id,
        ...(token ? { token } : {}),
        notice: token
          ? "Einmaliger Verbindungsschlüssel. Nur direkt in der Bridge-App eingeben; nicht im Chat."
          : undefined,
      };
    });
  }
  const a = (
    await pool.query(
      `SELECT p.max_customer_hosts,(${eligible}) eligible FROM workspaces w JOIN accounts a ON a.owner_id=w.owner_id JOIN plans p ON p.id=a.plan_id WHERE w.id=$1`,
      [w.id],
    )
  ).rows[0];
  return {
    eligible: !!a?.eligible,
    limit: a?.max_customer_hosts ?? 0,
    tokens: (
      await pool.query(
        `SELECT t.id,t.name,t.scope,t.expires_at,t.created_at,t.used_at,t.revoked_at,d.id device_id,d.platform,d.enabled,d.local_paused,d.local_policy,d.last_seen FROM bridge_tokens t LEFT JOIN bridge_devices d ON d.token_id=t.id WHERE t.workspace_id=$1 AND t.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT 50`,
        [w.id],
      )
    ).rows,
    projects: (
      await pool.query(
        "SELECT id,name FROM workspace_projects WHERE workspace_id=$1 AND status='active' ORDER BY name",
        [w.id],
      )
    ).rows,
    agents: (
      await pool.query(
        "SELECT id,name FROM agents WHERE workspace_id=$1 ORDER BY name",
        [w.id],
      )
    ).rows,
    jobs: (
      await pool.query(
        "SELECT id,device_id,task_id,project_id,agent_id,action,status,created_at,finished_at FROM bridge_jobs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 50",
        [w.id],
      )
    ).rows,
  };
}
function expiry(value: string) {
  const n = Date.parse(value);
  if (n < Date.now() + 60000 || n > Date.now() + 366 * 86400000)
    throw new HttpError(
      400,
      "Ablauf zwischen einer Minute und 366 Tagen wählen.",
    );
  return value;
}
async function authenticated(c: PoolClient, req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer kcb_[a-f0-9]{64}$/.test(auth))
    throw new HttpError(401, "Bridge-Zugang fehlt.");
  const d = (
    await c.query(
      `SELECT d.*,t.scope,t.expires_at FROM bridge_devices d JOIN bridge_tokens t ON t.id=d.token_id WHERE d.credential_hash=$1 AND d.enabled AND d.deleted_at IS NULL AND t.deleted_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() FOR UPDATE OF d`,
      [hashToken(auth.slice(7))],
    )
  ).rows[0];
  if (!d)
    throw new HttpError(
      401,
      "Bridge-Zugang widerrufen, pausiert oder abgelaufen.",
    );
  await account(c, d.workspace_id);
  return d;
}
export async function bridgeAgent(req: Request, path: string, body: unknown) {
  if (path === "enroll") {
    const b = z
      .object({
        token: z.string().regex(/^kcb_[a-f0-9]{64}$/),
        name: z.string().min(1).max(100),
        platform: z.enum(["win32", "linux", "darwin"]),
      })
      .strict()
      .parse(body);
    return transaction(async (c) => {
      const t = (
        await c.query(
          "SELECT * FROM bridge_tokens WHERE token_hash=$1 AND revoked_at IS NULL AND deleted_at IS NULL AND used_at IS NULL AND expires_at>now() FOR UPDATE",
          [hashToken(b.token)],
        )
      ).rows[0];
      if (!t)
        throw new HttpError(
          401,
          "Verbindungsschlüssel ungültig, abgelaufen oder bereits benutzt.",
        );
      const a = await account(c, t.workspace_id);
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [a.id]);
      const n = Number(
        (
          await c.query(
            "SELECT count(*) n FROM bridge_devices d JOIN workspaces w ON w.id=d.workspace_id WHERE w.owner_id=(SELECT owner_id FROM workspaces WHERE id=$1) AND d.deleted_at IS NULL AND d.token_id<>$2",
            [t.workspace_id, t.id],
          )
        ).rows[0].n,
      );
      const docker = Number(
        (
          await c.query(
            "SELECT count(*) n FROM infrastructure_hosts WHERE customer_account_id=$1",
            [a.id],
          )
        ).rows[0].n,
      );
      if (n + docker >= a.max_customer_hosts)
        throw new HttpError(409, "Gerätelimit erreicht.");
      const credential = secret(),
        id = randomUUID();
      const d = (
        await c.query(
          `INSERT INTO bridge_devices(id,workspace_id,token_id,name,platform,credential_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(token_id) DO UPDATE SET name=EXCLUDED.name,platform=EXCLUDED.platform,credential_hash=EXCLUDED.credential_hash,enabled=true,local_paused=true,local_policy='{}',last_seen=NULL,deleted_at=NULL,revision=bridge_devices.revision+1 RETURNING id`,
          [id, t.workspace_id, t.id, b.name, b.platform, hashToken(credential)],
        )
      ).rows[0];
      await c.query("UPDATE bridge_tokens SET used_at=now() WHERE id=$1", [
        t.id,
      ]);
      await audit(c, null, "bridge.enroll", d.id);
      return { id: d.id, credential, scope: t.scope };
    });
  }
  return transaction(async (c) => {
    const d = await authenticated(c, req);
    if (path === "poll") {
      const b = z
        .object({
          paused: z.boolean(),
          policy: z
            .object({
              capabilities: z.array(z.string().max(40)).max(6),
              roots: z
                .array(
                  z.object({ alias: z.string().max(80), write: z.boolean() }),
                )
                .max(30),
              targets: z.array(z.string().max(200)).max(50),
              programs: z.array(z.string().max(80)).max(20),
            })
            .strict(),
        })
        .strict()
        .parse(body);
      await c.query(
        "UPDATE bridge_devices SET local_paused=$2,local_policy=$3,last_seen=now() WHERE id=$1",
        [d.id, b.paused, JSON.stringify(b.policy)],
      );
      await c.query(
        "UPDATE bridge_jobs SET status='uncertain',finished_at=now() WHERE device_id=$1 AND status='running' AND claim_until<now()",
        [d.id],
      );
      if (b.paused) return { job: null, scope: d.scope };
      const jobs = (
        await c.query(
          "SELECT * FROM bridge_jobs WHERE device_id=$1 AND status='queued' AND created_at>now()-interval '50 seconds' ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED",
          [d.id],
        )
      ).rows;
      for (const j of jobs) {
        if (
          !bridgeScopeAllows(d.scope, j.project_id, j.agent_id, j.action) ||
          j.device_revision !== d.revision ||
          !b.policy.capabilities.includes(bridgePermission(j.action))
        ) {
          await c.query(
            "UPDATE bridge_jobs SET status='canceled',finished_at=now() WHERE id=$1",
            [j.id],
          );
          continue;
        }
        try {
          await lockTask(c, j.task_id, j.task_lease);
        } catch {
          await c.query(
            "UPDATE bridge_jobs SET status='canceled',finished_at=now() WHERE id=$1",
            [j.id],
          );
          continue;
        }
        const lease = randomUUID();
        await c.query(
          "UPDATE bridge_jobs SET status='running',claim_lease=$2,claim_until=now()+interval '40 seconds' WHERE id=$1",
          [j.id, lease],
        );
        return {
          job: {
            id: j.id,
            lease,
            action: j.action,
            args: JSON.parse(decrypt(j.args_cipher)),
            project_id: j.project_id,
            agent_id: j.agent_id,
          },
          scope: d.scope,
        };
      }
      return { job: null, scope: d.scope };
    }
    const b = z
      .object({
        id: z.string().uuid(),
        lease: z.string().uuid(),
        result: z.record(z.unknown()).optional(),
      })
      .strict()
      .parse(body);
    const j = (
      await c.query(
        "SELECT * FROM bridge_jobs WHERE id=$1 AND device_id=$2 AND workspace_id=$3 FOR UPDATE",
        [b.id, d.id, d.workspace_id],
      )
    ).rows[0];
    if (
      !j ||
      j.claim_lease !== b.lease ||
      j.status !== "running" ||
      Date.parse(j.claim_until) < Date.now() ||
      j.device_revision !== d.revision ||
      !bridgeScopeAllows(d.scope, j.project_id, j.agent_id, j.action)
    )
      throw new HttpError(
        409,
        "Bridge-Aktion nicht mehr freigegeben; nicht wiederholen.",
      );
    await lockTask(c, j.task_id, j.task_lease);
    if (path === "authorize") {
      if (d.local_paused) throw new HttpError(409, "Bridge lokal pausiert.");
      return { ok: true };
    }
    if (path === "complete") {
      if (!b.result || JSON.stringify(b.result).length > 1500000)
        throw new HttpError(400, "Bridge-Ergebnis fehlt oder ist zu groß.");
      await c.query(
        "UPDATE bridge_jobs SET status=CASE WHEN $3 THEN 'uncertain' ELSE 'done' END,result=$2,finished_at=now() WHERE id=$1",
        [j.id, JSON.stringify(b.result), b.result.uncertain === true],
      );
      return { ok: true };
    }
    throw new HttpError(404, "Unbekannter Bridge-Endpunkt.");
  });
}
export async function bridgeTarget(c: PoolClient, task: any, args: unknown) {
  const b = bridgeAction.parse(args);
  const d = (
    await c.query(
      `SELECT d.*,t.scope FROM bridge_devices d JOIN bridge_tokens t ON t.id=d.token_id WHERE d.id=$1 AND d.workspace_id=$2 AND d.enabled AND d.deleted_at IS NULL AND t.revoked_at IS NULL AND t.deleted_at IS NULL AND t.expires_at>now()`,
      [b.device_id, task.workspace_id],
    )
  ).rows[0];
  const run = (
    await c.query(
      "SELECT project_id FROM runs WHERE id=$1 AND workspace_id=$2",
      [task.run_id, task.workspace_id],
    )
  ).rows[0];
  if (
    !d ||
    !run ||
    !bridgeScopeAllows(d.scope, run.project_id, task.agent_id, b.action)
  )
    throw new HttpError(
      403,
      "Bridge nicht für diesen Agenten, dieses Projekt oder diese Aktion freigegeben.",
    );
  await account(c, task.workspace_id);
  return {
    key: "bridge:" + d.id + ":" + b.action,
    scope: createHash("sha256")
      .update(JSON.stringify([d.id, d.revision, d.scope]))
      .digest("hex"),
    destination: d.name + " / " + b.action,
    device: d,
    input: b,
    project: run.project_id,
  };
}
export async function bridgeToolStep(
  taskId: string,
  lease: string,
  callId: string,
  name: string,
  args: unknown,
) {
  const operationId = taskId + ":" + callId;
  if (name === "list_bridges")
    return transaction(async (c) => {
      const { task, run } = await lockTask(c, taskId, lease);
      const rows = (
        await c.query(
          `SELECT d.id,d.name,d.platform,d.local_policy,d.local_paused,d.last_seen,t.scope FROM bridge_devices d JOIN bridge_tokens t ON t.id=d.token_id WHERE d.workspace_id=$1 AND d.enabled AND d.deleted_at IS NULL AND t.revoked_at IS NULL AND t.deleted_at IS NULL AND t.expires_at>now() AND t.scope->'project_ids' ? $2 AND t.scope->'agent_ids' ? $3`,
          [task.workspace_id, run.project_id, task.agent_id],
        )
      ).rows;
      return { result: JSON.stringify(rows), yield: false };
    });
  const id = randomUUID();
  await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const target = await bridgeTarget(c, task, args);
    if (
      bridgeNeedsApproval(target.input) &&
      (
        await c.query(
          "SELECT 1 FROM bridge_jobs WHERE task_id=$1 AND status='uncertain' LIMIT 1",
          [taskId],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Eine frühere Bridge-Aktion ist unklar. Erst lokal prüfen und in Bridge & Geräte als geprüft markieren; keine automatische Wiederholung.",
      );
    if (
      target.device.local_paused ||
      !target.device.last_seen ||
      Date.parse(target.device.last_seen) < Date.now() - 20000
    )
      throw new HttpError(409, "Bridge offline oder lokal pausiert.");
    await c.query(
      "INSERT INTO operations(id,task_id,tool_name) VALUES($1,$2,$3)",
      [operationId, taskId, name],
    );
    await c.query(
      "INSERT INTO bridge_jobs(id,workspace_id,device_id,operation_id,task_id,task_lease,project_id,agent_id,device_revision,action,args_cipher) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        task.workspace_id,
        target.device.id,
        operationId,
        taskId,
        lease,
        target.project,
        task.agent_id,
        target.device.revision,
        target.input.action,
        encrypt(JSON.stringify(target.input)),
      ],
    );
    await event(
      c,
      task.workspace_id,
      task.run_id,
      task.agent_id,
      "tool",
      "Bridge: " + target.device.name + " / " + target.input.action,
    );
  });
  const control = await executionSignal(taskId, lease);
  try {
    const end = Date.now() + 55000;
    while (Date.now() < end) {
      control.signal.throwIfAborted();
      const j = (
        await pool.query("SELECT status,result FROM bridge_jobs WHERE id=$1", [
          id,
        ])
      ).rows[0];
      if (j?.status === "done")
        return transaction(async (c) => {
          const { task } = await lockTask(c, taskId, lease);
          let result = j.result;
          if (result?.image_base64) {
            const content = Buffer.from(String(result.image_base64), "base64");
            if (content.length > 1000000)
              throw new HttpError(400, "Bild zu groß.");
            if (
              !content
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            )
              throw new HttpError(400, "PNG erwartet.");
            const quota = Number(
              (
                await c.query(
                  "SELECT coalesce(sum(octet_length(content)+coalesce(octet_length(binary_data),0)+binary_bytes),0) n FROM artifacts WHERE run_id=$1",
                  [task.run_id],
                )
              ).rows[0].n,
            );
            if (quota + content.length > 5000000)
              throw new HttpError(409, "Dateikontingent erreicht.");
            const saved = await saveArtifact(
              c,
              task,
              "bridge-screen-" + id + ".png",
              "Bridge desktop screenshot",
            );
            const aid = saved.artifact_id;
            const stored = await storeBinary(task.workspace_id, content);
            await c.query(
              "UPDATE artifacts SET binary_data=$2,binary_object=$3,binary_bytes=$4,binary_sha256=$5 WHERE id=$1",
              [
                aid,
                stored ? null : content,
                stored?.key ?? null,
                stored?.bytes ?? 0,
                stored?.sha256 ?? null,
              ],
            );
            result = {
              ok: result.ok,
              artifact_id: aid,
              name: "bridge-screen-" + id + ".png",
              note: "Screenshot saved as downloadable artifact.",
            };
          }
          const output = {
            result: redact(JSON.stringify(result)).slice(0, 30000),
            yield: false,
            isError: result?.ok === false,
          };
          await c.query(
            "UPDATE operations SET status='done',result=$2 WHERE id=$1",
            [operationId, JSON.stringify(output)],
          );
          await event(
            c,
            task.workspace_id,
            task.run_id,
            task.agent_id,
            "tool_result",
            "Bridge: " +
              (result?.ok === false ? "Fehler" : "Ergebnis gespeichert"),
          );
          return output;
        });
      if (!j || ["uncertain", "canceled"].includes(j.status))
        throw new HttpError(
          409,
          "Bridge-Aktion unklar oder widerrufen. Zustand prüfen; keine automatische Wiederholung.",
        );
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new HttpError(
      409,
      "Bridge-Ergebnis nicht bestätigt. Vor Wiederholung lokal prüfen.",
    );
  } finally {
    control.close();
    await pool.query(
      "UPDATE bridge_jobs SET status=CASE WHEN status='queued' THEN 'canceled' ELSE 'uncertain' END,finished_at=now() WHERE id=$1 AND status IN('queued','running')",
      [id],
    );
  }
}
export async function bridgeDownload(file: string) {
  const manifest = JSON.parse(
    await readFile(
      join(process.cwd(), "bridge-app/releases/manifest.json"),
      "utf8",
    ),
  );
  const entry = manifest.files.find((x: any) => x.name === file);
  if (!entry) throw new HttpError(404, "Download nicht verfügbar.");
  return {
    file: join(process.cwd(), "bridge-app/releases", entry.name),
    entry,
  };
}
