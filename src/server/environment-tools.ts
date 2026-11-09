import { wakeEnvironment } from "./environment-budgets.ts";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction, pool, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { lockTask, event } from "./store.ts";
import { executionSignal } from "./execution-control.ts";
import { accessSql } from "./environment-access.ts";
import { parseEnvironmentTool } from "../core/environment-tools.ts";
import { hostPolicySql } from "./execution-policy.ts";

export async function environmentPermission(
  c: Pick<PoolClient, "query">,
  taskId: string,
  lease: string,
  environmentId: string,
  permission: string,
  generation?: number,
) {
  const e = (
    await c.query(
      `SELECT e.* FROM customer_environments e JOIN tasks t ON t.workspace_id=e.workspace_id JOIN runs r ON r.id=t.run_id JOIN agents ag ON ag.id=t.agent_id JOIN workspaces w ON w.id=t.workspace_id JOIN accounts a ON a.owner_id=w.owner_id JOIN infrastructure_hosts h ON h.id=e.host_id JOIN users u ON u.id=w.owner_id WHERE t.id=$1 AND t.lease_token=$2 AND t.lease_until>now() AND t.status='running' AND r.status='running' AND NOT ag.execution_paused AND NOT w.execution_paused AND NOT u.suspended AND e.id=$3 AND e.project_id=r.project_id AND kc_project_agent(r.project_id,ag.id) AND e.agent_permissions ? $4 AND (jsonb_array_length(e.agent_ids)=0 OR e.agent_ids ? ag.id) AND ${hostPolicySql}`,
      [taskId, lease, environmentId, permission],
    )
  ).rows[0];
  if (
    !e ||
    (generation !== undefined && e.generation !== generation) ||
    !(await c.query(accessSql, [e.id, e.generation])).rowCount ||
    !e.controller_seen ||
    Date.now() - Date.parse(e.controller_seen) > 20000
  )
    throw new HttpError(
      409,
      "Umgebung ist nicht freigegeben, nicht bereit oder der Auftrag wurde gestoppt.",
    );
  if (permission === "browser" && e.template_id !== "browser")
    throw new HttpError(403, "Diese Umgebung bietet keine Browsersteuerung.");
  return e;
}
export async function environmentGrants(
  actor: string,
  workspaceId: string,
  body: unknown,
) {
  const b = z
    .object({
      id: z.string().uuid(),
      permissions: z.array(z.enum(["files", "exec", "browser"])).max(3),
      agentIds: z.array(z.string().uuid()).max(100),
    })
    .strict()
    .parse(body);
  await transaction(async (c) => {
    const e = (
      await c.query(
        "SELECT id,template_id FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND status<>'deleted' FOR UPDATE",
        [b.id, workspaceId],
      )
    ).rows[0];
    if (!e) throw new HttpError(404, "Umgebung fehlt in diesem Workspace.");
    if (b.permissions.includes("browser") && e.template_id !== "browser")
      throw new HttpError(
        400,
        "Browsersteuerung benötigt eine Browserumgebung.",
      );
    const own = await c.query(
      "SELECT id FROM agents WHERE workspace_id=$1 AND id=ANY($2::text[])",
      [workspaceId, b.agentIds],
    );
    if (own.rowCount !== new Set(b.agentIds).size)
      throw new HttpError(400, "Agent gehört nicht zum Workspace.");
    await c.query(
      "UPDATE customer_environments SET agent_permissions=$2,agent_ids=$3 WHERE id=$1",
      [
        e.id,
        JSON.stringify([...new Set(b.permissions)]),
        JSON.stringify([...new Set(b.agentIds)]),
      ],
    );
    await audit(c, actor, "environment.agent_permissions", e.id);
  });
  return { ok: true };
}
export async function environmentToolStep(
  taskId: string,
  lease: string,
  callId: string,
  name: string,
  args: unknown,
) {
  const operationId = `${taskId}:${callId}`;
  if (name === "environment_wake")
    return wakeEnvironment(taskId, lease, callId, args);
  if (name === "list_environments")
    return transaction(async (c) => {
      const { task } = await lockTask(c, taskId, lease);
      const rows = (
        await c.query(
          `SELECT e.id,e.name,e.status,e.template_id,e.host_id,h.name AS host_name,e.billing_source,e.agent_permissions AS permissions,e.auto_wake,e.idle_stopped,e.storage_budget_mb,e.storage_used_bytes,e.controller_seen>now()-interval '20 seconds' AS tools_ready FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id JOIN accounts a ON a.owner_id=w.owner_id JOIN infrastructure_hosts h ON h.id=e.host_id WHERE e.workspace_id=$1 AND e.project_id=(SELECT project_id FROM runs WHERE id=$3) AND e.status<>'deleted' AND jsonb_array_length(e.agent_permissions)>0 AND (jsonb_array_length(e.agent_ids)=0 OR e.agent_ids ? $2) AND ${hostPolicySql} ORDER BY e.name`,
          [task.workspace_id, task.agent_id, task.run_id],
        )
      ).rows;
      return { result: JSON.stringify(rows), yield: false };
    });
  const input = parseEnvironmentTool(name, args),
    jobId = randomUUID();
  await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const e = await environmentPermission(
      c,
      taskId,
      lease,
      input.args.environment_id,
      input.permission,
    );
    await c.query(
      "UPDATE customer_environments SET last_activity_at=now() WHERE id=$1",
      [e.id],
    );
    await c.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
      operationId,
      taskId,
    ]);
    await c.query(
      "INSERT INTO environment_tool_calls(id,operation_id,environment_id,generation,task_id,task_lease,permission,tool,args) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        jobId,
        operationId,
        e.id,
        e.generation,
        taskId,
        lease,
        input.permission,
        name,
        JSON.stringify({
          ...input.args,
          storage_budget_bytes: e.storage_budget_mb * 1024 * 1024,
          checkpoint_scope: task.run_id,
          process_scope: task.id,
          process_request_id: jobId,
        }),
      ],
    );
    await event(
      c,
      task.workspace_id,
      task.run_id,
      task.agent_id,
      "tool",
      `${e.name}: ${name}`,
    );
  });
  const control = await executionSignal(taskId, lease);
  try {
    const deadline = Date.now() + 55000;
    while (Date.now() < deadline) {
      control.signal.throwIfAborted();
      const job = (
        await pool.query(
          "SELECT status,result FROM environment_tool_calls WHERE id=$1",
          [jobId],
        )
      ).rows[0];
      if (job?.status === "done")
        return transaction(async (c) => {
          const { task } = await lockTask(c, taskId, lease);
          if (
            Number.isSafeInteger(job.result?.storage_used_bytes) &&
            job.result.storage_used_bytes >= 0
          )
            await c.query(
              "UPDATE customer_environments SET storage_used_bytes=$2 WHERE id=$1",
              [input.args.environment_id, job.result.storage_used_bytes],
            );
          const output = {
            result: JSON.stringify(job.result).slice(0, 30000),
            yield: false,
            isError: job.result?.ok === false,
            ...(job.result?.status === "running" && job.result?.process_id
              ? {
                  await_process: {
                    environment_id: input.args.environment_id,
                    process_id: job.result.process_id,
                    cursor: job.result.cursor ?? 0,
                  },
                }
              : {}),
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
            `${name}: ${job.result?.ok === false ? "Fehler" : "abgeschlossen"}`,
          );
          return output;
        });
      if (!job || ["uncertain", "canceled"].includes(job.status))
        throw new HttpError(
          409,
          "Containeraktion unterbrochen. Arbeitsstand vor Fortsetzen prüfen; keine automatische Wiederholung.",
        );
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new HttpError(
      409,
      "Containeraktion nicht rechtzeitig bestätigt. Ergebnis vor Wiederholung prüfen.",
    );
  } catch (error) {
    if (control.signal.aborted)
      throw new HttpError(409, "Ausführung wurde gestoppt.");
    throw error;
  } finally {
    control.close();
    await pool.query(
      "UPDATE environment_tool_calls SET status=CASE WHEN status='queued' THEN 'canceled' ELSE 'uncertain' END,finished_at=now() WHERE id=$1 AND status IN('queued','running')",
      [jobId],
    );
  }
}
