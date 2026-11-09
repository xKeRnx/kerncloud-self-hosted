import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { customerEnvironment } from "./runtime.ts";
import { lockTask } from "./store.ts";
import { workspaceEventNotice } from "./briefings.ts";
export async function environmentBudgets(
  user: string,
  workspace: string,
  body?: unknown,
) {
  if (body) {
    if (!["owner", "admin"].includes(await workspaceRole(user, workspace)))
      throw new HttpError(403, "Workspace-Administration erforderlich.");
    const b = z
      .object({
        id: z.string().uuid(),
        idle_minutes: z.number().int().min(0).max(1440),
        auto_wake: z.boolean(),
        storage_budget_mb: z.number().int().min(64).max(1048576),
      })
      .parse(body);
    const changed = await pool.query(
      "UPDATE customer_environments SET idle_minutes=$3,auto_wake=$4,storage_budget_mb=$5 WHERE id=$1 AND workspace_id=$2 AND status<>'deleted' RETURNING id",
      [b.id, workspace, b.idle_minutes, b.auto_wake, b.storage_budget_mb],
    );
    if (!changed.rowCount) throw new HttpError(404, "Umgebung fehlt.");
    await transaction((c) => audit(c, user, "environment.budget", b.id));
  }
  return {
    items: (
      await pool.query(
        "SELECT e.id,e.name,e.status,e.idle_minutes,e.auto_wake,e.storage_budget_mb,e.storage_used_bytes,e.last_activity_at,e.idle_stopped,t.cpu,t.memory_mb,e.billing_source FROM customer_environments e JOIN environment_templates t ON t.id=e.template_id WHERE e.workspace_id=$1 AND e.status<>'deleted' ORDER BY e.created_at",
        [workspace],
      )
    ).rows,
    storage_enforcement: "controller_guard",
    storage_note:
      "Schreibzugriffe und Controller-Prozesse werden überwacht. Eine harte Dateisystemquote benötigt geeignete Host-/Volume-Konfiguration.",
  };
}
export async function tickIdleEnvironments() {
  const rows = (
    await pool.query(
      "SELECT e.id,e.workspace_id,w.owner_id FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id WHERE e.status='running' AND e.idle_minutes>0 AND e.last_activity_at<now()-e.idle_minutes*interval '1 minute' ORDER BY e.last_activity_at LIMIT 30",
    )
  ).rows;
  for (const r of rows)
    try {
      const w = (
        await pool.query("SELECT * FROM workspace_context WHERE id=$1", [
          r.workspace_id,
        ])
      ).rows[0];
      const result = await customerEnvironment(
        r.owner_id,
        w,
        { id: r.id, action: "stop" },
        true,
      );
      if (!(result as { skipped?: boolean }).skipped)
        await workspaceEventNotice(
          r.workspace_id,
          "idle:" + r.id + ":" + new Date().toISOString().slice(0, 13),
          "Umgebung wegen Inaktivität gestoppt",
          "Dateien bleiben erhalten. Erneuter Start benötigt ein gültiges Kontingent.",
          "/environments",
        );
    } catch {}
}
export async function wakeEnvironment(
  taskId: string,
  lease: string,
  callId: string,
  args: unknown,
) {
  const { environment_id: id } = z
      .object({ environment_id: z.string().uuid() })
      .strict()
      .parse(args),
    operation = taskId + ":" + callId;
  const data = await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const cached = (
      await c.query(
        "SELECT status,result FROM operations WHERE id=$1 AND task_id=$2",
        [operation, taskId],
      )
    ).rows[0];
    if (cached)
      return {
        cached:
          cached.status === "done"
            ? cached.result
            : {
                result: JSON.stringify({
                  status: "check_required",
                  message:
                    "Start wurde bereits angestoßen. Zustand über list_environments prüfen.",
                }),
                yield: false,
              },
      };
    const e = (
      await c.query(
        "SELECT * FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND project_id=(SELECT project_id FROM runs WHERE id=$4) AND status<>'deleted' AND jsonb_array_length(agent_permissions)>0 AND (jsonb_array_length(agent_ids)=0 OR agent_ids ? $3)",
        [id, task.workspace_id, task.agent_id, task.run_id],
      )
    ).rows[0];
    if (!e || !e.auto_wake)
      throw new HttpError(
        403,
        "Automatischer Start ist für diese Umgebung oder diesen Agenten nicht freigegeben.",
      );
    await c.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
      operation,
      taskId,
    ]);
    return {
      e,
      workspace: (
        await c.query("SELECT * FROM workspace_context WHERE id=$1", [
          task.workspace_id,
        ])
      ).rows[0],
    };
  });
  if (data.cached) return data.cached;
  if (data.e.status !== "running" && data.e.status !== "pending")
    await customerEnvironment(
      data.workspace.owner_id,
      data.workspace,
      { id, action: "start" },
      false,
      { taskId, lease },
    );
  const output = {
    result: JSON.stringify({
      environment_id: id,
      status: data.e.status === "running" ? "running" : "starting",
      message:
        "Vor Verwendung tools_ready über list_environments prüfen. Hosting-Minuten werden separat abgerechnet.",
    }),
    yield: false,
  };
  await transaction(async (c) => {
    await lockTask(c, taskId, lease);
    await c.query("UPDATE operations SET status='done',result=$2 WHERE id=$1", [
      operation,
      JSON.stringify(output),
    ]);
  });
  return output;
}
