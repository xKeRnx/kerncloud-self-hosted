import type { PoolClient } from "pg";
import { transaction } from "./db.ts";
import { allocateAutomaticPlan } from "./plan-allowance.ts";
import { allowancePeriod } from "../core/allowance-period.ts";

// This is bookkeeping only: no provider requests, payments, invoices or emails.
// Account row locks plus (account_id,period) also protect against simultaneous
// worker maintenance, account access, admin actions and several app instances.
export async function processMonthlyAllowances(
  c: PoolClient,
  now = new Date(),
) {
  const period = allowancePeriod(now);
  const rows = (
    await c.query(
      `SELECT a.id FROM accounts a JOIN plans p ON p.id=a.plan_id JOIN users u ON u.id=a.owner_id
    WHERE a.subscription_status='active' AND a.stripe_subscription_id IS NULL AND a.access_source<>'stripe'
      AND NOT u.suspended AND p.active AND (p.credits>0 OR p.runtime_minutes>0)
      AND EXISTS(SELECT 1 FROM workspaces w WHERE w.owner_id=a.owner_id)
      AND (a.access_expires_at IS NULL OR a.access_expires_at>$1)
      AND NOT EXISTS(SELECT 1 FROM plan_allocations g WHERE g.account_id=a.id AND g.period=$2)
    ORDER BY a.id LIMIT 100 FOR UPDATE OF a SKIP LOCKED`,
      [now, period.key],
    )
  ).rows;
  for (const row of rows) await allocateAutomaticPlan(c, row.id, now);
  return rows.length;
}

let nextCheck = 0;
export async function reconcileMonthlyAllowances() {
  if (Date.now() < nextCheck) return;
  nextCheck = Date.now() + 60000;
  try {
    const count = await transaction(async (c) => {
      if (
        !(await c.query("SELECT pg_try_advisory_xact_lock(6820192044) locked"))
          .rows[0].locked
      )
        return 0;
      const last = (
        await c.query(
          "SELECT value FROM settings WHERE id='monthly_allowance_check'",
        )
      ).rows[0]?.value;
      if (last && Date.now() - Date.parse(last.ran_at) < 5000) return 0;
      const n = await processMonthlyAllowances(c);
      await c.query(
        "INSERT INTO settings(id,value) VALUES('monthly_allowance_check',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify({ ran_at: new Date().toISOString(), processed: n })],
      );
      return n;
    });
    if (count === 100) nextCheck = Date.now() + 1000;
  } catch {
    nextCheck = Date.now() + 5000;
    console.error(
      "[Billing] Monatliche Kontingente konnten nicht abgeglichen werden; erneuter Versuch folgt.",
    );
    throw new Error(
      "Monatliche Kontingentzuteilung konnte nicht abgeschlossen werden.",
    );
  }
}

export function ensureAccountAllowance(accountId: string) {
  return transaction((c) => allocateAutomaticPlan(c, accountId));
}
