import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { providerBackoff } from "../core/provider-health.ts";
function identity(model: any) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        model.id,
        model.endpoint,
        model.model,
        model.secret ?? "",
      ]),
    )
    .digest("hex");
}
export async function providerCooldown(c: PoolClient, model: any) {
  const row = (
    await c.query(
      "SELECT cooldown_until,reason FROM provider_health WHERE id=$1 AND cooldown_until>now()",
      [identity(model)],
    )
  ).rows[0];
  return row
    ? {
        ...row,
        seconds: Math.max(
          1,
          Math.ceil((Date.parse(row.cooldown_until) - Date.now()) / 1000),
        ),
      }
    : null;
}
export async function recordProviderFailure(
  c: PoolClient,
  model: any,
  reason: string,
  retryAfter = 1,
) {
  const id = identity(model);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
  const old = (
    await c.query(
      "SELECT failures FROM provider_health WHERE id=$1 AND updated_at>now()-interval '1 hour'",
      [id],
    )
  ).rows[0];
  const failures = Math.min(20, Number(old?.failures ?? 0) + 1),
    seconds = providerBackoff(reason, failures, retryAfter);
  await c.query(
    "INSERT INTO provider_health(id,model_id,workspace_id,cooldown_until,reason,failures) VALUES($1,$2,$3,now()+$4*interval '1 second',$5,$6) ON CONFLICT(id) DO UPDATE SET cooldown_until=GREATEST(provider_health.cooldown_until,EXCLUDED.cooldown_until),reason=EXCLUDED.reason,failures=EXCLUDED.failures,updated_at=now()",
    [id, model.id, model.workspace_id ?? null, seconds, reason, failures],
  );
}
export async function recordProviderSuccess(
  c: PoolClient,
  model: any,
  started: number,
) {
  await c.query(
    "DELETE FROM provider_health WHERE id=$1 AND updated_at<=to_timestamp($2/1000.0)",
    [identity(model), started],
  );
}
