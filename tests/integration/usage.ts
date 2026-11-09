import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
export async function usageTests(
  t: any,
  { request, pool, handle, admin }: any,
) {
  const signup = async (email: string) =>
    request("auth/signup", {
      name: "Usage fixture",
      email,
      password: "usage-fixture-password",
      privacyAccepted: true,
    });
  const user = await signup("usage-one@test.local"),
    other = await signup("usage-two@test.local");
  assert.equal(user.status, 200);
  assert.equal(other.status, 200);
  const state = (await request("state", undefined, user.cookie)).data,
    foreign = (await request("state", undefined, other.cookie)).data;
  const account = state.workspace.account_id,
    w = state.workspace.id,
    agent = state.agents[0].id;
  const raw = async (q: string, cookie = user.cookie) => {
    const res = await handle(
      new NextRequest(`http://localhost:3100/api/usage?${q}`, {
        headers: { cookie },
      }),
      "usage",
    );
    return { status: res.status, data: await res.json(), headers: res.headers };
  };
  const mutate = (action: string, extra: any = {}) =>
    request(
      "admin/customers/" + state.user.id,
      {
        action,
        reason: "Explicit local usage fixture allocation",
        proof: { password: "integration-admin-password", code: "" },
        ...extra,
      },
      admin.cookie,
    );
  await t.test(
    "Active plan access allocates automatically once per account/month, without a fake payment",
    async () => {
      const plan = (await pool.query("SELECT * FROM plans WHERE id='business'"))
        .rows[0];
      assert.equal(
        (
          await mutate("subscription", {
            planId: plan.id,
            status: "active",
            until: null,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await pool.query("SELECT credits FROM accounts WHERE id=$1", [
            account,
          ])
        ).rows[0].credits,
        plan.credits,
      );
      const first = await mutate("allowance", { planId: plan.id });
      assert.equal(first.status, 200, first.data.error);
      assert.equal(first.data.existing, true);
      const a = (
        await pool.query("SELECT * FROM accounts WHERE id=$1", [account])
      ).rows[0];
      assert.equal(a.credits, plan.credits);
      assert.equal(a.runtime_included, plan.runtime_minutes * 60);
      await pool.query(
        "UPDATE accounts SET credits=credits-17,runtime_included=runtime_included-60 WHERE id=$1",
        [account],
      );
      const second = await mutate("allowance", { planId: plan.id });
      assert.equal(second.status, 200);
      assert.equal(second.data.existing, true);
      assert.equal(
        (
          await mutate("subscription", {
            planId: plan.id,
            status: "active",
            until: null,
          })
        ).status,
        200,
      );
      const b = (
        await pool.query("SELECT * FROM accounts WHERE id=$1", [account])
      ).rows[0];
      assert.equal(b.credits, plan.credits - 17);
      assert.equal(b.runtime_included, a.runtime_included - 60);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM invoices WHERE account_id=$1",
            [account],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM plan_allocations WHERE account_id=$1",
            [account],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM customer_notes WHERE user_id=$1 AND content LIKE 'allowance:%'",
            [state.user.id],
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (
          await request(
            "admin/customers/" + state.user.id,
            {
              action: "allowance",
              planId: plan.id,
              reason: "not an administrator",
            },
            user.cookie,
          )
        ).status,
        403,
      );
    },
  );
  await t.test(
    "Usage aggregates preserve unknown metrics, distinguish BYOK and managed and isolate every filter",
    async () => {
      const run = randomUUID(),
        task = randomUUID(),
        model = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,workspace_id,goal,status,max_steps) VALUES($1,$2,'Usage fixture','completed',20)",
        [run, w],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status) VALUES($1,$2,$3,$4,'Usage fixture','Fixture','done')",
        [task, run, w, agent],
      );
      for (const row of [
        {
          managed: true,
          status: "settled",
          known: true,
          tokens: 150,
          credits: 12,
          duration: 2000,
          cache: 80,
          input: 100,
          age: "5 minutes",
        },
        {
          managed: false,
          status: "settled",
          known: true,
          tokens: 50,
          credits: 0,
          duration: null,
          cache: null,
          input: null,
          age: "10 minutes",
        },
        {
          managed: true,
          status: "uncertain",
          known: false,
          tokens: 0,
          credits: 20,
          duration: 3000,
          cache: null,
          input: null,
          age: "15 minutes",
        },
        {
          managed: true,
          status: "reserved",
          known: false,
          tokens: 0,
          credits: 0,
          duration: null,
          cache: null,
          input: null,
          age: "1 minute",
        },
        {
          managed: false,
          status: "settled",
          known: true,
          tokens: 999,
          credits: 0,
          duration: null,
          cache: null,
          input: null,
          age: "400 days",
        },
      ])
        await pool.query(
          "INSERT INTO model_calls(id,workspace_id,run_id,task_id,account_id,model_id,model_name,provider_name,reserved,managed,status,tokens,usage_known,charged_credits,duration_ms,cached_tokens,cache_input_tokens,created_at) VALUES($1,$2,$3,$4,$5,$6,'Fixture model','Fixture provider',20,$7,$8,$9,$10,$11,$12,$13,$14,now()-$15::interval)",
          [
            randomUUID(),
            w,
            run,
            task,
            account,
            model,
            row.managed,
            row.status,
            row.tokens,
            row.known,
            row.credits,
            row.duration,
            row.cache,
            row.input,
            row.age,
          ],
        );
      const all = await raw("range=24h");
      assert.equal(all.status, 200, all.data.error);
      assert.match(all.headers.get("cache-control") ?? "", /no-store/);
      const totals = all.data.totals;
      assert.equal(totals.requests, 4);
      assert.equal(totals.tokens, 200);
      assert.equal(totals.credits, 32);
      assert.equal(totals.reserved, 20);
      assert.equal(totals.unknown_usage, 2);
      assert.equal(totals.cache_reports, 1);
      assert.equal(totals.cached_tokens, 80);
      assert.equal(totals.duration_ms, 2500);
      assert.equal(
        (await raw("range=24h&source=byok")).data.totals.requests,
        1,
      );
      assert.equal(
        (await raw("range=24h&model=" + model)).data.totals.requests,
        4,
      );
      assert.equal(
        (await raw("range=24h&model=no-match")).data.totals.requests,
        0,
      );
      assert.equal(
        (await raw("range=24h&workspace=" + foreign.workspace.id)).status,
        403,
      );
      assert.equal(
        (await raw("range=24h", other.cookie)).data.totals.requests,
        0,
      );
      assert.ok(
        !(await raw("range=24h", other.cookie)).data.options.some(
          (m: any) => m.name === "Fixture model",
        ),
      );
      assert.equal((await raw("range=24h&page=2")).data.calls.length, 0);
      assert.equal(
        (
          await raw(
            "range=custom&from=2026-01-01T00:00:00Z&to=2020-01-01T00:00:00Z",
          )
        ).status,
        400,
      );
      assert.equal((await raw("range=24h", "")).status, 401);
      assert.ok(!JSON.stringify(all.data).includes("Usage fixture allocation")); // internal grant reason is private
      assert.ok(!("messages" in all.data.calls[0]));
    },
  );
  await t.test(
    "Runtime already granted to a local test plan is not granted twice",
    async () => {
      await pool.query(
        "UPDATE accounts SET plan_id='business',subscription_status='local_test' WHERE id=$1",
        [foreign.workspace.account_id],
      );
      await request("runtime", undefined, other.cookie);
      const before = (
        await pool.query("SELECT runtime_included FROM accounts WHERE id=$1", [
          foreign.workspace.account_id,
        ])
      ).rows[0].runtime_included;
      const r = await request(
        "admin/customers/" + foreign.user.id,
        {
          action: "allowance",
          planId: "business",
          reason: "Existing local runtime allocation fixture",
          proof: { password: "integration-admin-password", code: "" },
        },
        admin.cookie,
      );
      assert.equal(r.status, 200, r.data.error);
      assert.equal(r.data.allocation.runtime_seconds, 0);
      assert.equal(
        (
          await pool.query(
            "SELECT runtime_included FROM accounts WHERE id=$1",
            [foreign.workspace.account_id],
          )
        ).rows[0].runtime_included,
        before,
      );
    },
  );
}
