import { runtimeLock, maintainRuntime, finishRuntimeJob } from "./runtime.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { hashToken, sameSecret, encrypt, decrypt } from "./security.ts";
import { throttleSecurity } from "./mfa.ts";
const templateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/),
  name: z.string().trim().min(1).max(100),
  image: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9./_:@-]{0,250}$/),
  command: z.array(z.string().max(1000)).max(30),
  cpu: z.number().int().min(1).max(16),
  memory_mb: z.number().int().min(64).max(32768),
  container_port: z.number().int().min(0).max(65535),
  network: z.boolean(),
  enabled: z.boolean(),
  user_id: z
    .string()
    .regex(/^[1-9][0-9]{0,5}:[1-9][0-9]{0,5}$/)
    .default("1000:1000"),
  read_only: z.literal(true).default(true),
  access_mode: z.enum(["none", "code-server", "basic"]).default("none"),
  runtime_rate: z.number().int().min(1).max(100).default(1),
});
export async function newInfraHost(
  name: string,
  kind: "docker" | "aws_ecs",
  actor: string | null = null,
) {
  const id = randomUUID(),
    token = randomBytes(32).toString("hex");
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO infrastructure_hosts(id,name,kind,token_hash) VALUES($1,$2,$3,$4)",
      [id, name, kind, hashToken(token)],
    );
    await audit(c, actor, "infrastructure.host.created", id);
  });
  return { id, token };
}
export async function infrastructureView() {
  const [hosts, templates, environments, jobs, workers, workspaces] =
    await Promise.all([
      pool.query(
        "SELECT id,name,kind,enabled,provisioning,self_service,max_running,cpu_limit,memory_limit_mb,last_seen,inventory,created_at,customer_account_id,(SELECT u.email FROM accounts a JOIN users u ON u.id=a.owner_id WHERE a.id=infrastructure_hosts.customer_account_id) AS customer_email FROM infrastructure_hosts ORDER BY created_at",
      ),
      pool.query("SELECT * FROM environment_templates ORDER BY name"),
      pool.query(
        "SELECT e.*,w.name AS workspace_name,u.email FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id JOIN users u ON u.id=w.owner_id ORDER BY e.created_at DESC LIMIT 200",
      ),
      pool.query(
        "SELECT id,environment_id,action,status,error,created_at,completed_at FROM environment_jobs ORDER BY created_at DESC LIMIT 100",
      ),
      pool.query(
        "SELECT w.*, (SELECT count(*)::int FROM tasks t WHERE t.worker_id=w.id AND t.status='running') AS active_tasks FROM workers w WHERE last_seen>now()-interval '1 day' ORDER BY last_seen DESC",
      ),
      pool.query(
        "SELECT w.id,w.name,u.email FROM workspaces w JOIN users u ON u.id=w.owner_id ORDER BY w.created_at",
      ),
    ]);
  return {
    hosts: hosts.rows,
    templates: templates.rows,
    environments: environments.rows,
    jobs: jobs.rows,
    workers: workers.rows,
    workspaces: workspaces.rows,
  };
}
export async function adminInfrastructure(actor: string, body?: unknown) {
  if (!body) return infrastructureView();
  const action = z
    .object({
      action: z.enum([
        "createHost",
        "host",
        "template",
        "deploy",
        "environment",
      ]),
    })
    .parse(body).action;
  if (action === "createHost") {
    const b = z
      .object({
        name: z.string().trim().min(1).max(100),
        kind: z.enum(["docker", "aws_ecs"]),
      })
      .parse(body);
    return newInfraHost(b.name, b.kind, actor);
  }
  if (action === "host") {
    const b = z
      .object({
        id: z.string().uuid(),
        enabled: z.boolean(),
        provisioning: z.boolean(),
        self_service: z.boolean().optional(),
        max_running: z.number().int().min(1).max(500).optional(),
        cpu_limit: z.number().int().min(1).max(1024).optional(),
        memory_limit_mb: z.number().int().min(256).max(1048576).optional(),
      })
      .parse(body);
    await transaction(async (c) => {
      if (
        b.self_service &&
        (
          await c.query(
            "SELECT 1 FROM infrastructure_hosts WHERE id=$1 AND customer_account_id IS NOT NULL",
            [b.id],
          )
        ).rowCount
      )
        throw new HttpError(
          400,
          "Private Kunden-Rechner gehören nicht in den allgemeinen Hosting-Pool.",
        );
      const changed = await c.query(
        "UPDATE infrastructure_hosts SET enabled=$2,provisioning=$3,self_service=COALESCE($4,self_service),max_running=COALESCE($5,max_running),cpu_limit=COALESCE($6,cpu_limit),memory_limit_mb=COALESCE($7,memory_limit_mb) WHERE id=$1",
        [
          b.id,
          b.enabled,
          b.provisioning,
          b.self_service,
          b.max_running,
          b.cpu_limit,
          b.memory_limit_mb,
        ],
      );
      if (!changed.rowCount) throw new HttpError(404, "Server fehlt.");
      await audit(c, actor, "infrastructure.host.updated", b.id);
    });
    return { ok: true };
  }
  if (action === "template") {
    const b = templateSchema.parse(body);
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO environment_templates(id,name,image,command,cpu,memory_mb,container_port,network,enabled,user_id,read_only,access_mode,runtime_rate) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,image=EXCLUDED.image,command=EXCLUDED.command,cpu=EXCLUDED.cpu,memory_mb=EXCLUDED.memory_mb,container_port=EXCLUDED.container_port,network=EXCLUDED.network,enabled=EXCLUDED.enabled,user_id=EXCLUDED.user_id,access_mode=EXCLUDED.access_mode,runtime_rate=EXCLUDED.runtime_rate",
        [
          b.id,
          b.name,
          b.image,
          JSON.stringify(b.command),
          b.cpu,
          b.memory_mb,
          b.container_port,
          b.network,
          b.enabled,
          b.user_id,
          b.access_mode,
          b.runtime_rate,
        ],
      );
      await audit(c, actor, "infrastructure.template.updated", b.id);
    });
    return { ok: true };
  }
  if (action === "deploy") {
    const b = z
      .object({
        workspaceId: z.string().uuid(),
        hostId: z.string().uuid(),
        templateId: z.string().max(50),
        name: z.string().trim().min(1).max(100),
      })
      .parse(body);
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(6820192032)");
      const host = (
        await c.query(
          "SELECT * FROM infrastructure_hosts WHERE id=$1 AND enabled AND provisioning AND inventory->>'commandsEnabled'='true' AND last_seen>now()-interval '60 seconds' FOR UPDATE",
          [b.hostId],
        )
      ).rows[0];
      if (!host)
        throw new HttpError(
          409,
          "Server ist offline oder Bereitstellung nicht freigegeben.",
        );
      if (host.customer_account_id)
        throw new HttpError(
          403,
          "Kunden-Rechner nur über die kundeneigene Umgebungsbuchung verwenden.",
        );
      const template = (
        await c.query(
          "SELECT * FROM environment_templates WHERE id=$1 AND enabled",
          [b.templateId],
        )
      ).rows[0];
      if (!template) throw new HttpError(400, "Vorlage nicht freigegeben.");
      if (host.kind === "aws_ecs" && template.access_mode !== "none")
        throw new HttpError(
          409,
          "Browser-/Editor-Webzugänge sind zunächst für Docker verfügbar. Für AWS eine Betreiber-Taskdefinition ohne automatischen Webzugang verwenden.",
        );
      if (
        !(
          await c.query("SELECT 1 FROM workspaces WHERE id=$1", [b.workspaceId])
        ).rowCount
      )
        throw new HttpError(404, "Workspace fehlt.");
      const count = (
        await c.query(
          "SELECT count(*)::int AS n FROM customer_environments WHERE workspace_id=$1 AND status<>'deleted'",
          [b.workspaceId],
        )
      ).rows[0].n;
      if (count >= 10)
        throw new HttpError(
          409,
          "Maximal zehn aktive Umgebungen pro Workspace in dieser Version.",
        );
      const id = randomUUID(),
        jobId = randomUUID();
      await c.query(
        "INSERT INTO customer_environments(id,workspace_id,host_id,template_id,name) VALUES($1,$2,$3,$4,$5)",
        [id, b.workspaceId, b.hostId, b.templateId, b.name],
      );
      if (template.access_mode !== "none")
        await c.query(
          "INSERT INTO environment_credentials(environment_id,secret) VALUES($1,$2)",
          [id, encrypt(randomBytes(24).toString("base64url"))],
        );
      await c.query(
        "INSERT INTO environment_jobs(id,environment_id,host_id,action,generation,spec) VALUES($1,$2,$3,'deploy',1,$4)",
        [jobId, id, b.hostId, JSON.stringify(template)],
      );
      await audit(c, actor, "environment.deploy", id);
      return { id, jobId };
    });
  }
  const b = z
    .object({
      id: z.string().uuid(),
      operation: z.enum(["start", "stop", "reset", "delete", "reconcile"]),
      confirmation: z.string().default(""),
    })
    .parse(body);
  return transaction(async (c) => {
    await runtimeLock(c);
    const environment = (
      await c.query(
        "SELECT * FROM customer_environments WHERE id=$1 FOR UPDATE",
        [b.id],
      )
    ).rows[0];
    if (!environment) throw new HttpError(404, "Umgebung fehlt.");
    const host = (
      await c.query(
        "SELECT * FROM infrastructure_hosts WHERE id=$1 AND enabled AND provisioning AND inventory->>'commandsEnabled'='true' AND last_seen>now()-interval '60 seconds'",
        [environment.host_id],
      )
    ).rows[0];
    if (!host)
      throw new HttpError(
        409,
        "Server ist offline oder Bereitstellung gesperrt.",
      );
    if (b.operation === "reconcile") {
      const active = (
        await c.query(
          "SELECT * FROM environment_jobs WHERE environment_id=$1 AND status='uncertain' FOR UPDATE",
          [b.id],
        )
      ).rows[0];
      if (!active) throw new HttpError(409, "Kein unklarer Vorgang vorhanden.");
      // Same job ID and generation: drivers must reconcile idempotently, never invent a fresh deployment.
      await c.query(
        "UPDATE environment_jobs SET status='queued',lease=NULL,lease_until=NULL,error=NULL WHERE id=$1",
        [active.id],
      );
      await c.query(
        "UPDATE customer_environments SET status='pending',last_error=NULL WHERE id=$1",
        [b.id],
      );
      await audit(c, actor, "environment.reconcile", b.id);
      return { ok: true };
    }
    if (
      (
        await c.query(
          "SELECT 1 FROM environment_jobs WHERE environment_id=$1 AND status IN('queued','running','uncertain')",
          [b.id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Für diese Umgebung läuft bereits ein Vorgang oder sein Ausgang muss geklärt werden.",
      );
    if (environment.status === "deleted")
      throw new HttpError(409, "Umgebung wurde entfernt.");
    if (
      ["reset", "delete"].includes(b.operation) &&
      b.confirmation !== environment.name
    )
      throw new HttpError(
        400,
        "Bitte den Umgebungsnamen zur Bestätigung eingeben. Arbeitsdaten werden dabei entfernt.",
      );
    const template = (
      await c.query("SELECT * FROM environment_templates WHERE id=$1", [
        environment.template_id,
      ])
    ).rows[0];
    const generation =
        environment.generation + (b.operation === "reset" ? 1 : 0),
      jobId = randomUUID();
    await c.query(
      "INSERT INTO environment_jobs(id,environment_id,host_id,action,generation,spec) VALUES($1,$2,$3,$4,$5,$6)",
      [
        jobId,
        b.id,
        environment.host_id,
        b.operation,
        generation,
        JSON.stringify({
          ...template,
          resource_id: environment.resource_id,
          previous_generation: environment.generation,
        }),
      ],
    );
    await c.query(
      "UPDATE customer_environments SET status='pending',last_error=NULL,updated_at=now(),generation=$2 WHERE id=$1",
      [b.id, generation],
    );
    await audit(c, actor, `environment.${b.operation}`, b.id);
    return { ok: true, jobId };
  });
}
const inventorySchema = z.object({
  accessConfigured: z.boolean().default(false),
  version: z.string().max(100),
  hostname: z.string().max(100),
  cpuCount: z.number().int().min(1).max(4096),
  memoryTotal: z.number().nonnegative(),
  memoryFree: z.number().nonnegative(),
  load: z.array(z.number()).max(3),
  commandsEnabled: z.boolean(),
  containers: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(150),
        image: z.string().max(300),
        state: z.string().max(60),
        health: z.string().max(60),
        environmentId: z.string().max(100).nullable(),
        cpuPercent: z.number().nullable(),
        memoryBytes: z.number().nullable(),
        startedAt: z.string().max(100).nullable(),
      }),
    )
    .max(300),
});
export async function agentInfrastructure(
  req: NextRequest,
  path: string,
  body: unknown,
) {
  const hostId = req.headers.get("x-host-id") ?? "",
    token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const host = (
    await pool.query(
      "SELECT * FROM infrastructure_hosts WHERE id=$1 AND enabled=true",
      [hostId],
    )
  ).rows[0];
  if (
    !host ||
    !sameSecret(hashToken(token), host.token_hash) ||
    token.length < 40
  )
    throw new HttpError(401, "Server-Zugang ungültig.");
  if (host.customer_account_id)
    await throttleSecurity(`customer-connector:${hostId}`, 1500);
  if (path === "heartbeat") {
    const inventory = inventorySchema.parse(body);
    await pool.query(
      "UPDATE infrastructure_hosts SET last_seen=now(),inventory=$2 WHERE id=$1",
      [hostId, JSON.stringify(inventory)],
    );
    await transaction(async (c) => {
      await runtimeLock(c);
      const expired = await c.query(
        "UPDATE environment_jobs SET status='uncertain',error='Server-Rückmeldung ausgeblieben; Vorgang vor Wiederholung abgleichen.' WHERE host_id=$1 AND status='running' AND lease_until<now() RETURNING environment_id",
        [hostId],
      );
      for (const row of expired.rows)
        await c.query(
          "UPDATE customer_environments SET status='uncertain',last_error='Server-Rückmeldung ausgeblieben; Vorgang abgleichen.' WHERE id=$1",
          [row.environment_id],
        );
      await maintainRuntime(c);
      for (const container of inventory.containers) {
        if (!container.environmentId) continue;
        await c.query(
          "UPDATE customer_environments SET status=$3,updated_at=now() WHERE id=$1 AND host_id=$2 AND resource_id=$4 AND status NOT IN('deleted','pending') AND NOT EXISTS(SELECT 1 FROM environment_jobs j WHERE j.environment_id=$1 AND j.status IN('queued','running','uncertain'))",
          [
            container.environmentId,
            hostId,
            container.state === "running"
              ? "running"
              : container.state === "exited"
                ? "stopped"
                : container.state,
            container.id,
          ],
        );
      }
      await c.query(
        "UPDATE customer_environments e SET billing_active=false,paid_until=NULL,access_blocked=true,shutdown_requested=false WHERE host_id=$1 AND self_service AND status IN('stopped','dead','exited') AND NOT EXISTS(SELECT 1 FROM environment_jobs j WHERE j.environment_id=e.id AND j.status IN('queued','running','uncertain'))",
        [hostId],
      );
    });
    return { ok: true };
  }
  if (path === "claim") {
    if (!host.inventory.commandsEnabled) return { job: null };
    const entitled =
      !host.customer_account_id ||
      Boolean(
        (
          await pool.query(
            "SELECT 1 FROM accounts a JOIN plans p ON p.id=a.plan_id JOIN users u ON u.id=a.owner_id WHERE a.id=$1 AND a.subscription_status IN('active','local_test') AND (a.access_expires_at IS NULL OR a.access_expires_at>now()) AND p.active AND p.max_customer_hosts>0 AND NOT u.suspended",
            [host.customer_account_id],
          )
        ).rowCount,
      );
    return transaction(async (c) => {
      const job = (
        await c.query(
          "SELECT * FROM environment_jobs WHERE host_id=$1 AND status='queued' AND ($2 OR action IN('stop','delete')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
          [hostId, host.provisioning && entitled],
        )
      ).rows[0];
      if (!job) return { job: null };
      const lease = randomUUID();
      await c.query(
        "UPDATE environment_jobs SET status='running',lease=$2,lease_until=now()+interval '5 minutes' WHERE id=$1",
        [job.id, lease],
      );
      const credential = (
        await c.query(
          "SELECT secret,relay_secret FROM environment_credentials WHERE environment_id=$1",
          [job.environment_id],
        )
      ).rows[0];
      let relaySecret = credential?.relay_secret;
      if (credential && !relaySecret) {
        const value = randomBytes(32).toString("base64url");
        relaySecret = encrypt(value);
        await c.query(
          "UPDATE environment_credentials SET relay_secret=$2,relay_hash=$3 WHERE environment_id=$1",
          [job.environment_id, relaySecret, hashToken(value)],
        );
      }
      return {
        job: {
          id: job.id,
          environmentId: job.environment_id,
          action: job.action,
          generation: job.generation,
          spec: {
            ...job.spec,
            ...(credential
              ? {
                  accessPassword: decrypt(credential.secret),
                  relayToken: relaySecret ? decrypt(relaySecret) : undefined,
                }
              : {}),
          },
          lease,
        },
      };
    });
  }
  if (path === "job-heartbeat") {
    const b = z
      .object({ id: z.string().uuid(), lease: z.string().uuid() })
      .parse(body);
    const result = await pool.query(
      "UPDATE environment_jobs SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND host_id=$2 AND lease=$3 AND status='running' AND lease_until>now()",
      [b.id, hostId, b.lease],
    );
    if (!result.rowCount) throw new HttpError(409, "Server-Lease abgelaufen.");
    return { ok: true };
  }
  if (path === "complete") {
    const b = z
      .object({
        id: z.string().uuid(),
        lease: z.string().uuid(),
        ok: z.boolean(),
        resourceId: z.string().max(300).nullable().default(null),
        endpoint: z.string().max(500).nullable().default(null),
        resourceState: z.enum(["starting", "running"]).optional(),
        error: z.string().max(1000).optional(),
        uncertain: z.boolean().default(false),
      })
      .parse(body);
    await transaction(async (c) => {
      await runtimeLock(c);
      const job = (
        await c.query(
          "SELECT *,lease_until>now() AS valid FROM environment_jobs WHERE id=$1 AND host_id=$2 AND lease=$3 FOR UPDATE",
          [b.id, hostId, b.lease],
        )
      ).rows[0];
      const status = b.ok ? "succeeded" : b.uncertain ? "uncertain" : "failed";
      if (job?.status === status && job.status !== "running") return;
      if (!job || job.status !== "running" || !job.valid)
        throw new HttpError(
          409,
          "Vorgang gehört nicht mehr zu dieser Server-Lease.",
        );
      // A connector may advertise only a loopback endpoint. Public ingress needs a separately authenticated proxy.
      const endpoint =
        b.endpoint &&
        /^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(b.endpoint)
          ? b.endpoint
          : null;
      await c.query(
        "UPDATE environment_jobs SET status=$2,result=$3,error=$4,completed_at=now() WHERE id=$1",
        [
          b.id,
          status,
          JSON.stringify({ resourceId: b.resourceId, endpoint }),
          b.error ?? null,
        ],
      );
      await c.query(
        "UPDATE customer_environments SET status=$2,resource_id=COALESCE($3,resource_id),endpoint=$4,last_error=$5,updated_at=now() WHERE id=$1",
        [
          job.environment_id,
          b.ok
            ? job.action === "delete"
              ? "deleted"
              : job.action === "stop"
                ? "stopped"
                : (b.resourceState ?? "running")
            : b.uncertain
              ? "uncertain"
              : "failed",
          b.resourceId,
          endpoint,
          b.error ?? null,
        ],
      );
      if (b.ok && job.action === "delete")
        await c.query(
          "DELETE FROM environment_credentials WHERE environment_id=$1",
          [job.environment_id],
        );
      await finishRuntimeJob(c, job, b.ok, b.uncertain);
      await audit(c, null, `environment.job.${status}`, job.id);
    });
    return { ok: true };
  }
  throw new HttpError(404, "Server-Funktion fehlt.");
}
