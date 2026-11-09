import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { transaction } from "../../src/server/db.ts";
import { snapshotRunPolicy } from "../../src/server/run-policy.ts";
import { modelStep } from "../../src/server/engine.ts";

export async function reasoningProfileTests(
  t: any,
  { request, pool, admin, foreignCookie }: any,
) {
  const calls: Record<string, any>[] = [];
  const fixture = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Local reasoning protocol fixture complete.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const address = fixture.address();
  if (!address || typeof address === "string")
    throw Error("Fixture address unavailable");
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const user = await request("auth/signup", {
    email: "reasoning-preset@test.local",
    name: "Reasoning fixture",
    password: "reasoning-profile-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(user.status, 200);
  let state = (await request("state", undefined, user.cookie)).data;
  // Explicit disposable fixture balance, never a payment or production grant.
  await pool.query(
    "UPDATE accounts SET plan_id='business',subscription_status='local_test',credits=100000 WHERE id=$1",
    [state.workspace.account_id],
  );
  state = (await request("state", undefined, user.cookie)).data;
  const ws = state.workspace.id,
    agent = state.agents[0].id;
  const config = {
    name: "Reasoning preset fixture",
    provider_name: "Local protocol fixture",
    endpoint,
    model: "generic-reasoning-fixture",
    key: "fixture-only-secret",
    active: true,
    monitor_enabled: false,
    streaming: false,
    max_output_tokens: 1024,
    input_rate: 1000,
    output_rate: 1000,
    base_credits: 0,
    reasoning_effort: "auto",
    auto_reasoning_effort: "low",
  };
  let mid = "";
  async function update(extra: Record<string, unknown>) {
    const result = await request(
      "admin/models",
      { ...config, id: mid, ...extra },
      admin.cookie,
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  async function task(creditLimit = 10000, tokenLimit = 10000) {
    const id = randomUUID(),
      tid = randomUUID(),
      lease = randomUUID();
    await transaction(async (c) => {
      const budget = await snapshotRunPolicy(c, ws, [mid]);
      await c.query(
        "INSERT INTO runs(id,workspace_id,goal,max_steps,credit_limit,token_limit,model_policy) VALUES($1,$2,'Local reasoning protocol fixture',5,$3,$4,$5)",
        [id, ws, creditLimit, tokenLimit, JSON.stringify(budget.policy)],
      );
      await c.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until,model_id) VALUES($1,$2,$3,$4,'Reasoning fixture','Local fixture','running',$5,now()+interval '10 minutes',$6)",
        [tid, id, ws, agent, lease, mid],
      );
    });
    return { id, tid, lease };
  }
  async function invoke() {
    const f = await task();
    try {
      const message = await modelStep(
        f.tid,
        f.lease,
        [
          { role: "system", content: "Local protocol fixture" },
          { role: "user", content: "Return the short fixture response." },
        ],
        [],
      );
      assert.ok(message, "The local model fixture must return a response");
      assert.match(message.content ?? "", /protocol fixture complete/);
      const call = (
        await pool.query(
          "SELECT reserved,budget_tokens,charged_credits,tokens,usage_known FROM model_calls WHERE run_id=$1",
          [f.id],
        )
      ).rows[0];
      assert.ok(call.reserved <= 10000 && call.budget_tokens <= 10000);
      assert.equal(call.usage_known, true);
      assert.equal(call.tokens, 15);
      assert.equal(call.charged_credits, 15);
      const run = (
        await pool.query(
          "SELECT credit_limit,token_limit FROM runs WHERE id=$1",
          [f.id],
        )
      ).rows[0];
      assert.deepEqual(run, { credit_limit: 10000, token_limit: 10000 });
      assert.ok(calls.at(-1)!.max_completion_tokens <= 1024);
      return calls.at(-1)!;
    } finally {
      await pool.query(
        "UPDATE tasks SET status='completed',lease_token=NULL WHERE id=$1",
        [f.tid],
      );
      await pool.query("UPDATE runs SET status='completed' WHERE id=$1", [
        f.id,
      ]);
    }
  }
  try {
    await t.test(
      "Model automation presets persist per model, reject invalid values and enforce admin/tenant ownership",
      async () => {
        const saved = await request("admin/models", config, admin.cookie);
        assert.equal(saved.status, 200);
        mid = saved.data.id;
        const list = (await request("admin", undefined, admin.cookie)).data
          .models;
        assert.equal(
          list.find((m: any) => m.id === mid).auto_reasoning_effort,
          "low",
        );
        assert.ok(!JSON.stringify(list).includes(config.key));
        const visible = (
          await request("state", undefined, user.cookie)
        ).data.models.find((m: any) => m.id === mid);
        assert.equal(visible.auto_reasoning_effort, "low");
        assert.equal(visible.endpoint, undefined);
        assert.equal(
          (
            await request(
              "admin/models",
              { ...config, id: mid, auto_reasoning_effort: "high" },
              foreignCookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "models",
              { ...config, id: mid, auto_reasoning_effort: "high" },
              foreignCookie,
            )
          ).status,
          403,
        );
        for (const invalid of ["auto", "unsupported", null])
          assert.equal(
            (
              await request(
                "admin/models",
                { ...config, id: mid, auto_reasoning_effort: invalid },
                admin.cookie,
              )
            ).status,
            400,
          );
        const { auto_reasoning_effort, key, ...oldClient } = {
          ...config,
          id: mid,
        };
        const secret = (
          await pool.query("SELECT secret FROM model_offerings WHERE id=$1", [
            mid,
          ])
        ).rows[0].secret;
        assert.equal(
          (await request("admin/models", oldClient, admin.cookie)).status,
          200,
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT auto_reasoning_effort,secret FROM model_offerings WHERE id=$1",
              [mid],
            )
          ).rows[0],
          { auto_reasoning_effort: "low", secret },
        );
        const second = await request(
          "models",
          {
            name: "Independent preset",
            provider_name: "Local fixture",
            endpoint,
            model: "different-fixture",
            monitor_enabled: false,
          },
          user.cookie,
        );
        assert.equal(second.status, 200);
        assert.equal(
          (
            await pool.query(
              "SELECT auto_reasoning_effort FROM model_offerings WHERE id=$1",
              [second.data.id],
            )
          ).rows[0].auto_reasoning_effort,
          "provider_default",
        );
        await pool.query(readFileSync("src/server/migrations/023.sql", "utf8"));
        assert.equal(
          (
            await pool.query(
              "SELECT auto_reasoning_effort FROM model_offerings WHERE id=$1",
              [mid],
            )
          ).rows[0].auto_reasoning_effort,
          "low",
        );
      },
    );
    await t.test(
      "Actual model requests use saved automatic effort; manual/provider-default selections override it",
      async () => {
        assert.equal((await invoke()).reasoning_effort, "low");
        await update({ reasoning_effort: "high" });
        assert.equal((await invoke()).reasoning_effort, "high");
        await update({ reasoning_effort: "provider_default" });
        assert.equal((await invoke()).reasoning_effort, undefined);
        await update({
          reasoning_effort: "auto",
          auto_reasoning_effort: "provider_default",
        });
        assert.equal((await invoke()).reasoning_effort, undefined);
      },
    );
    await t.test(
      "Reasoning presets never enlarge the fixed task credit budget or cause an over-budget provider request",
      async () => {
        await update({
          reasoning_effort: "auto",
          auto_reasoning_effort: "max",
        });
        const f = await task(0);
        const count = calls.length;
        const credits = (
          await pool.query("SELECT credits FROM accounts WHERE id=$1", [
            state.workspace.account_id,
          ])
        ).rows[0].credits;
        try {
          await assert.rejects(
            modelStep(
              f.tid,
              f.lease,
              [
                {
                  role: "user",
                  content: "This must not trigger a model request.",
                },
              ],
              [],
            ),
            (error: any) => error.details?.code === "INPUT_REQUIRED",
          );
          assert.equal(calls.length, count);
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int n FROM model_calls WHERE run_id=$1",
                [f.id],
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (
              await pool.query("SELECT credits FROM accounts WHERE id=$1", [
                state.workspace.account_id,
              ])
            ).rows[0].credits,
            credits,
          );
          assert.deepEqual(
            (
              await pool.query(
                "SELECT credit_limit,token_limit FROM runs WHERE id=$1",
                [f.id],
              )
            ).rows[0],
            { credit_limit: 0, token_limit: 10000 },
          );
        } finally {
          await pool.query(
            "UPDATE tasks SET status='canceled',lease_token=NULL WHERE id=$1",
            [f.tid],
          );
          await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [
            f.id,
          ]);
        }
      },
    );
  } finally {
    if (mid)
      await pool.query("UPDATE model_offerings SET active=false WHERE id=$1", [
        mid,
      ]);
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
