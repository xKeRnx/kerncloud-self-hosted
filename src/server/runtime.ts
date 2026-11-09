import { lockTask } from "./store.ts";
import { allocateAutomaticPlan } from "./plan-allowance.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { accessExpired } from "../core/account-access.ts";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { encrypt, hashToken } from "./security.ts";
import type { Workspace } from "../core/types.ts";
export const runtimeLock = (c: PoolClient) =>
  c.query("SELECT pg_advisory_xact_lock(6820192032)");
export async function runtimeAccount(c: PoolClient, id: string) {
  await allocateAutomaticPlan(c, id);
  const a = (
    await c.query(
      "SELECT a.*,row_to_json(p) AS plan FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1 FOR UPDATE OF a",
      [id],
    )
  ).rows[0];
  if (!a) throw new HttpError(404, "Konto fehlt.");
  const now = new Date(),
    period = `local:${now.toISOString().slice(0, 7)}`;
  if (
    a.subscription_status === "local_test" &&
    (a.runtime_period !== period || a.runtime_plan !== a.plan_id)
  ) {
    const value = a.plan.runtime_minutes * 60;
    await c.query(
      "UPDATE accounts SET runtime_included=$2,runtime_allowance=$2,runtime_period=$3,runtime_plan=plan_id,runtime_period_end=$4 WHERE id=$1",
      [
        id,
        value,
        period,
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
      ],
    );
    await c.query(
      "INSERT INTO runtime_ledger(id,account_id,kind,amount,period,reason) VALUES($1,$2,'local_plan',$3,$4,'Lokales Plan-Kontingent; keine Zahlung')",
      [randomUUID(), id, value - a.runtime_included, period],
    );
    a.runtime_included = value;
    a.runtime_allowance = value;
    a.runtime_period = period;
  }
  // Explicit manual grants expire at the published UTC month boundary.
  if (
    a.subscription_status !== "local_test" &&
    String(a.runtime_period).startsWith("local:") &&
    a.runtime_period_end &&
    new Date(a.runtime_period_end).getTime() <= Date.now()
  ) {
    const previous = a.runtime_included;
    await c.query(
      "UPDATE accounts SET runtime_included=0,runtime_allowance=0,runtime_period=$2 WHERE id=$1",
      [id, "expired:" + a.runtime_period],
    );
    if (previous)
      await c.query(
        "INSERT INTO runtime_ledger(id,account_id,kind,amount,period,reason) VALUES($1,$2,'expired',$3,$4,'Manuelles Plan-Kontingent abgelaufen')",
        [randomUUID(), id, -previous, a.runtime_period],
      );
    a.runtime_included = 0;
    a.runtime_allowance = 0;
    a.runtime_period = "expired:" + a.runtime_period;
  }
  return a;
}
export function activeRuntimePlan(a: any, local = false) {
  return (
    !accessExpired(a) &&
    (local || !a.runtime_disputed) &&
    a.plan.active &&
    ["active", "local_test"].includes(a.subscription_status) &&
    (local ? a.plan.max_local_environments : a.plan.max_environments) > 0
  );
}
async function reserve(c: PoolClient, a: any, e: any) {
  const amount = 60 * e.runtime_rate;
  if (a.runtime_debt > 0 || a.runtime_included + a.runtime_purchased < amount)
    throw new HttpError(
      402,
      "Nicht genügend Laufzeit-Minuten. Bitte Guthaben ergänzen.",
    );
  const included = Math.min(amount, a.runtime_included),
    purchased = amount - included,
    id = randomUUID();
  await c.query(
    "UPDATE accounts SET runtime_included=runtime_included-$2,runtime_purchased=runtime_purchased-$3 WHERE id=$1",
    [a.id, included, purchased],
  );
  await c.query(
    "INSERT INTO runtime_ledger(id,account_id,environment_id,kind,amount,included_part,purchased_part,period,reason) VALUES($1,$2,$3,'reservation',$4,$5,$6,$7,'Erste angefangene Laufzeit-Minute reserviert')",
    [id, a.id, e.id, -amount, included, purchased, a.runtime_period],
  );
  await c.query(
    "UPDATE customer_environments SET reservation=$2,reservation_period=$3 WHERE id=$1",
    [e.id, id, a.runtime_period],
  );
  return id;
}
export async function releaseReservation(c: PoolClient, e: any) {
  if (!e.reservation) return;
  const entry = (
    await c.query(
      "UPDATE runtime_ledger SET kind='released' WHERE id=$1 AND kind='reservation' RETURNING *",
      [e.reservation],
    )
  ).rows[0];
  if (entry) {
    const a = (
      await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
        entry.account_id,
      ])
    ).rows[0];
    const included =
      a.runtime_period === entry.period ? entry.included_part : 0;
    await c.query(
      "UPDATE accounts SET runtime_included=runtime_included+$2,runtime_purchased=runtime_purchased+$3 WHERE id=$1",
      [a.id, included, entry.purchased_part],
    );
    await c.query(
      "INSERT INTO runtime_ledger(id,account_id,environment_id,kind,amount,reason) VALUES($1,$2,$3,'release',$4,'Reservierung ohne bestätigten Start zurückgegeben')",
      [`release:${entry.id}`, a.id, e.id, included + entry.purchased_part],
    );
  }
  await c.query(
    "UPDATE customer_environments SET reservation=NULL WHERE id=$1",
    [e.id],
  );
}
export async function finishRuntimeJob(
  c: PoolClient,
  job: any,
  ok: boolean,
  uncertain: boolean,
) {
  const e = (
    await c.query(
      "SELECT * FROM customer_environments WHERE id=$1 FOR UPDATE",
      [job.environment_id],
    )
  ).rows[0];
  if (!e?.self_service) return;
  if (e.billing_source === "customer") {
    if (ok)
      await c.query(
        "UPDATE customer_environments SET billing_active=$2,paid_until=NULL,access_blocked=($3 OR shutdown_requested),reservation=NULL WHERE id=$1",
        [
          e.id,
          !["stop", "delete"].includes(job.action),
          ["stop", "delete"].includes(job.action),
        ],
      );
    else
      await c.query(
        "UPDATE customer_environments SET access_blocked=true WHERE id=$1",
        [e.id],
      );
    return;
  }
  if (ok && ["stop", "delete"].includes(job.action)) {
    await releaseReservation(c, e);
    await c.query(
      "UPDATE customer_environments SET billing_active=false,paid_until=NULL,access_blocked=true,shutdown_requested=false WHERE id=$1",
      [e.id],
    );
  } else if (ok) {
    if (e.reservation) {
      await c.query(
        "UPDATE runtime_ledger SET kind='usage',reason='Erste angefangene Laufzeit-Minute' WHERE id=$1 AND kind='reservation'",
        [e.reservation],
      );
      await c.query(
        "UPDATE customer_environments SET billing_active=true,paid_until=now()+interval '60 seconds',reservation=NULL,started_at=now(),access_blocked=shutdown_requested WHERE id=$1",
        [e.id],
      );
    } else
      await c.query(
        "UPDATE customer_environments SET billing_active=true,access_blocked=shutdown_requested WHERE id=$1",
        [e.id],
      );
  } else if (!uncertain) {
    await releaseReservation(c, e);
    await c.query(
      "UPDATE customer_environments SET access_blocked=true WHERE id=$1",
      [e.id],
    );
  }
}
export async function queueRuntimeStop(c: PoolClient, e: any, reason: string) {
  await c.query(
    "UPDATE customer_environments SET access_blocked=true,shutdown_requested=true,last_error=$2 WHERE id=$1",
    [e.id, reason],
  );
  if (
    (
      await c.query(
        "SELECT 1 FROM environment_jobs WHERE environment_id=$1 AND status IN('queued','running','uncertain')",
        [e.id],
      )
    ).rowCount
  )
    return;
  const template = (
    await c.query("SELECT * FROM environment_templates WHERE id=$1", [
      e.template_id,
    ])
  ).rows[0];
  await c.query(
    "INSERT INTO environment_jobs(id,environment_id,host_id,action,generation,spec) VALUES($1,$2,$3,'stop',$4,$5)",
    [randomUUID(), e.id, e.host_id, e.generation, JSON.stringify(template)],
  );
  await c.query(
    "UPDATE customer_environments SET status='pending' WHERE id=$1",
    [e.id],
  );
}
export async function maintainRuntime(c: PoolClient) {
  await runtimeLock(c);
  const rows = (
    await c.query(
      "SELECT e.*,a.id AS account_id,h.enabled AS host_enabled,h.last_seen FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id JOIN accounts a ON a.owner_id=w.owner_id JOIN infrastructure_hosts h ON h.id=e.host_id WHERE e.self_service AND e.billing_active ORDER BY e.created_at FOR UPDATE OF e",
    )
  ).rows;
  const positions = new Map<string, number>();
  for (const e of rows) {
    const a = await runtimeAccount(c, e.account_id),
      local = e.billing_source === "customer",
      key = `${a.id}:${e.billing_source}`,
      position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);
    if (e.shutdown_requested) {
      await queueRuntimeStop(c, e, e.last_error ?? "Zugang gesperrt.");
      continue;
    }
    if (
      !activeRuntimePlan(a, local) ||
      !a.plan.environment_templates.includes(e.template_id) ||
      position >
        (local ? a.plan.max_running_local : a.plan.max_running_environments) ||
      (!local && a.runtime_debt > 0)
    ) {
      await queueRuntimeStop(
        c,
        e,
        "Plan oder Laufzeitguthaben erlaubt den Betrieb nicht mehr.",
      );
      continue;
    }
    if (
      !e.host_enabled ||
      !e.last_seen ||
      Date.now() - Date.parse(e.last_seen) > 60000
    ) {
      await queueRuntimeStop(
        c,
        e,
        "Server nicht erreichbar. Zugang gesperrt; Stoppen angefordert.",
      );
      continue;
    }
    if (local) continue;
    let paid = Date.parse(e.paid_until ?? 0);
    const now = Date.now();
    // Charge every started minute exactly once under the environment/account lock.
    // Missing long periods are never silently charged as a bulk debt.
    if (now - paid > 120000) {
      await queueRuntimeStop(
        c,
        e,
        "Abrechnungsprüfung unterbrochen; Betrieb wird vorsorglich gestoppt.",
      );
      continue;
    }
    while (paid <= now) {
      const amount = 60 * e.runtime_rate,
        latest = await runtimeAccount(c, a.id);
      if (latest.runtime_included + latest.runtime_purchased < amount) {
        await queueRuntimeStop(
          c,
          e,
          "Laufzeit-Minuten aufgebraucht. Automatischer Stopp angefordert.",
        );
        break;
      }
      const included = Math.min(amount, latest.runtime_included),
        purchased = amount - included;
      const id = `usage:${e.id}:${e.generation}:${paid}`;
      const first = (
        await c.query(
          "INSERT INTO runtime_ledger(id,account_id,environment_id,kind,amount,included_part,purchased_part,period,reason) VALUES($1,$2,$3,'usage',$4,$5,$6,$7,'Angefangene Laufzeit-Minute') ON CONFLICT DO NOTHING RETURNING id",
          [id, a.id, e.id, -amount, included, purchased, latest.runtime_period],
        )
      ).rowCount;
      if (first)
        await c.query(
          "UPDATE accounts SET runtime_included=runtime_included-$2,runtime_purchased=runtime_purchased-$3 WHERE id=$1",
          [a.id, included, purchased],
        );
      paid += 60000;
      await c.query(
        "UPDATE customer_environments SET paid_until=$2 WHERE id=$1",
        [e.id, new Date(paid)],
      );
    }
  }
  await c.query("DELETE FROM environment_tickets WHERE expires_at<now()");
  await c.query("DELETE FROM environment_sessions WHERE expires_at<now()");
}
export async function customerRuntimeView(workspace: Workspace) {
  return transaction(async (c) => {
    await runtimeLock(c);
    const a = await runtimeAccount(c, workspace.account_id);
    const execution = (
      await c.query(
        "SELECT allow_hosted_execution FROM workspaces WHERE id=$1",
        [workspace.id],
      )
    ).rows[0];
    const environments = (
      await c.query(
        "SELECT e.id,e.name,e.status,e.template_id,e.generation,e.self_service,e.agent_permissions,e.agent_ids,e.controller_seen,e.access_blocked,e.paid_until,e.last_error,e.runtime_rate,e.created_at,e.updated_at,e.relay_seen,e.billing_source,e.host_id,e.project_id,h.name AS host_name FROM customer_environments e JOIN infrastructure_hosts h ON h.id=e.host_id WHERE workspace_id=$1 AND e.project_id=coalesce($2,kc_default_project($1)) ORDER BY created_at DESC",
        [workspace.id, workspace.project_id ?? null],
      )
    ).rows;
    const catalog = (
      await c.query(
        "SELECT id,name,cpu,memory_mb,runtime_rate FROM environment_templates WHERE enabled AND access_mode<>'none' AND id=ANY($1::text[]) ORDER BY name",
        [a.plan.environment_templates],
      )
    ).rows;
    const usage = (
      await c.query(
        "SELECT count(*) FILTER(WHERE billing_source='hosted')::int AS booked,count(*) FILTER(WHERE billing_source='hosted' AND (billing_active OR status='pending'))::int AS running,count(*) FILTER(WHERE billing_source='customer')::int AS local_booked,count(*) FILTER(WHERE billing_source='customer' AND (billing_active OR status='pending'))::int AS local_running FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1 AND e.status<>'deleted'",
        [workspace.owner_id],
      )
    ).rows[0];
    const products = (
      await c.query(
        "SELECT id,name,minutes,price_cents,stripe_price_id IS NOT NULL AS configured FROM runtime_products WHERE active ORDER BY price_cents",
      )
    ).rows;
    const payments =
      (
        await c.query(
          "SELECT (value->>'enabled')::boolean AS enabled FROM settings WHERE id='billing'",
        )
      ).rows[0]?.enabled ?? false;
    const ledger = (
      await c.query(
        "SELECT id,kind,amount,reason,environment_id,created_at FROM runtime_ledger WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
        [a.id],
      )
    ).rows;
    const hostedReady = Boolean(
      (
        await c.query(
          "SELECT 1 FROM infrastructure_hosts WHERE kind='docker' AND customer_account_id IS NULL AND enabled AND provisioning AND self_service AND inventory->>'commandsEnabled'='true' AND inventory->>'accessConfigured'='true' AND last_seen>now()-interval '60 seconds' LIMIT 1",
        )
      ).rowCount,
    );
    const localLocations = (
      await c.query(
        "SELECT h.id,h.name,(h.enabled AND h.provisioning AND h.inventory->>'commandsEnabled'='true' AND h.inventory->>'accessConfigured'='true' AND h.last_seen>now()-interval '60 seconds') IS TRUE available FROM infrastructure_hosts h JOIN workspaces w ON w.id=$2 WHERE h.customer_account_id=$1 AND w.execution_host_ids ? h.id ORDER BY h.created_at",
        [a.id, workspace.id],
      )
    ).rows;
    return {
      agents: (
        await c.query(
          "SELECT id,name,execution_paused FROM agents WHERE workspace_id=$1 AND kc_project_agent(coalesce($2,kc_default_project($1)),id) ORDER BY name",
          [workspace.id, workspace.project_id ?? null],
        )
      ).rows,
      tool_activity: (
        await c.query(
          "SELECT j.id,j.tool,j.status,j.result,j.created_at,e.name AS environment_name,a.name AS agent_name FROM environment_tool_calls j JOIN customer_environments e ON e.id=j.environment_id JOIN tasks t ON t.id=j.task_id JOIN agents a ON a.id=t.agent_id WHERE e.workspace_id=$1 AND e.project_id=coalesce($2,kc_default_project($1)) ORDER BY j.created_at DESC LIMIT 30",
          [workspace.id, workspace.project_id ?? null],
        )
      ).rows,
      payments_enabled: payments,
      environments,
      catalog,
      products,
      ledger,
      usage,
      eligible: activeRuntimePlan(a) || activeRuntimePlan(a, true),
      location_status: {
        hosted_plan: activeRuntimePlan(a),
        local_plan: activeRuntimePlan(a, true),
        hosted_allowed: execution.allow_hosted_execution,
        hosted_ready: hostedReady,
      },
      locations: [
        ...(execution.allow_hosted_execution && activeRuntimePlan(a)
          ? [
              {
                id: "hosted",
                name: "KeRnCloud Hosting",
                available: hostedReady,
              },
            ]
          : []),
        ...(activeRuntimePlan(a, true) ? localLocations : []),
      ],
      plan: {
        name: a.plan.name,
        max_environments: a.plan.max_environments,
        max_running_environments: a.plan.max_running_environments,
        runtime_minutes: a.plan.runtime_minutes,
        max_local_environments: a.plan.max_local_environments,
        max_running_local: a.plan.max_running_local,
      },
      balance: {
        included: a.runtime_included,
        purchased: a.runtime_purchased,
        debt: a.runtime_debt,
        period_end: a.runtime_period_end,
      },
    };
  });
}
export async function customerEnvironment(
  actor: string,
  workspace: Workspace,
  body: unknown,
  idleStop = false,
  wakeContext?: { taskId: string; lease: string },
) {
  const b = z
    .object({
      action: z.enum(["book", "start", "stop", "reset", "delete"]),
      id: z.string().uuid().optional(),
      templateId: z.string().max(50).optional(),
      name: z.string().trim().min(1).max(100).optional(),
      confirmation: z.string().default(""),
      expectedRate: z.number().int().min(1).max(100).optional(),
      hostId: z
        .union([z.string().uuid(), z.literal("hosted")])
        .default("hosted"),
    })
    .parse(body);
  return transaction(async (c) => {
    const wakeTask = wakeContext
      ? (await lockTask(c, wakeContext.taskId, wakeContext.lease)).task
      : null;
    if (wakeTask && wakeTask.workspace_id !== workspace.id)
      throw new HttpError(403, "Foreign wake task");
    const selectedProject = wakeTask
      ? (
          await c.query("SELECT project_id FROM runs WHERE id=$1", [
            wakeTask.run_id,
          ])
        ).rows[0]?.project_id
      : (workspace.project_id ?? null);
    await runtimeLock(c);
    const a = await runtimeAccount(c, workspace.account_id);
    if (b.action === "book") {
      const local = b.hostId !== "hosted";
      const policy = (
        await c.query(
          "SELECT allow_hosted_execution,execution_host_ids FROM workspaces WHERE id=$1",
          [workspace.id],
        )
      ).rows[0];
      if (
        (!local && !policy.allow_hosted_execution) ||
        (local && !policy.execution_host_ids.includes(b.hostId))
      )
        throw new HttpError(
          403,
          "Dieser Ausführungsort ist im Workspace nicht ausgewählt. Kein automatischer Wechsel in die Cloud.",
        );
      if (!activeRuntimePlan(a, local))
        throw new HttpError(
          403,
          "Dein Plan enthält keine buchbaren Umgebungen.",
        );
      const template = (
        await c.query(
          "SELECT * FROM environment_templates WHERE id=$1 AND enabled AND access_mode<>'none'",
          [b.templateId ?? ""],
        )
      ).rows[0];
      if (!template || !a.plan.environment_templates.includes(template.id))
        throw new HttpError(
          403,
          "Diese Vorlage ist in deinem Plan nicht verfügbar.",
        );
      if (b.expectedRate !== template.runtime_rate)
        throw new HttpError(
          409,
          "Tarif geändert. Bitte Ansicht aktualisieren.",
        );
      const count = Number(
        (
          await c.query(
            "SELECT count(*) FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1 AND e.status<>'deleted' AND e.billing_source=$2",
            [workspace.owner_id, local ? "customer" : "hosted"],
          )
        ).rows[0].count,
      );
      if (
        count >=
        (local ? a.plan.max_local_environments : a.plan.max_environments)
      )
        throw new HttpError(
          409,
          "Alle Umgebungsplätze deines Plans sind belegt, auch in anderen Workspaces.",
        );
      const host = (
        await c.query(
          "SELECT id FROM infrastructure_hosts WHERE kind='docker' AND enabled AND (self_service OR customer_account_id=$2) AND provisioning AND inventory->>'commandsEnabled'='true' AND inventory->>'accessConfigured'='true' AND last_seen>now()-interval '60 seconds' AND (($1='hosted' AND customer_account_id IS NULL) OR (id=$1 AND customer_account_id=$2)) ORDER BY created_at LIMIT 1",
          [b.hostId, a.id],
        )
      ).rows[0];
      if (!host)
        throw new HttpError(
          409,
          "Derzeit ist kein freigegebener Server erreichbar.",
        );
      const id = randomUUID(),
        relay = randomBytes(32).toString("base64url");
      await c.query(
        "INSERT INTO customer_environments(id,workspace_id,host_id,template_id,name,status,self_service,runtime_rate,access_blocked,billing_source,project_id) VALUES($1,$2,$3,$4,$5,'booked',true,$6,true,$7,$8)",
        [
          id,
          workspace.id,
          host.id,
          template.id,
          b.name ?? template.name,
          template.runtime_rate,
          local ? "customer" : "hosted",
          workspace.project_id ?? null,
        ],
      );
      await c.query(
        "INSERT INTO environment_credentials(environment_id,secret,relay_secret,relay_hash) VALUES($1,$2,$3,$4)",
        [
          id,
          encrypt(randomBytes(24).toString("base64url")),
          encrypt(relay),
          hashToken(relay),
        ],
      );
      await audit(c, actor, "environment.book", id);
      return { id };
    }
    const e = (
      await c.query(
        "SELECT * FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND ($4::boolean OR project_id=coalesce($3,kc_default_project($2))) FOR UPDATE",
        [b.id ?? "", workspace.id, selectedProject, idleStop],
      )
    ).rows[0];
    if (!e || e.status === "deleted")
      throw new HttpError(404, "Umgebung fehlt in diesem Workspace.");
    if (
      wakeTask &&
      (!e.auto_wake ||
        !e.agent_permissions.length ||
        (e.agent_ids.length && !e.agent_ids.includes(wakeTask.agent_id)))
    )
      throw new HttpError(403, "Wake permission revoked");
    if (idleStop) {
      const active = (
        await c.query(
          "SELECT EXISTS(SELECT 1 FROM tasks WHERE workspace_id=$1 AND status IN('running','queued')) OR EXISTS(SELECT 1 FROM environment_tool_calls WHERE environment_id=$2 AND status IN('queued','running','uncertain')) busy",
          [workspace.id, e.id],
        )
      ).rows[0].busy;
      if (
        active ||
        e.status !== "running" ||
        !e.idle_minutes ||
        Date.parse(e.last_activity_at) > Date.now() - e.idle_minutes * 60000
      )
        return { skipped: true };
    }
    await c.query(
      "UPDATE customer_environments SET idle_stopped=$2,last_activity_at=CASE WHEN $2 THEN last_activity_at ELSE now() END WHERE id=$1",
      [e.id, idleStop],
    );
    if (["reset", "delete"].includes(b.action) && b.confirmation !== e.name)
      throw new HttpError(
        400,
        "Zur Bestätigung den vollständigen Umgebungsnamen eingeben.",
      );
    if (
      (
        await c.query(
          "SELECT 1 FROM environment_jobs WHERE environment_id=$1 AND status IN('queued','running','uncertain')",
          [e.id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Ein Vorgang läuft oder muss vom Betreiber abgeglichen werden.",
      );
    if (!e.resource_id && ["stop", "delete"].includes(b.action)) {
      await releaseReservation(c, e);
      await c.query(
        "UPDATE customer_environments SET status=$2,billing_active=false,access_blocked=true WHERE id=$1",
        [e.id, b.action === "delete" ? "deleted" : "booked"],
      );
      return { ok: true };
    }
    const template = (
      await c.query("SELECT * FROM environment_templates WHERE id=$1", [
        e.template_id,
      ])
    ).rows[0];
    if (["start", "reset"].includes(b.action)) {
      const policy = (
        await c.query(
          "SELECT allow_hosted_execution,execution_host_ids FROM workspaces WHERE id=$1",
          [workspace.id],
        )
      ).rows[0];
      if (
        (e.billing_source === "hosted" && !policy.allow_hosted_execution) ||
        (e.billing_source === "customer" &&
          !policy.execution_host_ids.includes(e.host_id))
      )
        throw new HttpError(
          403,
          "Dieser Ausführungsort ist im Workspace nicht ausgewählt.",
        );
      if (
        !e.self_service ||
        !activeRuntimePlan(a, e.billing_source === "customer") ||
        !template.enabled ||
        !a.plan.environment_templates.includes(template.id)
      )
        throw new HttpError(
          403,
          "Dein aktueller Plan erlaubt diese Umgebung nicht.",
        );
      if (b.action === "start" && e.status === "running" && !e.access_blocked)
        return { ok: true };
      if (!e.billing_active) {
        const running = Number(
          (
            await c.query(
              "SELECT count(*) FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE w.owner_id=$1 AND e.id<>$2 AND e.billing_source=$3 AND e.status<>'deleted' AND (e.billing_active OR e.status='pending')",
              [workspace.owner_id, e.id, e.billing_source],
            )
          ).rows[0].count,
        );
        if (
          running >=
          (e.billing_source === "customer"
            ? a.plan.max_running_local
            : a.plan.max_running_environments)
        )
          throw new HttpError(
            409,
            "Maximal gleichzeitig laufende Umgebungen erreicht.",
          );
        if (b.expectedRate !== template.runtime_rate)
          throw new HttpError(
            409,
            "Tarif geändert. Bitte Ansicht aktualisieren.",
          );
        e.runtime_rate = template.runtime_rate;
        await c.query(
          "UPDATE customer_environments SET runtime_rate=$2 WHERE id=$1",
          [e.id, e.runtime_rate],
        );
        if (e.billing_source !== "customer") await reserve(c, a, e);
      }
      const host = (
        await c.query(
          "SELECT * FROM infrastructure_hosts WHERE id=$1 AND kind='docker' AND enabled AND provisioning AND (self_service OR customer_account_id=$3) AND inventory->>'commandsEnabled'='true' AND inventory->>'accessConfigured'='true' AND last_seen>now()-interval '60 seconds' AND ((customer_account_id IS NULL AND $2='hosted') OR (customer_account_id=$3 AND $2='customer'))",
          [e.host_id, e.billing_source, a.id],
        )
      ).rows[0];
      if (!host)
        throw new HttpError(409, "Der zugeordnete Server ist nicht bereit.");
      const load = (
        await c.query(
          "SELECT count(*)::int AS n,COALESCE(sum(COALESCE((SELECT (j.spec->>'cpu')::int FROM environment_jobs j WHERE j.environment_id=e.id AND j.action IN('deploy','start','reset') ORDER BY j.created_at DESC LIMIT 1),t.cpu)*1000+500),0)::int AS milli_cpu,COALESCE(sum(COALESCE((SELECT (j.spec->>'memory_mb')::int FROM environment_jobs j WHERE j.environment_id=e.id AND j.action IN('deploy','start','reset') ORDER BY j.created_at DESC LIMIT 1),t.memory_mb)+128),0)::int AS memory FROM customer_environments e JOIN environment_templates t ON t.id=e.template_id WHERE e.host_id=$1 AND e.id<>$2 AND e.status NOT IN('deleted','booked','stopped')",
          [host.id, e.id],
        )
      ).rows[0];
      if (
        load.n >= host.max_running ||
        load.milli_cpu + template.cpu * 1000 + 500 > host.cpu_limit * 1000 ||
        load.memory + template.memory_mb + 128 > host.memory_limit_mb
      )
        throw new HttpError(
          409,
          "Auf diesem Server ist derzeit keine freie Kapazität.",
        );
      const gateway = (
        await c.query(
          "SELECT 1 FROM gateway_instances WHERE expires_at>now() LIMIT 1",
        )
      ).rows[0];
      if (!gateway)
        throw new HttpError(
          503,
          "Geschützter Zugang ist derzeit nicht verfügbar.",
        );
    }
    const generation = e.generation + (b.action === "reset" ? 1 : 0);
    if (b.action === "reset") {
      const relay = randomBytes(32).toString("base64url");
      await c.query(
        "UPDATE environment_credentials SET relay_secret=$2,relay_hash=$3 WHERE environment_id=$1",
        [e.id, encrypt(relay), hashToken(relay)],
      );
      await c.query(
        "DELETE FROM environment_sessions WHERE environment_id=$1",
        [e.id],
      );
    }
    const jobId = randomUUID(),
      action = b.action === "start" && !e.resource_id ? "deploy" : b.action;
    await c.query(
      "INSERT INTO environment_jobs(id,environment_id,host_id,action,generation,spec) VALUES($1,$2,$3,$4,$5,$6)",
      [
        jobId,
        e.id,
        e.host_id,
        action,
        generation,
        JSON.stringify({ ...template, previous_generation: e.generation }),
      ],
    );
    await c.query(
      "UPDATE customer_environments SET status='pending',controller_seen=NULL,generation=$2,access_blocked=true,shutdown_requested=$3,updated_at=now() WHERE id=$1",
      [e.id, generation, ["stop", "delete"].includes(b.action)],
    );
    await audit(c, actor, `environment.customer.${b.action}`, e.id);
    return { ok: true, jobId };
  });
}
export async function adminRuntime(actor: string, body?: unknown) {
  if (body) {
    const action = z
      .object({ action: z.enum(["product", "grant"]) })
      .parse(body).action;
    if (action === "product") {
      const b = z
        .object({
          id: z.string().regex(/^[a-z0-9-]{1,50}$/),
          name: z.string().min(1).max(100),
          minutes: z.number().int().min(1).max(1000000),
          price_cents: z.number().int().min(1).max(10000000),
          stripe_price_id: z
            .string()
            .regex(/^price_[a-zA-Z0-9_]+$/)
            .nullable(),
          active: z.boolean(),
        })
        .parse(body);
      await transaction(async (c) => {
        await c.query(
          "INSERT INTO runtime_products(id,name,minutes,price_cents,stripe_price_id,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,minutes=EXCLUDED.minutes,price_cents=EXCLUDED.price_cents,stripe_price_id=EXCLUDED.stripe_price_id,active=EXCLUDED.active",
          [b.id, b.name, b.minutes, b.price_cents, b.stripe_price_id, b.active],
        );
        await audit(c, actor, "runtime.product.update", b.id);
      });
    } else {
      const b = z
        .object({
          workspaceId: z.string(),
          seconds: z.number().int().min(-60000000).max(60000000),
        })
        .parse(body);
      await transaction(async (c) => {
        await runtimeLock(c);
        const a = (
          await c.query(
            "SELECT a.* FROM accounts a JOIN workspaces w ON w.owner_id=a.owner_id WHERE w.id=$1 FOR UPDATE OF a",
            [b.workspaceId],
          )
        ).rows[0];
        if (!a) throw new HttpError(404, "Konto fehlt.");
        if (a.runtime_purchased + b.seconds < 0)
          throw new HttpError(
            400,
            "Guthaben reicht für diese Korrektur nicht aus.",
          );
        await c.query(
          "UPDATE accounts SET runtime_purchased=runtime_purchased+$2-$3,runtime_debt=runtime_debt-$3 WHERE id=$1",
          [a.id, b.seconds, Math.min(Math.max(0, b.seconds), a.runtime_debt)],
        );
        await c.query(
          "INSERT INTO runtime_ledger(id,account_id,kind,amount,reason) VALUES($1,$2,'admin_adjustment',$3,'Betreiberkorrektur; keine Zahlung')",
          [randomUUID(), a.id, b.seconds],
        );
        await audit(c, actor, "runtime.adjustment", a.id);
      });
    }
  }
  return {
    products: (
      await pool.query("SELECT * FROM runtime_products ORDER BY price_cents")
    ).rows,
    accounts: (
      await pool.query(
        "SELECT a.id,u.email,(SELECT id FROM workspaces WHERE owner_id=a.owner_id ORDER BY created_at LIMIT 1) AS workspace_id,a.runtime_included,a.runtime_purchased,a.runtime_debt FROM accounts a JOIN users u ON u.id=a.owner_id",
      )
    ).rows,
  };
}
