import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { z } from "zod";
export async function controlExecution(
  actor: string,
  workspaceId: string,
  body: unknown,
) {
  const b = z
    .object({
      action: z.enum(["stop", "resume"]),
      agentId: z.string().uuid().optional(),
    })
    .parse(body);
  await transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ]);
    const paused = b.action === "stop";
    if (b.agentId) {
      const changed = await c.query(
        "UPDATE agents SET execution_paused=$3 WHERE id=$1 AND workspace_id=$2 RETURNING id",
        [b.agentId, workspaceId, paused],
      );
      if (!changed.rowCount)
        throw new HttpError(404, "Agent fehlt in diesem Workspace.");
    } else {
      await c.query("UPDATE workspaces SET execution_paused=$2 WHERE id=$1", [
        workspaceId,
        paused,
      ]);
      await c.query(
        paused
          ? "UPDATE runs SET status='paused',paused_by_workspace=true,updated_at=now() WHERE workspace_id=$1 AND status='running'"
          : "UPDATE runs SET status='running',paused_by_workspace=false,updated_at=now() WHERE workspace_id=$1 AND status='paused' AND paused_by_workspace",
        [workspaceId],
      );
    }
    if (paused) {
      // External operations already sent cannot be undone. Keep their journal and require review on resume.
      await c.query(
        "UPDATE tasks t SET status=CASE WHEN EXISTS(SELECT 1 FROM operations o WHERE o.task_id=t.id AND o.status<>'done') THEN 'input_required' ELSE 'queued' END,error=CASE WHEN EXISTS(SELECT 1 FROM operations o WHERE o.task_id=t.id AND o.status<>'done') THEN 'Externe Aktion wurde unterbrochen; Ergebnis vor Fortsetzen prüfen.' ELSE error END,lease_token=NULL,worker_id=NULL,lease_until=NULL WHERE workspace_id=$1 AND status='running' AND ($2::text IS NULL OR agent_id=$2)",
        [workspaceId, b.agentId ?? null],
      );
    }
    await c.query(
      "INSERT INTO events(workspace_id,agent_id,kind,content) VALUES($1,$2,'execution_control',$3)",
      [
        workspaceId,
        b.agentId ?? null,
        `${b.agentId ? "Agent" : "Workspace"} ${paused ? "gestoppt" : "fortgesetzt"}.`,
      ],
    );
    await audit(c, actor, `execution.${b.action}`, b.agentId ?? workspaceId);
  });
  return { ok: true };
}
export async function executionSignal(taskId: string, lease: string) {
  const controller = new AbortController();
  let checking = false;
  const check = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const r = await pool.query(
        "SELECT 1 FROM tasks t JOIN runs r ON r.id=t.run_id JOIN agents a ON a.id=t.agent_id JOIN workspaces w ON w.id=t.workspace_id JOIN users u ON u.id=w.owner_id JOIN accounts ac ON ac.owner_id=w.owner_id WHERE (ac.access_expires_at IS NULL OR ac.access_expires_at>now()) AND t.id=$1 AND t.lease_token=$2 AND t.lease_until>now() AND t.status='running' AND r.status='running' AND (r.plan_item_id IS NULL OR kc_plan_ready(r.plan_item_id)) AND (t.plan_item_id IS NULL OR kc_plan_ready(t.plan_item_id)) AND EXISTS(SELECT 1 FROM workspace_projects p WHERE p.id=r.project_id AND p.status='active') AND kc_project_agent(r.project_id,a.id) AND NOT a.execution_paused AND NOT w.execution_paused AND NOT u.suspended",
        [taskId, lease],
      );
      if (!r.rowCount) controller.abort(new Error("Ausführung gestoppt."));
    } catch {
      controller.abort(new Error("Ausführungsstatus nicht prüfbar."));
    } finally {
      checking = false;
    }
  };
  await check();
  const timer = setInterval(() => void check(), 300);
  timer.unref();
  return { signal: controller.signal, close: () => clearInterval(timer) };
}
