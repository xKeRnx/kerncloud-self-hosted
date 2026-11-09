import { transaction } from "./db.ts";
// Presentation and lease cleanup; authorization also checks the timestamp on every action.
export async function expireCustomerAccess() {
  return transaction(async (c) => {
    const runs = (
      await c.query(
        "UPDATE runs r SET status='paused',updated_at=now() FROM workspaces w JOIN accounts a ON a.owner_id=w.owner_id WHERE r.workspace_id=w.id AND r.status='running' AND a.access_expires_at<=now() RETURNING r.id,r.workspace_id",
      )
    ).rows;
    if (!runs.length) return;
    for (const r of runs) {
      await c.query(
        "UPDATE tasks SET status=CASE WHEN EXISTS(SELECT 1 FROM operations o WHERE o.task_id=tasks.id AND o.status<>'done') THEN 'input_required' ELSE 'queued' END,error='KeRnCloud-Zugang abgelaufen. Vor Fortsetzung Plan und externe Aktionen prüfen.',lease_token=NULL,worker_id=NULL,lease_until=NULL WHERE run_id=$1 AND status='running'",
        [r.id],
      );
      await c.query(
        "INSERT INTO events(workspace_id,run_id,kind,content) VALUES($1,$2,'access_expired','Zugang abgelaufen; Auftrag angehalten.')",
        [r.workspace_id, r.id],
      );
    }
  });
}
