import { calculateModelTariff } from "../../src/core/model-tariff.ts";
import { creditCost } from "../../src/core/pricing.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { transaction } from "../../src/server/db.ts";
import { validateModel } from "../../src/server/catalog.ts";
import { snapshotRunPolicy } from "../../src/server/run-policy.ts";
import { modelStep } from "../../src/server/engine.ts";

export async function capabilityTests(
  t: any,
  { request, pool, admin, foreign }: any,
) {
  let contextLimit = 4096;
  let maxOutput = 1024,
    efforts = ["low", "high"],
    generated = 0;
  const requests: any[] = [];
  let catalogReads = 0,
    lastAuthorization = "";
  const fixture = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      catalogReads++;
      lastAuthorization = req.headers.authorization ?? "";
      return res.end(
        JSON.stringify({
          data: [
            {
              id: "cap-fixture",
              name: "Capability Model",
              pricing: {
                currency: "USD",
                unit: "per_token",
                prompt: "0.000001",
                completion: "0.000002",
                request: "0.0005",
              },
              context_length: contextLimit,
              top_provider: { max_completion_tokens: maxOutput },
              reasoning: { supported_efforts: efforts, mandatory: true },
              description: "Do not expose cap-fixture-secret",
            },
            { id: "opaque-fixture" },
          ],
        }),
      );
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    generated++;
    requests.push(JSON.parse(body));
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Local capability fixture response",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const addr = fixture.address();
  assert.ok(addr && typeof addr !== "string");
  const endpoint = `http://127.0.0.1:${addr.port}/v1`;
  const user = await request("auth/signup", {
    email: "model-caps@test.local",
    name: "Capabilities fixture",
    password: "capabilities-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(user.status, 200);
  const state = (await request("state", undefined, user.cookie)).data,
    ws = state.workspace.id,
    agent = state.agents[0].id;
  await pool.query(
    "UPDATE accounts SET plan_id='business',subscription_status='local_test' WHERE id=$1",
    [state.workspace.account_id],
  );
  const config = {
    name: "Capability fixture",
    provider_name: "Local catalog",
    endpoint,
    model: "cap-fixture",
    key: "cap-fixture-secret",
    active: false,
    monitor_enabled: false,
    streaming: false,
    detect_capabilities: true,
    max_output_tokens: 8192,
    context_window_tokens: null,
    reasoning_effort: "auto",
    auto_reasoning_effort: "low",
  };
  let mid = "";
  try {
    await t.test(
      "Discovery is scoped, catalog-only and exposes sanitized metadata with exact per-model limits",
      async () => {
        const result = await request(
          "models/discover",
          { endpoint, model: "cap-fixture", key: config.key },
          user.cookie,
        );
        assert.equal(result.status, 200);
        assert.equal(result.data.capabilities.max_output_tokens, 1024);
        assert.equal(result.data.capabilities.context_window_tokens, 4096);
        assert.deepEqual(result.data.capabilities.reasoning_efforts, [
          "low",
          "high",
        ]);
        assert.ok(!JSON.stringify(result.data).includes(config.key));
        assert.equal(generated, 0);
        const adminDiscovery = await request(
          "admin/models/discover",
          { endpoint, model: "cap-fixture" },
          admin.cookie,
        );
        assert.equal(
          adminDiscovery.status,
          200,
          JSON.stringify(adminDiscovery.data),
        );
        assert.equal(adminDiscovery.data.capabilities.max_output_tokens, 1024);
        assert.equal(
          (
            await request(
              "admin/models/discover",
              { endpoint, model: "cap-fixture" },
              foreign.cookie,
            )
          ).status,
          403,
        );
        const saved = await request("models", config, user.cookie);
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        mid = saved.data.id;
        const m = (
          await request("state", undefined, user.cookie)
        ).data.models.find((x: any) => x.id === mid);
        assert.equal(m.max_output_tokens, 1024);
        assert.equal(m.context_window_tokens, 4096);
        assert.equal(m.capabilities.max_output_tokens, 1024);
        assert.equal(m.active, false);
        assert.equal(
          (
            await request(
              "models/discover",
              { id: mid, endpoint, model: "cap-fixture" },
              foreign.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "models/discover",
              {
                id: mid,
                endpoint: endpoint + "/changed",
                model: "cap-fixture",
              },
              user.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "models/discover",
              { id: mid, endpoint, model: "cap-fixture" },
              user.cookie,
            )
          ).status,
          200,
        );
        assert.equal(generated, 0);
      },
    );
    await t.test(
      "Provider catalog lists sanitized models for customers and admins and protects saved credentials",
      async () => {
        const before = (
          await pool.query("SELECT count(*)::int n FROM model_offerings")
        ).rows[0].n;
        const own = await request(
          "models/catalog",
          { id: mid, endpoint },
          user.cookie,
        );
        assert.equal(own.status, 200, JSON.stringify(own.data));
        assert.equal(own.data.status, "available");
        assert.equal(own.data.models.length, 2);
        assert.equal(own.data.models[0].name, "Capability Model");
        assert.equal(own.data.models[0].capabilities.max_output_tokens, 1024);
        assert.equal(lastAuthorization, "Bearer " + config.key);
        assert.ok(!JSON.stringify(own.data).includes(config.key));
        const reads = catalogReads;
        assert.equal(
          (
            await request(
              "models/catalog",
              { id: mid, endpoint },
              foreign.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "models/catalog",
              { id: mid, endpoint: endpoint + "/changed" },
              user.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("admin/models/catalog", { endpoint }, foreign.cookie))
            .status,
          403,
        );
        assert.equal(
          catalogReads,
          reads,
          "Rejected requests must not contact the provider",
        );
        const adminList = await request(
          "admin/models/catalog",
          { endpoint, key: "admin-fixture" },
          admin.cookie,
        );
        assert.equal(adminList.status, 200, JSON.stringify(adminList.data));
        assert.equal(adminList.data.models.length, 2);
        assert.equal(lastAuthorization, "Bearer admin-fixture");
        assert.equal(
          (
            await request(
              "admin/models/catalog",
              { id: mid, endpoint },
              admin.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request("models/catalog", {}, user.cookie)).status,
          400,
        );
        assert.equal(
          generated,
          0,
          "Catalog listing must never generate an AI answer",
        );
        assert.equal(
          (await pool.query("SELECT count(*)::int n FROM model_offerings"))
            .rows[0].n,
          before,
          "Listing must not create or change model offerings",
        );
      },
    );
    await t.test(
      "Managed tariffs are recalculated from trusted catalog prices, persisted privately and used by credit billing",
      async () => {
        const pricing = {
          mode: "catalog",
          currency: "USD",
          input_per_million: 0,
          output_per_million: 0,
          request: 0,
          eur_per_currency_unit: 0.9,
          eur_per_1000_credits: 0.01,
          markup_percent: 100,
          cost_buffer_percent: 10,
          acknowledge_extras: false,
        };
        const payload = {
          ...config,
          active: true,
          pricing_config: pricing,
          input_rate: 0,
          output_rate: 0,
          base_credits: 0,
        };
        const saved = await request("admin/models", payload, admin.cookie);
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        const id = saved.data.id;
        const row = (
          await pool.query("SELECT * FROM model_offerings WHERE id=$1", [id])
        ).rows[0];
        const expected = calculateModelTariff({
          ...pricing,
          mode: "catalog",
          currency: "USD",
          input_per_million: 1,
          output_per_million: 2,
          request: 0.0005,
        });
        assert.equal(Number(row.input_rate), expected.input_rate);
        assert.equal(Number(row.output_rate), expected.output_rate);
        assert.equal(row.base_credits, expected.base_credits);
        assert.equal(
          row.pricing_config.input_per_million,
          1,
          "Forged free client prices must be ignored",
        );
        assert.equal(row.pricing_config.output_per_million, 2);
        assert.equal(row.pricing_config.markup_percent, 100);
        const exposed = (
          await request("state", undefined, user.cookie)
        ).data.models.find((m: any) => m.id === id);
        assert.ok(exposed);
        assert.equal(
          exposed.pricing_config,
          undefined,
          "Customers must not receive operator purchase prices or markup",
        );
        const adminRow = (
          await request("admin", undefined, admin.cookie)
        ).data.models.find((m: any) => m.id === id);
        assert.equal(adminRow.pricing_config.markup_percent, 100);
        assert.equal(
          creditCost(1000, 1000, {
            input_rate: Number(row.input_rate),
            output_rate: Number(row.output_rate),
            base_credits: row.base_credits,
          }),
          creditCost(1000, 1000, expected),
        );
        assert.equal(
          (
            await request(
              "models",
              { ...config, pricing_config: pricing },
              user.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "admin/models",
              {
                ...payload,
                id,
                pricing_config: { ...pricing, eur_per_1000_credits: 100 },
              },
              admin.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "admin/models",
              {
                ...payload,
                id,
                model: "opaque-fixture",
                auto_reasoning_effort: "provider_default",
              },
              admin.cookie,
            )
          ).status,
          400,
        );
        const manual = await request(
          "admin/models",
          {
            ...payload,
            id,
            model: "opaque-fixture",
            detect_capabilities: false,
            auto_reasoning_effort: "provider_default",
            pricing_config: {
              ...pricing,
              mode: "manual",
              input_per_million: 0,
              output_per_million: 0,
              request: 0,
            },
          },
          admin.cookie,
        );
        assert.equal(manual.status, 200, JSON.stringify(manual.data));
        const free = (
          await pool.query(
            "SELECT input_rate::float8,output_rate::float8,base_credits,pricing_config FROM model_offerings WHERE id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(free.input_rate, 0);
        assert.equal(free.base_credits, 0);
        assert.equal(free.pricing_config.mode, "manual");
        await pool.query(
          "UPDATE model_offerings SET active=false WHERE id=$1",
          [id],
        );
        assert.equal(
          generated,
          0,
          "Pricing and catalog operations must never generate paid text",
        );
      },
    );
    await t.test(
      "Server rejects unsupported reasoning, ignores forged metadata, and preserves explicit unknown/manual handling",
      async () => {
        assert.equal(
          (
            await request(
              "models",
              {
                ...config,
                id: mid,
                auto_reasoning_effort: "none",
                capabilities: { reasoning_efforts: ["none"] },
              },
              user.cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "models",
              { ...config, id: mid, auto_reasoning_effort: "max" },
              user.cookie,
            )
          ).status,
          400,
        );
        const opaque = {
          ...config,
          id: undefined,
          name: "Opaque fixture",
          model: "opaque-fixture",
          reasoning_effort: "low",
        };
        assert.equal(
          (await request("models", opaque, user.cookie)).status,
          400,
        );
        const saved = await request(
          "models",
          { ...opaque, reasoning_effort: "provider_default" },
          user.cookie,
        );
        assert.equal(saved.status, 200);
        const m = (
          await request("state", undefined, user.cookie)
        ).data.models.find((x: any) => x.id === saved.data.id);
        assert.equal(m.capabilities.reasoning_efforts, null);
        assert.equal(
          (
            await request(
              "models",
              { ...opaque, id: saved.data.id, detect_capabilities: false },
              user.cookie,
            )
          ).status,
          200,
        );
        const managed = await request(
          "admin/models",
          { ...config, name: "Managed metadata fixture", active: false },
          admin.cookie,
        );
        assert.equal(managed.status, 200);
        assert.equal(
          (await request("admin", undefined, admin.cookie)).data.models.find(
            (x: any) => x.id === managed.data.id,
          ).capabilities.context_window_tokens,
          4096,
        );
        assert.equal(generated, 0);
      },
    );
    await t.test(
      "Daily check refreshes capabilities; runtime uses lower provider limits and blocks newly unsupported effort",
      async () => {
        maxOutput = 512;
        await pool.query(
          "UPDATE model_offerings SET active=true,checked_at=NULL WHERE id=$1",
          [mid],
        );
        assert.equal(
          (
            await request(
              "models/action",
              { id: mid, action: "check" },
              user.cookie,
            )
          ).status,
          200,
        );
        const m = await transaction((c) => validateModel(c, ws, mid));
        assert.equal(m.max_output_tokens, 512);
        assert.equal(m.context_window_tokens, 4096);
        // The full agent instruction prefix needs more than a 4K context; catalog
        // parsing and persistence of the small model were verified above.
        contextLimit = 32768;
        assert.equal(
          (
            await request(
              "models",
              { ...config, id: mid, active: true },
              user.cookie,
            )
          ).status,
          200,
        );
        const run = randomUUID(),
          task = randomUUID(),
          lease = randomUUID();
        await transaction(async (c) => {
          const budget = await snapshotRunPolicy(c, ws, [mid]);
          await c.query(
            "INSERT INTO runs(id,workspace_id,goal,max_steps,credit_limit,token_limit,model_policy) VALUES($1,$2,'Local capability fixture',5,0,10000,$3)",
            [run, ws, JSON.stringify(budget.policy)],
          );
          await c.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,model_id,lease_token,lease_until) VALUES($1,$2,$3,$4,'Capabilities fixture','Fixture','running',$5,$6,now()+interval '10 minutes')",
            [task, run, ws, agent, mid, lease],
          );
        });
        try {
          const response = await modelStep(
            task,
            lease,
            [
              { role: "system", content: "Fixture" },
              { role: "user", content: "Return a short response" },
            ],
            [],
          );
          assert.ok(response);
          assert.equal(requests.at(-1).reasoning_effort, "low");
          assert.ok(requests.at(-1).max_completion_tokens <= 512);
          const limits = (
            await pool.query(
              "SELECT token_limit,credit_limit FROM runs WHERE id=$1",
              [run],
            )
          ).rows[0];
          assert.deepEqual(limits, { token_limit: 10000, credit_limit: 0 });
        } finally {
          await pool.query(
            "UPDATE tasks SET status='completed',lease_token=NULL WHERE id=$1",
            [task],
          );
          await pool.query("UPDATE runs SET status='completed' WHERE id=$1", [
            run,
          ]);
        }
        const count = generated;
        efforts = ["high"];
        await pool.query(
          "UPDATE model_offerings SET checked_at=NULL WHERE id=$1",
          [mid],
        );
        assert.equal(
          (
            await request(
              "models/action",
              { id: mid, action: "check" },
              user.cookie,
            )
          ).status,
          200,
        );
        await assert.rejects(
          transaction((c) => validateModel(c, ws, mid)),
          (e: any) => e.status === 409,
        );
        assert.equal(generated, count);
        await pool.query(
          "UPDATE model_offerings SET active=false WHERE id=$1",
          [mid],
        );
      },
    );
  } finally {
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
