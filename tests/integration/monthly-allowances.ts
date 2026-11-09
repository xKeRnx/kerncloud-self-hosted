import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  allocateAutomaticPlan,
  allocatePlan,
} from "../../src/server/plan-allowance.ts";
import { processMonthlyAllowances } from "../../src/server/monthly-allowances.ts";
import { transaction } from "../../src/server/db.ts";

export async function monthlyAllowanceTests(
  t: any,
  { request, pool, admin }: any,
) {
  const signed = await request("auth/signup", {
    name: "Monthly allowance fixture",
    email: "monthly-allowance@test.local",
    password: "monthly-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(signed.status, 200);
  const state = (await request("state", undefined, signed.cookie)).data,
    id = state.workspace.account_id;
  const actor = (await request("state", undefined, admin.cookie)).data.user.id;
  const plan = (await pool.query("SELECT * FROM plans WHERE id='starter'"))
    .rows[0];
  const jan = new Date("2030-01-31T23:59:59Z"),
    feb = new Date("2030-02-01T00:00:00Z");
  async function isolated(fn: (c: any) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [id]);
      await c.query(
        "UPDATE accounts SET plan_id='starter',subscription_status='active',access_source='manual',access_expires_at='2030-12-31',credits=5000,runtime_purchased=600,runtime_debt=60 WHERE id=$1",
        [id],
      );
      await fn(c);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }
  const balance = async (c: any) =>
    (await c.query("SELECT * FROM accounts WHERE id=$1", [id])).rows[0];
  await t.test(
    "Month turnover adds plan credits once, replaces included minutes and preserves extra credit",
    () =>
      isolated(async (c) => {
        const first = await allocateAutomaticPlan(c, id, jan);
        assert.equal(first?.existing, false);
        const a = await balance(c);
        assert.equal(a.credits, 5000 + plan.credits);
        assert.equal(a.runtime_included, plan.runtime_minutes * 60 - 60);
        assert.equal(a.runtime_debt, 0);
        assert.equal(a.runtime_purchased, 600);
        await c.query(
          "UPDATE accounts SET credits=credits-20,runtime_included=runtime_included-120 WHERE id=$1",
          [id],
        );
        const second = await allocateAutomaticPlan(c, id, feb);
        assert.equal(second?.existing, false);
        const b = await balance(c);
        assert.equal(b.credits, 5000 + 2 * plan.credits - 20);
        assert.equal(b.runtime_included, plan.runtime_minutes * 60);
        assert.equal(b.runtime_purchased, 600);
        assert.equal((await allocateAutomaticPlan(c, id, feb))?.existing, true);
        assert.equal(
          (
            await allocatePlan(
              c,
              id,
              actor,
              "Manual reconciliation fixture",
              "starter",
              { now: feb },
            )
          ).existing,
          true,
        );
        assert.equal((await balance(c)).credits, b.credits);
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int n FROM plan_allocations WHERE account_id=$1",
              [id],
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (
            await c.query(
              "SELECT sum(amount)::int n FROM runtime_ledger WHERE account_id=$1",
              [id],
            )
          ).rows[0].n,
          plan.runtime_minutes * 60 + 120,
        ); // test spend is simulated outside ledger
      }),
  );
  await t.test(
    "Gift renews until its exact expiry; one-off gifts and purchased minutes are not repeated",
    () =>
      isolated(async (c) => {
        await c.query(
          "UPDATE accounts SET access_source='gift',access_expires_at='2030-02-15T12:00:00Z' WHERE id=$1",
          [id],
        );
        await allocateAutomaticPlan(c, id, jan);
        await allocateAutomaticPlan(c, id, feb);
        const a = await balance(c);
        assert.equal(a.credits, 5000 + 2 * plan.credits);
        assert.equal(a.runtime_purchased, 600);
        assert.equal(
          a.runtime_period_end.toISOString(),
          "2030-02-15T12:00:00.000Z",
        );
        assert.equal(
          await allocateAutomaticPlan(c, id, new Date("2030-02-15T12:00:00Z")),
          null,
        );
        assert.equal(
          await allocateAutomaticPlan(c, id, new Date("2030-03-01T00:00:00Z")),
          null,
        );
        assert.equal((await balance(c)).credits, a.credits);
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int n FROM invoices WHERE account_id=$1",
              [id],
            )
          ).rows[0].n,
          0,
        );
      }),
  );
  await t.test(
    "Expiry exactly at month start prevents that month's allocation",
    () =>
      isolated(async (c) => {
        await c.query(
          "UPDATE accounts SET access_source='gift',access_expires_at=$2 WHERE id=$1",
          [id, feb],
        );
        await allocateAutomaticPlan(c, id, jan);
        const credits = (await balance(c)).credits;
        assert.equal(await allocateAutomaticPlan(c, id, feb), null);
        assert.equal((await balance(c)).credits, credits);
      }),
  );
  await t.test(
    "No renewal for suspended, canceled, unpaid, inactive plans or Stripe-funded accounts",
    () =>
      isolated(async (c) => {
        for (const status of [
          "free",
          "canceled",
          "past_due",
          "unpaid",
          "local_test",
        ]) {
          await c.query(
            "UPDATE accounts SET subscription_status=$2 WHERE id=$1",
            [id, status],
          );
          assert.equal(await allocateAutomaticPlan(c, id, jan), null);
        }
        await c.query(
          "UPDATE accounts SET subscription_status='active',stripe_subscription_id=$2 WHERE id=$1",
          [id, "sub_monthly_" + randomUUID()],
        );
        assert.equal(await allocateAutomaticPlan(c, id, jan), null);
        await c.query(
          "UPDATE accounts SET stripe_subscription_id=NULL WHERE id=$1",
          [id],
        );
        await c.query("UPDATE users SET suspended=true WHERE id=$1", [
          state.user.id,
        ]);
        assert.equal(await allocateAutomaticPlan(c, id, jan), null);
        await c.query("UPDATE users SET suspended=false WHERE id=$1", [
          state.user.id,
        ]);
        await c.query("UPDATE plans SET active=false WHERE id='starter'");
        assert.equal(await allocateAutomaticPlan(c, id, jan), null);
        assert.equal((await balance(c)).credits, 5000);
      }),
  );
  await t.test(
    "Missed runs catch up only the current period; upgrade and replay never multiply grants",
    () =>
      isolated(async (c) => {
        await allocateAutomaticPlan(c, id, jan);
        await c.query("UPDATE accounts SET plan_id='business' WHERE id=$1", [
          id,
        ]);
        assert.equal((await allocateAutomaticPlan(c, id, jan))?.existing, true);
        const next = (await c.query("SELECT * FROM plans WHERE id='business'"))
          .rows[0];
        await allocateAutomaticPlan(c, id, new Date("2030-04-12T00:00:00Z"));
        assert.equal(
          (await balance(c)).credits,
          5000 + plan.credits + next.credits,
        );
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int n FROM plan_allocations WHERE account_id=$1",
              [id],
            )
          ).rows[0].n,
          2,
        );
      }),
  );
  await t.test(
    "Scheduler renews accounts without customer visits and retries a rolled-back run safely",
    () =>
      isolated(async (c) => {
        await c.query("SAVEPOINT allocation_start");
        await processMonthlyAllowances(c, jan);
        assert.equal((await balance(c)).credits, 5000 + plan.credits);
        await c.query("ROLLBACK TO SAVEPOINT allocation_start");
        assert.equal((await balance(c)).credits, 5000);
        await processMonthlyAllowances(c, jan);
        await processMonthlyAllowances(c, jan);
        assert.equal((await balance(c)).credits, 5000 + plan.credits);
        await processMonthlyAllowances(c, feb);
        assert.equal((await balance(c)).credits, 5000 + 2 * plan.credits);
      }),
  );
  await t.test(
    "Changing a gift expiry within the month adjusts validity without refilling it",
    () =>
      isolated(async (c) => {
        const start = new Date("2030-01-20T00:00:00Z");
        await c.query(
          "UPDATE accounts SET access_source='gift',access_expires_at='2030-01-25T00:00:00Z' WHERE id=$1",
          [id],
        );
        await allocateAutomaticPlan(c, id, start);
        const before = await balance(c);
        await c.query(
          "UPDATE accounts SET access_expires_at='2030-02-15T00:00:00Z' WHERE id=$1",
          [id],
        );
        assert.equal(
          (await allocateAutomaticPlan(c, id, start))?.existing,
          true,
        );
        assert.equal(
          (await balance(c)).runtime_period_end.toISOString(),
          "2030-02-01T00:00:00.000Z",
        );
        await c.query(
          "UPDATE accounts SET access_expires_at='2030-01-23T00:00:00Z' WHERE id=$1",
          [id],
        );
        await allocateAutomaticPlan(c, id, start);
        const after = await balance(c);
        assert.equal(
          after.runtime_period_end.toISOString(),
          "2030-01-23T00:00:00.000Z",
        );
        assert.equal(after.credits, before.credits);
        assert.equal(after.runtime_included, before.runtime_included);
      }),
  );
  await t.test(
    "Runtime-only plans preserve already allocated minutes and apply the gift's earlier expiry",
    () =>
      isolated(async (c) => {
        await c.query("UPDATE plans SET credits=0 WHERE id='starter'");
        await c.query(
          "UPDATE accounts SET access_source='gift',access_expires_at='2030-01-25',runtime_period='local:2030-01',runtime_period_end='2030-02-01',runtime_included=12000,runtime_allowance=18000,runtime_debt=0 WHERE id=$1",
          [id],
        );
        const r = await allocateAutomaticPlan(
          c,
          id,
          new Date("2030-01-20T00:00:00Z"),
        );
        assert.equal(r?.allocation.runtime_seconds, 0);
        const a = await balance(c);
        assert.equal(a.credits, 5000);
        assert.equal(a.runtime_included, 12000);
        assert.equal(
          a.runtime_period_end.toISOString(),
          "2030-01-25T00:00:00.000Z",
        );
      }),
  );
  await t.test(
    "Simultaneous workers, account access and manual reconciliation share one allocation",
    async () => {
      await pool.query(
        "UPDATE accounts SET plan_id='starter',subscription_status='active',access_source='manual',access_expires_at=NULL WHERE id=$1",
        [id],
      );
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          transaction(async (c) =>
            i % 2
              ? allocateAutomaticPlan(c, id)
              : allocatePlan(
                  c,
                  id,
                  actor,
                  "Concurrent reconciliation fixture",
                  "starter",
                ),
          ),
        ),
      );
      const a = await pool.query("SELECT * FROM accounts WHERE id=$1", [id]);
      assert.equal(a.rows[0].credits, plan.credits);
      assert.equal(a.rows[0].runtime_included, plan.runtime_minutes * 60);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM plan_allocations WHERE account_id=$1",
            [id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query("SELECT count(*)::int n FROM ledger WHERE id=$1", [
            `allowance:${id}:${new Date().toISOString().slice(0, 7)}`,
          ])
        ).rows[0].n,
        1,
      );
    },
  );
}
