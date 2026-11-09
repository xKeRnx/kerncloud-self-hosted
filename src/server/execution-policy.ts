import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import type { Workspace } from "../core/types.ts";
export const hostPolicySql =
  "((e.billing_source='hosted' AND w.allow_hosted_execution AND h.customer_account_id IS NULL) OR (e.billing_source='customer' AND w.execution_host_ids ? h.id AND h.customer_account_id=a.id))";
export async function executionPolicy(
  actor: string,
  w: Workspace,
  body?: unknown,
) {
  if (body !== undefined) {
    const b = z
      .object({
        allowHosted: z.boolean(),
        hostIds: z.array(z.string().uuid()).max(100),
      })
      .parse(body);
    await transaction(async (c) => {
      const account = (
        await c.query(
          "SELECT a.id,p.max_customer_hosts FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1 FOR UPDATE OF a",
          [w.account_id],
        )
      ).rows[0];
      if (new Set(b.hostIds).size > account.max_customer_hosts)
        throw new HttpError(
          403,
          "Dein Plan erlaubt weniger ausgewählte Kunden-Rechner.",
        );
      const own = await c.query(
        "SELECT id FROM infrastructure_hosts WHERE id=ANY($1::text[]) AND customer_account_id=$2 AND enabled",
        [b.hostIds, w.account_id],
      );
      if (own.rowCount !== new Set(b.hostIds).size)
        throw new HttpError(
          403,
          "Ausführungsort gehört nicht zu deinem Konto oder ist deaktiviert.",
        );
      await c.query(
        "UPDATE workspaces SET allow_hosted_execution=$2,execution_host_ids=$3 WHERE id=$1",
        [w.id, b.allowHosted, JSON.stringify([...new Set(b.hostIds)])],
      );
      await c.query(
        `UPDATE environment_tool_calls j SET status=CASE WHEN j.status='queued' THEN 'canceled' ELSE 'uncertain' END,finished_at=now() FROM customer_environments e JOIN infrastructure_hosts h ON h.id=e.host_id JOIN workspaces w ON w.id=e.workspace_id JOIN accounts a ON a.owner_id=w.owner_id WHERE j.environment_id=e.id AND w.id=$1 AND j.status IN('queued','running') AND NOT ${hostPolicySql}`,
        [w.id],
      );
      await audit(c, actor, "workspace.execution_policy", w.id);
    });
  }
  const workspace = (
    await pool.query(
      "SELECT allow_hosted_execution,execution_host_ids FROM workspaces WHERE id=$1",
      [w.id],
    )
  ).rows[0];
  return {
    allowHosted: workspace.allow_hosted_execution,
    hostIds: workspace.execution_host_ids,
  };
}
export async function consumeModelStep(c: PoolClient, accountId: string) {
  const account = (
    await c.query(
      "SELECT a.id,a.access_expires_at,p.monthly_steps FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.id=$1 FOR UPDATE OF a",
      [accountId],
    )
  ).rows[0];
  if (
    account.access_expires_at &&
    new Date(account.access_expires_at).getTime() <= Date.now()
  )
    throw new HttpError(403, "Der KeRnCloud-Zugang ist abgelaufen.", {
      code: "INPUT_REQUIRED",
    });
  const period = new Date().toISOString().slice(0, 7);
  await c.query(
    "INSERT INTO account_step_usage(account_id,period) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [accountId, period],
  );
  const used = await c.query(
    "UPDATE account_step_usage SET used=used+1 WHERE account_id=$1 AND period=$2 AND used<$3 RETURNING used",
    [accountId, period, account.monthly_steps],
  );
  if (!used.rowCount)
    throw new HttpError(
      402,
      "Monatliches Modellschritt-Kontingent erreicht. Bitte Plan oder Auftragsumfang prüfen.",
      { code: "INPUT_REQUIRED" },
    );
}
