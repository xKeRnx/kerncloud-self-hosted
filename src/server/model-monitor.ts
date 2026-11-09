import { pool, transaction, audit } from "./db.ts";
import { decrypt, encrypt } from "./security.ts";
import { modelCheckWindow } from "../core/model-check.ts";
import { HttpError } from "./auth.ts";

import { inspectModel } from "./model-discovery.ts";
export async function probeModel(endpoint: string, model: string, key: string) {
  return (await inspectModel(endpoint, model, key)).status;
}

export async function checkModel(workspace: string | null, id?: string) {
  const claim = await transaction(async (c) => {
    const row = (
      await c.query(
        id
          ? "SELECT * FROM model_offerings WHERE id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL FOR UPDATE"
          : `SELECT * FROM model_offerings WHERE deleted_at IS NULL AND active=true AND monitor_enabled=true
          AND (checked_at IS NULL OR checked_at<now()-interval '24 hours')
          ORDER BY checked_at NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED`,
        id ? [id, workspace] : [],
      )
    ).rows[0];
    if (!row) {
      if (id) throw new HttpError(404, "Modell nicht gefunden.");
      return null;
    }
    if (!row.active)
      throw new HttpError(
        409,
        "Dieses Modell ist deaktiviert. Aktiviere es vor der Verbindungsprüfung.",
      );
    const window = modelCheckWindow(row.checked_at);
    if (id && window.remainingSeconds > 0)
      return {
        kind: "cached" as const,
        result: {
          status: row.check_status ?? "unknown",
          checked_at: row.checked_at,
          check_performed: false,
          retry_after_seconds: window.remainingSeconds,
          next_check_at: window.nextCheckAt,
        },
      };
    // Millisecond precision makes the returned timestamp an exact fencing token in JS and PostgreSQL.
    const updated = (
      await c.query(
        `UPDATE model_offerings SET checked_at=date_trunc('milliseconds',clock_timestamp()),check_status='checking' WHERE id=$1 RETURNING checked_at`,
        [row.id],
      )
    ).rows[0];
    return {
      kind: "claimed" as const,
      model: row,
      checkedAt: updated.checked_at,
    };
  });
  if (!claim) return;
  if (claim.kind === "cached") return claim.result;
  const m = claim.model;
  const result = await inspectModel(m.endpoint, m.model, decrypt(m.secret));
  // An edit, deletion or later claim during I/O must not inherit this result.
  const updated = await pool.query(
    `UPDATE model_offerings SET check_status=$2,
    capabilities=CASE WHEN $2='available' THEN $6::jsonb ELSE capabilities END
    WHERE id=$1 AND endpoint=$3 AND model=$4 AND secret=$5 AND deleted_at IS NULL
      AND active=true AND checked_at=$7 AND check_status='checking'`,
    [
      m.id,
      result.status,
      m.endpoint,
      m.model,
      m.secret,
      JSON.stringify(result.capabilities),
      claim.checkedAt,
    ],
  );
  const window = modelCheckWindow(claim.checkedAt);
  return {
    status: updated.rowCount ? result.status : "unknown",
    check_performed: true,
    superseded: !updated.rowCount,
    checked_at: claim.checkedAt,
    retry_after_seconds: window.remainingSeconds,
    next_check_at: window.nextCheckAt,
  };
}

export async function modelAction(
  actor: string,
  workspace: string | null,
  body: unknown,
) {
  const { z } = await import("zod");
  const b = z
    .object({
      id: z.string().min(1).max(100),
      action: z.enum(["check", "remove"]),
    })
    .parse(body);
  if (b.action === "check") return checkModel(workspace, b.id);
  return transaction(async (c) => {
    const m = (
      await c.query(
        "SELECT id FROM model_offerings WHERE id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL FOR UPDATE",
        [b.id, workspace],
      )
    ).rows[0];
    if (!m) throw new HttpError(404, "Modell nicht gefunden.");
    const active = await c.query(
      `SELECT id FROM runs WHERE status NOT IN('completed','failed','canceled') AND ($1::text IS NULL OR workspace_id=$1) LIMIT 1`,
      [workspace],
    );
    if (active.rowCount)
      throw new HttpError(
        409,
        "Zuerst offene Aufträge abschließen oder abbrechen.",
      );
    await c.query(
      "UPDATE model_offerings SET active=false,deleted_at=now(),secret=$2,monitor_enabled=false WHERE id=$1",
      [b.id, encrypt("")],
    );
    await audit(
      c,
      actor,
      workspace ? "model.own.remove" : "admin.model.remove",
      b.id,
    );
    return { ok: true };
  });
}
