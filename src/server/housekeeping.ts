import { transaction } from "./db.ts";
let nextCheck = 0;
export async function housekeeping() {
  if (Date.now() < nextCheck) return;
  nextCheck = Date.now() + 3600000;
  try {
    await transaction(async (c) => {
      if (
        !(
          await c.query(
            "SELECT pg_try_advisory_xact_lock(6820192028) AS locked",
          )
        ).rows[0].locked
      )
        return;
      const last = (
        await c.query("SELECT value FROM settings WHERE id='maintenance'")
      ).rows[0]?.value;
      if (last && Date.now() - Date.parse(last.ran_at) < 3600000) return;
      await c.query(
        "DELETE FROM runs r USING workspaces w WHERE r.workspace_id=w.id AND r.status IN('completed','failed','canceled') AND r.created_at<now()-(w.retention_days*interval '1 day')",
      );
      await c.query(
        "DELETE FROM chat_messages m USING workspaces w WHERE m.workspace_id=w.id AND m.created_at<now()-(w.retention_days*interval '1 day') AND(m.run_id IS NULL OR NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=m.run_id AND r.status IN('running','paused','input_required')))",
      );
      await c.query(
        "DELETE FROM attachments a USING workspaces w WHERE a.workspace_id=w.id AND a.created_at<now()-(w.retention_days*interval '1 day') AND NOT EXISTS(SELECT 1 FROM run_attachments r WHERE r.attachment_id=a.id)",
      );
      await c.query(
        "DELETE FROM memories m USING workspaces w WHERE m.workspace_id=w.id AND m.automatic=true AND m.pinned=false AND m.updated_at<now()-(w.retention_days*interval '1 day')",
      );
      await c.query(
        "UPDATE environment_tool_calls SET status='canceled',finished_at=now() WHERE requested_by IS NOT NULL AND status='queued' AND created_at<now()-interval '2 minutes'",
      );
      await c.query(
        "DELETE FROM checkpoint_restores WHERE created_at<now()-interval '10 minutes'",
      );
      await c.query(
        "DELETE FROM environment_tool_calls WHERE requested_by IS NOT NULL AND created_at<now()-interval '30 days' AND status NOT IN('queued','running')",
      );
      await c.query(
        "DELETE FROM model_deltas WHERE created_at<now()-interval '10 minutes'",
      );
      await c.query(
        "DELETE FROM automation_triggers t USING automations a,workspaces w WHERE t.automation_id=a.id AND a.workspace_id=w.id AND t.created_at<now()-w.retention_days*interval '1 day' AND t.status IN('started','blocked','uncertain') AND (t.run_id IS NULL OR NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=t.run_id AND r.status IN('running','paused','input_required')))",
      );
      await c.query(
        "DELETE FROM provider_health WHERE cooldown_until<now()-interval '1 day'",
      );
      await c.query(
        "DELETE FROM password_resets WHERE expires_at<now()-interval '1 day'",
      );
      await c.query(
        "DELETE FROM support_sessions WHERE expires_at<now()-interval '30 days'",
      );
      await c.query(
        "UPDATE mail_outbox SET payload=NULL,status=CASE WHEN status='sending' THEN 'uncertain' ELSE 'canceled' END,finished_at=now() WHERE payload IS NOT NULL AND expires_at<now()",
      );
      await c.query(
        "DELETE FROM mail_outbox WHERE created_at<now()-interval '30 days'",
      );
      await c.query(
        "DELETE FROM self_hosted_interests WHERE expires_at<=now()",
      );
      const site = (await c.query("SELECT value FROM settings WHERE id='site'"))
        .rows[0]?.value;
      await c.query(
        "DELETE FROM analytics_events WHERE created_at<now()-($1*interval '1 day')",
        [site?.analyticsRetention ?? 30],
      );
      await c.query(
        "INSERT INTO settings(id,value) VALUES('maintenance',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify({ ran_at: new Date().toISOString() })],
      );
    });
  } catch {
    nextCheck = Date.now() + 60000;
    console.error(
      "[Maintenance] Aufbewahrungsbereinigung konnte nicht abgeschlossen werden.",
    );
  }
}
