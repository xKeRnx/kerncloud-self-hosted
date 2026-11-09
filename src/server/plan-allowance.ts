import { allowancePeriod } from "../core/allowance-period.ts";
import { audit } from "./db.ts";
import type { PoolClient } from "pg";
import { HttpError } from "./auth.ts";
import { accessExpired } from "../core/account-access.ts";

// The account row is locked here. Free/manual subscriptions do not create
// payments or invoices; paid Stripe subscriptions are funded by paid invoices.
export async function allocatePlan(
  c: PoolClient,
  accountId: string,
  actor: string | null,
  reason: string,
  expectedPlan: string,
  options: { automatic?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const a = (
    await c.query(
      "SELECT a.*,u.suspended,row_to_json(p) plan FROM accounts a JOIN plans p ON p.id=a.plan_id JOIN users u ON u.id=a.owner_id WHERE a.id=$1 FOR UPDATE OF a",
      [accountId],
    )
  ).rows[0];
  if (!a || a.plan_id !== expectedPlan)
    throw new HttpError(409, "Plan geändert. Bitte neu laden.");
  if (
    a.stripe_subscription_id &&
    !["canceled", "incomplete_expired"].includes(a.subscription_status)
  )
    throw new HttpError(
      409,
      "Stripe verwaltet die Plan-Kontingente. Für Kulanz die Geschenkfunktion verwenden.",
    );
  if (
    a.suspended ||
    !a.plan.active ||
    !["active", "local_test"].includes(a.subscription_status) ||
    accessExpired(a, now.getTime())
  )
    throw new HttpError(409, "Zuerst einen aktiven Plan-Zugang freischalten.");
  const window = allowancePeriod(now, a.access_expires_at);
  const period = window.key;
  const old = (
    await c.query(
      "SELECT * FROM plan_allocations WHERE account_id=$1 AND period=$2",
      [accountId, period],
    )
  ).rows[0];
  if (old) {
    if (
      a.runtime_period === `local:${period}` &&
      new Date(a.runtime_period_end ?? 0).getTime() !== window.end.getTime()
    )
      await c.query("UPDATE accounts SET runtime_period_end=$2 WHERE id=$1", [
        accountId,
        window.end,
      ]);
    if (new Date(old.period_end ?? 0).getTime() !== window.end.getTime())
      await c.query(
        "UPDATE plan_allocations SET period_end=$3 WHERE account_id=$1 AND period=$2",
        [accountId, period, window.end],
      );
    return {
      ok: true,
      existing: true,
      allocation: { ...old, period_end: window.end },
    };
  }
  const credits = options.automatic
    ? Math.min(a.plan.credits, Math.max(0, 100000000 - a.credits))
    : a.plan.credits;
  // local_test may already have received its runtime period in runtimeAccount.
  // Preserve that period and any reservations; never grant the minutes twice.
  const hasRuntime =
    a.runtime_period_end &&
    new Date(a.runtime_period_end).getTime() > now.getTime() &&
    (!options.automatic || a.runtime_period === `local:${period}`);
  const runtime = hasRuntime ? 0 : a.plan.runtime_minutes * 60;
  if (!a.plan.credits && !a.plan.runtime_minutes)
    throw new HttpError(
      409,
      "Dieser Plan enthält kein zuteilbares Kontingent.",
    );
  if (a.credits + credits > 100000000)
    throw new HttpError(409, "Guthabenlimit erreicht.");
  const end = window.end.toISOString();
  const debt = Math.min(runtime, a.runtime_debt);
  await c.query("UPDATE accounts SET credits=credits+$2 WHERE id=$1", [
    accountId,
    credits,
  ]);
  if (!hasRuntime)
    await c.query(
      "UPDATE accounts SET runtime_included=$2,runtime_allowance=$3,runtime_period=$4,runtime_plan=plan_id,runtime_period_end=$5,runtime_debt=runtime_debt-$6 WHERE id=$1",
      [accountId, runtime - debt, runtime, `local:${period}`, end, debt],
    );
  else if (
    a.runtime_period === `local:${period}` &&
    new Date(a.runtime_period_end).getTime() !== window.end.getTime()
  )
    await c.query("UPDATE accounts SET runtime_period_end=$2 WHERE id=$1", [
      accountId,
      end,
    ]);
  const id = `allowance:${accountId}:${period}`;
  const w = (
    await c.query(
      "SELECT id FROM workspaces WHERE owner_id=$1 ORDER BY created_at LIMIT 1",
      [a.owner_id],
    )
  ).rows[0];
  if (credits)
    await c.query(
      "INSERT INTO ledger(id,workspace_id,amount,reason) VALUES($1,$2,$3,$4)",
      [
        id,
        w.id,
        credits,
        `Plan-Kontingent ${period} · ${a.plan.name} · 0 EUR · ${options.automatic ? "automatisch zugeteilt" : "manuell zugeteilt"}`,
      ],
    );
  if (!hasRuntime && (runtime || a.runtime_included))
    await c.query(
      "INSERT INTO runtime_ledger(id,account_id,kind,amount,period,reason) VALUES($1,$2,$6,$3,$4,$5)",
      [
        id,
        accountId,
        runtime - debt - a.runtime_included,
        `local:${period}`,
        `Plan-Kontingent ${period} · 0 EUR · ${runtime / 60} Minuten erneuert · ${debt / 60} Minuten Korrekturausgleich`,
        options.automatic ? "automatic_plan" : "manual_plan",
      ],
    );
  const allocation = (
    await c.query(
      "INSERT INTO plan_allocations(account_id,period,plan_id,credits,runtime_seconds,actor_id,reason,source,period_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
      [
        accountId,
        period,
        a.plan_id,
        credits,
        runtime,
        actor,
        reason,
        options.automatic ? "automatic" : "manual",
        end,
      ],
    )
  ).rows[0];
  if (options.automatic)
    await audit(
      c,
      actor,
      "billing.allowance.automatic",
      `${accountId}:${period}`,
    );
  return { ok: true, existing: false, allocation };
}

// "local_test" retains the separate development-only runtime behaviour.
// Actual active non-Stripe subscriptions, including gifts, renew automatically.
export async function allocateAutomaticPlan(
  c: PoolClient,
  accountId: string,
  now = new Date(),
  actor: string | null = null,
) {
  const a = (
    await c.query(
      "SELECT a.*,u.suspended,p.active plan_active,p.credits plan_credits,p.runtime_minutes FROM accounts a JOIN users u ON u.id=a.owner_id JOIN plans p ON p.id=a.plan_id WHERE a.id=$1 FOR UPDATE OF a",
      [accountId],
    )
  ).rows[0];
  if (
    !a ||
    a.suspended ||
    !a.plan_active ||
    a.subscription_status !== "active" ||
    a.stripe_subscription_id ||
    a.access_source === "stripe" ||
    accessExpired(a, now.getTime()) ||
    (!a.plan_credits && !a.runtime_minutes)
  )
    return null;
  return allocatePlan(
    c,
    accountId,
    actor,
    "Automatisches Monatskontingent eines aktiven, manuell freigeschalteten oder verschenkten Abos; keine Zahlung",
    a.plan_id,
    { automatic: true, now },
  );
}
