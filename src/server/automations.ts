import { projectFor, assertProjectAgent } from "./organisation.ts";
import { randomUUID, randomBytes } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { hashToken, sameSecret, redact } from "./security.ts";
import { pipelineInput } from "../core/tool-pipeline.ts";
import { createRun } from "./store.ts";
async function allowance(c: any, workspaceId: string) {
  const row = (
    await c.query(
      "SELECT w.id,w.execution_paused,ac.plan_id,ac.subscription_status,ac.access_expires_at,p.max_automations,p.automation_runs,p.active,u.suspended FROM workspaces w JOIN users u ON u.id=w.owner_id JOIN accounts ac ON ac.owner_id=w.owner_id JOIN plans p ON p.id=ac.plan_id WHERE w.id=$1",
      [workspaceId],
    )
  ).rows[0];
  if (
    !row ||
    !row.active ||
    row.suspended ||
    row.execution_paused ||
    !["active", "local_test"].includes(row.subscription_status) ||
    (row.access_expires_at && Date.parse(row.access_expires_at) <= Date.now())
  )
    throw new HttpError(
      403,
      "Aktiver, nicht gestoppter Zugang für Automationen erforderlich.",
    );
  return { max: row.max_automations, monthly: row.automation_runs };
}
export async function listAutomations(
  workspaceId: string,
  projectId?: string | null,
) {
  const entries = (
    await pool.query(
      "SELECT id,name,agent_id,skill_id,skill_version,mode,goal,recipe,interval_minutes,enabled,next_at,token_limit,credit_limit,revision,project_id,overlap_policy,catch_up FROM automations WHERE workspace_id=$1 AND ($2::text='*' OR project_id=coalesce($2,kc_default_project($1))) ORDER BY created_at",
      [workspaceId, projectId === null ? "*" : (projectId ?? null)],
    )
  ).rows;
  const history = (
    await pool.query(
      "SELECT t.id,t.automation_id,t.status,t.run_id,t.error,t.created_at,r.status run_status,r.tokens_used FROM automation_triggers t JOIN automations a ON a.id=t.automation_id LEFT JOIN runs r ON r.id=t.run_id WHERE a.workspace_id=$1 AND ($2::text='*' OR a.project_id=coalesce($2,kc_default_project($1))) ORDER BY t.created_at DESC LIMIT 50",
      [workspaceId, projectId === null ? "*" : (projectId ?? null)],
    )
  ).rows;
  let limit = 0,
    monthly = 0;
  try {
    const a = await allowance(pool, workspaceId);
    limit = a.max;
    monthly = a.monthly;
  } catch {}
  const usage =
    (
      await pool.query(
        "SELECT coalesce(s.calls,0) calls FROM accounts a JOIN workspaces w ON w.owner_id=a.owner_id LEFT JOIN automation_usage s ON s.account_id=a.id AND s.period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM') WHERE w.id=$1",
        [workspaceId],
      )
    ).rows[0]?.calls ?? 0;
  return {
    entries,
    history,
    limit,
    monthly_limit: monthly,
    monthly_used: usage,
  };
}
export async function automationAction(
  actor: string,
  workspaceId: string,
  body: unknown,
  projectId?: string,
) {
  const action = z
    .enum(["save", "toggle", "delete", "run", "rotate_hook"])
    .parse((body as any)?.action);
  const b = body as any;
  return transaction(async (c) => {
    await c.query(
      "SELECT ac.id FROM accounts ac JOIN workspaces w ON w.owner_id=ac.owner_id WHERE w.id=$1 FOR UPDATE OF ac",
      [workspaceId],
    );
    if (action === "save") {
      const input = z
        .object({
          action: z.literal("save"),
          project_id: z.string().uuid().optional(),
          overlap_policy: z
            .enum(["queue", "coalesce", "skip"])
            .default("queue"),
          catch_up: z.enum(["coalesce", "skip"]).default("coalesce"),
          id: z.string().uuid().optional(),
          revision: z.number().int().min(1).optional(),
          name: z.string().trim().min(1).max(100),
          agent_id: z.string().uuid(),
          skill_id: z.string().uuid(),
          mode: z.enum(["agent", "pipeline", "pipeline_then_agent"]),
          goal: z.string().trim().min(10).max(4000),
          recipe: pipelineInput.optional(),
          interval_minutes: z.number().int().min(15).max(43200).nullable(),
          token_limit: z.number().int().min(1000).max(10000000),
          credit_limit: z.number().int().min(0).max(10000000),
          enabled: z.boolean(),
        })
        .strict()
        .parse(body);
      const project = await projectFor(
        c,
        workspaceId,
        input.project_id ?? projectId,
      );
      await assertProjectAgent(c, project.id, input.agent_id);
      const quota = await allowance(c, workspaceId);
      if (!quota.max)
        throw new HttpError(402, "Dieser Plan enthält keine Automationen.");
      const old = input.id
        ? (
            await c.query(
              "SELECT * FROM automations WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
              [input.id, workspaceId],
            )
          ).rows[0]
        : null;
      if (input.id && (!old || old.revision !== input.revision))
        throw new HttpError(409, "Automation fehlt oder wurde geändert.");
      const count = Number(
        (
          await c.query(
            "SELECT count(*) n FROM automations a JOIN workspaces w ON w.id=a.workspace_id WHERE w.owner_id=(SELECT owner_id FROM workspaces WHERE id=$1)",
            [workspaceId],
          )
        ).rows[0].n,
      );
      if (!old && count >= quota.max)
        throw new HttpError(402, "Automationslimit des Plans erreicht.");
      const skill = (
        await c.query(
          "SELECT s.version FROM skills s JOIN agents a ON a.id=$3 WHERE s.id=$1 AND s.workspace_id=$2 AND a.workspace_id=$2 AND a.skill_ids ? s.id AND s.status='approved'",
          [input.skill_id, workspaceId, input.agent_id],
        )
      ).rows[0];
      if (!skill)
        throw new HttpError(
          403,
          "Skill muss geprüft und dem ausgewählten Agenten zugeordnet sein.",
        );
      if (input.mode !== "agent" && !input.recipe)
        throw new HttpError(400, "Pipeline-Schritte fehlen.");
      if (
        input.recipe &&
        Buffer.byteLength(JSON.stringify(input.recipe)) > 100000
      )
        throw new HttpError(400, "Automationsrezept zu groß.");
      const id = old?.id ?? randomUUID(),
        token = old ? null : randomBytes(32).toString("base64url");
      await c.query(
        "INSERT INTO automations(id,workspace_id,agent_id,skill_id,skill_version,name,mode,goal,recipe,interval_minutes,enabled,next_at,token_limit,credit_limit,trigger_hash,project_id,overlap_policy,catch_up) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $10::int IS NULL THEN NULL ELSE now()+$10*interval '1 minute' END,$12,$13,$14,$15,$16,$17) ON CONFLICT(id) DO UPDATE SET agent_id=EXCLUDED.agent_id,skill_id=EXCLUDED.skill_id,skill_version=EXCLUDED.skill_version,name=EXCLUDED.name,mode=EXCLUDED.mode,goal=EXCLUDED.goal,recipe=EXCLUDED.recipe,interval_minutes=EXCLUDED.interval_minutes,enabled=EXCLUDED.enabled,next_at=EXCLUDED.next_at,token_limit=EXCLUDED.token_limit,credit_limit=EXCLUDED.credit_limit,project_id=EXCLUDED.project_id,overlap_policy=EXCLUDED.overlap_policy,catch_up=EXCLUDED.catch_up,revision=automations.revision+1",
        [
          id,
          workspaceId,
          input.agent_id,
          input.skill_id,
          skill.version,
          input.name,
          input.mode,
          input.goal,
          input.recipe ? JSON.stringify(input.recipe) : null,
          input.interval_minutes,
          input.enabled,
          input.token_limit,
          input.credit_limit,
          token ? hashToken(token) : old.trigger_hash,
          project.id,
          input.overlap_policy,
          input.catch_up,
        ],
      );
      await audit(c, actor, "automation.save", id);
      return { id, ...(token ? { webhook_token: token } : {}) };
    }
    const id = z.string().uuid().parse(b.id),
      row = (
        await c.query(
          "SELECT * FROM automations WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [id, workspaceId],
        )
      ).rows[0];
    if (!row) throw new HttpError(404, "Automation fehlt.");
    if (action === "delete")
      await c.query("DELETE FROM automations WHERE id=$1", [id]);
    if (action === "toggle") {
      const enabled = z.boolean().parse(b.enabled);
      if (enabled && !(await allowance(c, workspaceId)).max)
        throw new HttpError(402, "Plan enthält keine Automationen.");
      await c.query(
        "UPDATE automations SET enabled=$2,revision=revision+1 WHERE id=$1",
        [id, enabled],
      );
    }
    if (action === "run") {
      if (!row.enabled) throw new HttpError(409, "Automation ist pausiert.");
      await checkAutomationAllowance(c, id, workspaceId);
      await enqueue(c, id, "manual:" + randomUUID());
    }
    if (action === "rotate_hook") {
      const token = randomBytes(32).toString("base64url");
      await c.query("UPDATE automations SET trigger_hash=$2 WHERE id=$1", [
        id,
        hashToken(token),
      ]);
      await audit(c, actor, "automation.rotate_hook", id);
      return { webhook_token: token };
    }
    await audit(c, actor, "automation." + action, id);
    return { ok: true };
  });
}
async function enqueue(c: any, id: string, key: string) {
  const policy = (
    await c.query(
      "SELECT overlap_policy FROM automations WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  const pending = Number(
    (
      await c.query(
        "SELECT count(*) n FROM automation_triggers WHERE automation_id=$1 AND status='queued'",
        [id],
      )
    ).rows[0].n,
  );
  const active = Boolean(
    (
      await c.query(
        "SELECT 1 FROM automation_triggers t JOIN runs r ON r.id=t.run_id WHERE t.automation_id=$1 AND r.status IN('running','paused','input_required') LIMIT 1",
        [id],
      )
    ).rowCount,
  );
  if (policy.overlap_policy === "skip" && (pending || active)) return;
  if (policy.overlap_policy === "coalesce" && pending) return;
  if (
    (
      await c.query(
        "SELECT 1 FROM automation_triggers WHERE automation_id=$1 AND dedupe_key=$2",
        [id, key],
      )
    ).rowCount
  )
    return;
  if (
    Number(
      (
        await c.query(
          "SELECT count(*) n FROM automation_triggers WHERE automation_id=$1 AND status='queued'",
          [id],
        )
      ).rows[0].n,
    ) >= 10
  )
    throw new HttpError(429, "Automationswarteschlange voll.");
  await c.query(
    "INSERT INTO automation_triggers(id,automation_id,dedupe_key) VALUES($1,$2,$3) ON CONFLICT(automation_id,dedupe_key) DO NOTHING",
    [randomUUID(), id, key],
  );
}
async function checkAutomationAllowance(
  c: any,
  id: string,
  workspaceId: string,
) {
  const { max } = await allowance(c, workspaceId);
  const allowed = (
    await c.query(
      "SELECT a.id FROM automations a JOIN workspaces w ON w.id=a.workspace_id WHERE w.owner_id=(SELECT owner_id FROM workspaces WHERE id=$1) ORDER BY a.created_at,a.id LIMIT $2",
      [workspaceId, max],
    )
  ).rows;
  if (!allowed.some((a: any) => a.id === id))
    throw new HttpError(
      402,
      "Automation liegt außerhalb des aktuellen Planlimits.",
    );
}
export async function automationWebhook(
  id: string,
  token: string,
  key: string,
) {
  z.string().uuid().parse(id);
  z.string()
    .regex(/^[a-zA-Z0-9_.:-]{8,100}$/)
    .parse(key);
  return transaction(async (c) => {
    const a = (
      await c.query("SELECT * FROM automations WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (
      !a ||
      !a.enabled ||
      !token ||
      !sameSecret(hashToken(token), a.trigger_hash ?? "")
    )
      throw new HttpError(404, "Webhook nicht verfügbar.");
    await checkAutomationAllowance(c, id, a.workspace_id);
    await enqueue(c, id, "hook:" + key);
    return { accepted: true };
  });
}
let running = false;
export async function tickAutomations() {
  if (running) return;
  running = true;
  const c = await pool.connect().catch((error) => {
    running = false;
    throw error;
  });
  let locked = false;
  try {
    locked = (await c.query("SELECT pg_try_advisory_lock(6820192040) locked"))
      .rows[0].locked;
    if (!locked) return;
    await transaction(async (tx) => {
      const due = (
        await tx.query(
          "SELECT a.* FROM automations a JOIN workspaces w ON w.id=a.workspace_id JOIN users u ON u.id=w.owner_id JOIN accounts ac ON ac.owner_id=w.owner_id JOIN plans p ON p.id=ac.plan_id LEFT JOIN automation_usage s ON s.account_id=ac.id AND s.period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM') WHERE a.enabled AND a.next_at<=now() AND NOT w.execution_paused AND NOT u.suspended AND p.active AND p.max_automations>0 AND coalesce(s.calls,0)<p.automation_runs AND ac.subscription_status IN('active','local_test') AND (ac.access_expires_at IS NULL OR ac.access_expires_at>now()) ORDER BY a.next_at LIMIT 10 FOR UPDATE OF a SKIP LOCKED",
        )
      ).rows;
      for (const a of due) {
        try {
          const late =
            Date.now() - Date.parse(a.next_at) >
            Number(a.interval_minutes) * 60000;
          if (a.catch_up === "skip" && late) {
            await tx.query(
              "UPDATE automations SET next_at=now()+interval_minutes*interval '1 minute' WHERE id=$1",
              [a.id],
            );
            continue;
          }
          await enqueue(
            tx,
            a.id,
            "schedule:" + new Date(a.next_at).toISOString(),
          );
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 429))
            throw error;
        }
        await tx.query(
          "UPDATE automations SET next_at=now()+interval_minutes*interval '1 minute' WHERE id=$1",
          [a.id],
        );
      }
    });
    const jobs = (
      await c.query(
        "SELECT t.id,t.automation_id,a.workspace_id,a.agent_id,a.revision,a.goal,a.name FROM automation_triggers t JOIN automations a ON a.id=t.automation_id WHERE t.status='queued' AND t.scheduled_at<=now() AND a.enabled AND NOT EXISTS(SELECT 1 FROM automation_triggers older JOIN runs r ON r.id=older.run_id WHERE older.automation_id=a.id AND r.status IN('running','paused','input_required')) ORDER BY t.created_at LIMIT 8",
      )
    ).rows;
    for (const job of jobs)
      try {
        await checkAutomationAllowance(c, job.automation_id, job.workspace_id);
        const workspace = (
          await c.query("SELECT * FROM workspace_context WHERE id=$1", [
            job.workspace_id,
          ])
        ).rows[0];
        await createRun(
          workspace,
          "Automation: " + job.name + "\n" + job.goal,
          job.agent_id,
          [],
          false,
          [job.agent_id],
          "",
          { automation: { triggerId: job.id, revision: job.revision } },
        );
      } catch (e) {
        await c.query(
          "UPDATE automation_triggers SET status='blocked',error=$2 WHERE id=$1 AND run_id IS NULL",
          [
            job.id,
            redact(
              e instanceof HttpError
                ? e.message
                : "Automation konnte nicht gestartet werden.",
            ),
          ],
        );
      }
  } finally {
    try {
      if (locked) await c.query("SELECT pg_advisory_unlock(6820192040)");
    } finally {
      running = false;
      c.release();
    }
  }
}
