import { gatewayHttp } from "../fixtures/gateway-http.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import type { TestContext } from "node:test";
import { NextRequest } from "next/server";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn: () => Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await sleep(50);
  }
  assert.fail(message);
}
export async function selfServiceTests(
  t: TestContext,
  { request, pool, handle, alice, bob, admin, a }: Record<string, any>,
) {
  const { hashToken, decrypt, encrypt } =
    await import("../../src/server/security.ts");
  const { transaction } = await import("../../src/server/db.ts");
  const { maintainRuntime } = await import("../../src/server/runtime.ts");
  const { startGateway } = await import("../../src/gateway/server.ts");
  const { environmentOrigin } =
    await import("../../src/server/environment-access.ts");
  const { applyRuntimePayment } =
    await import("../../src/server/runtime-payments.ts");
  let id = "",
    host: any,
    job: any,
    gateway: Awaited<ReturnType<typeof startGateway>> | undefined,
    relay: WebSocket | undefined;
  const originalBase = process.env.PUBLIC_ENVIRONMENT_URL;
  await t.test(
    "Kundenumgebungen: Plan-Slots, parallele Buchung, geteilte Kontingente und private Startrechte",
    async () => {
      const plans = (await request("admin", undefined, admin.cookie)).data
        .plans;
      const plan = plans.find((p: any) => p.id === "starter");
      const save = await request(
        "admin/plan",
        {
          ...plan,
          max_workspaces: 20,
          max_environments: 1,
          max_running_environments: 1,
          runtime_minutes: 5,
          environment_templates: ["browser", "development"],
        },
        admin.cookie,
      );
      assert.equal(save.status, 200, JSON.stringify(save.data));
      await request(
        "admin/workspace",
        { id: a.workspace.id, plan_id: "starter", creditAdjustment: 0 },
        admin.cookie,
      );
      host = (
        await request(
          "admin/infrastructure",
          {
            action: "createHost",
            name: "Self-service protocol fixture",
            kind: "docker",
          },
          admin.cookie,
        )
      ).data;
      const agent = async (path: string, body: any) => {
        const r = await handle(
          new NextRequest(
            "http://localhost:3100/api/infrastructure/agent/" + path,
            {
              method: "POST",
              headers: {
                authorization: "Bearer " + host.token,
                "x-host-id": host.id,
                "content-type": "application/json",
              },
              body: JSON.stringify(body),
            },
          ),
          "infrastructure/agent/" + path,
        );
        return { status: r.status, data: await r.json() };
      };
      host.agent = agent;
      host.beat = () =>
        agent("heartbeat", {
          version: "fixture",
          hostname: "test-host",
          cpuCount: 8,
          memoryTotal: 16 * 1024 ** 3,
          memoryFree: 12 * 1024 ** 3,
          load: [0, 0, 0],
          commandsEnabled: true,
          accessConfigured: true,
          containers: [],
        });
      await host.beat();
      await request(
        "admin/infrastructure",
        {
          action: "host",
          id: host.id,
          enabled: true,
          provisioning: true,
          self_service: true,
          max_running: 2,
          cpu_limit: 8,
          memory_limit_mb: 8192,
        },
        admin.cookie,
      );
      for (const templateId of ["browser", "development"]) {
        const spec = (
          await request("admin/infrastructure", undefined, admin.cookie)
        ).data.templates.find((x: any) => x.id === templateId);
        await request(
          "admin/infrastructure",
          { action: "template", ...spec, enabled: true },
          admin.cookie,
        );
      }
      // No other test host can accept a customer booking.
      await pool.query(
        "UPDATE infrastructure_hosts SET self_service=false WHERE id<>$1",
        [host.id],
      );
      assert.equal(
        (
          await request(
            "environments/manage",
            {
              action: "book",
              templateId: "not-in-plan",
              name: "Forbidden",
              expectedRate: 1,
            },
            bob.cookie,
          )
        ).status,
        403,
      );
      const bookings = await Promise.all(
        [1, 2].map((i) =>
          request(
            "environments/manage",
            {
              action: "book",
              templateId: "development",
              name: "Private fixture " + i,
              expectedRate: 1,
            },
            alice.cookie,
          ),
        ),
      );
      assert.deepEqual(bookings.map((x) => x.status).sort(), [200, 409]);
      id = bookings.find((x) => x.status === 200)!.data.id;
      const second = (
        await request(
          "workspaces",
          { name: "Container quota fixture" },
          alice.cookie,
        )
      ).data.id;
      assert.equal(
        (
          await request(
            "environments/manage",
            {
              action: "book",
              templateId: "browser",
              name: "Other workspace",
              expectedRate: 1,
            },
            alice.cookie + "; kc_workspace=" + second,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            "environments/manage",
            { action: "start", id, expectedRate: 1 },
            bob.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            "environments/manage",
            { action: "start", id, expectedRate: 1 },
            alice.cookie,
          )
        ).status,
        503,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM runtime_ledger WHERE environment_id=$1",
            [id],
          )
        ).rows[0].n,
        0,
        "failed start transaction must not reserve credits",
      );
      gateway = await startGateway(0, "127.0.0.1");
      const port = (gateway.server.address() as any).port;
      process.env.PUBLIC_ENVIRONMENT_URL = `http://localhost:${port}`;
      const started = await request(
        "environments/manage",
        { action: "start", id, expectedRate: 1 },
        alice.cookie,
      );
      assert.equal(started.status, 200, JSON.stringify(started.data));
      job = (await agent("claim", {})).data.job;
      assert.equal(job.environmentId, id);
      assert.ok(job.spec.relayToken.length >= 40);
      const credentials = (
        await pool.query(
          "SELECT * FROM environment_credentials WHERE environment_id=$1",
          [id],
        )
      ).rows[0];
      assert.notEqual(credentials.relay_secret, job.spec.relayToken);
      assert.equal(credentials.relay_hash, hashToken(job.spec.relayToken));
      assert.equal(
        (await request("runtime", undefined, alice.cookie)).data.balance
          .included,
        240,
      );
      await agent("complete", {
        id: job.id,
        lease: job.lease,
        ok: true,
        resourceId: "fixture-resource",
      });
      assert.equal(
        (await request("runtime", undefined, alice.cookie)).data.balance
          .included,
        240,
      );
    },
  );
  await t.test(
    "Geschützter Zugang: Einmal-Ticket, eigene Origin, HTTP/WS, Kontotrennung und Widerruf",
    async () => {
      const port = (gateway!.server.address() as any).port,
        origin = environmentOrigin(id),
        hostname = new URL(origin).host;
      const call = (path: string, headers: any = {}) =>
        gatewayHttp(`http://127.0.0.1:${port}${path}`, {
          host: hostname,
          ...headers,
        });
      relay = new WebSocket(`ws://127.0.0.1:${port}/_relay`, {
        headers: {
          authorization: "Bearer " + job.spec.relayToken,
          "x-environment-id": id,
          "x-environment-generation": "1",
        },
      });
      await new Promise<void>((resolve, reject) => {
        relay!.once("open", resolve);
        relay!.once("error", reject);
      });
      relay.on("message", (data) => {
        const m = JSON.parse(data.toString());
        if (m.kind === "http") {
          relay!.send(
            JSON.stringify({
              kind: "head",
              id: m.id,
              status: 200,
              headers: {
                "content-type": "text/plain",
                "set-cookie": "bad-cookie=ignored; Domain=localhost",
              },
            }),
          );
          relay!.send(
            JSON.stringify({
              kind: "data",
              id: m.id,
              data: Buffer.from("private-fixture-page").toString("base64"),
            }),
          );
          relay!.send(JSON.stringify({ kind: "end", id: m.id }));
        }
        if (m.kind === "ws-data") relay!.send(JSON.stringify({ ...m }));
      });
      await eventually(
        async () =>
          Boolean(
            (
              await pool.query(
                "SELECT relay_seen FROM customer_environments WHERE id=$1",
                [id],
              )
            ).rows[0].relay_seen,
          ),
        "relay registration",
      );
      assert.equal((await call("/")).status, 401);
      assert.equal(
        (await request("environments/launch", { id }, bob.cookie)).status,
        404,
      );
      const launch = await request("environments/launch", { id }, alice.cookie);
      assert.equal(launch.status, 200, JSON.stringify(launch.data));
      assert.equal(new URL(launch.data.url).hostname, id + ".localhost");
      const path =
        new URL(launch.data.url).pathname + new URL(launch.data.url).search;
      const exchange = await call(path);
      assert.equal(exchange.status, 303);
      const cookie = exchange.headers.get("set-cookie")!.split(";")[0];
      assert.match(exchange.headers.get("set-cookie")!, /HttpOnly/);
      assert.ok(!exchange.headers.get("set-cookie")!.includes("Domain="));
      assert.equal((await call(path)).status, 403, "ticket replay denied");
      const page = await call("/", { cookie });
      assert.equal(page.status, 200);
      assert.equal(await page.text(), "private-fixture-page");
      assert.equal(
        page.headers.get("set-cookie"),
        null,
        "upstream cannot set parent cookies",
      );
      assert.equal(
        (await call("/", { cookie, origin: "https://foreign.example" })).status,
        403,
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}/socket`, {
        headers: { host: hostname, cookie },
        origin,
      });
      await new Promise<void>((r, j) => {
        ws.once("open", r);
        ws.once("error", j);
      });
      const reply = new Promise<string>((resolve) =>
        ws.once("message", (d) => resolve(d.toString())),
      );
      ws.send("private-fixture-ws");
      assert.equal(await reply, "private-fixture-ws");
      const large = Buffer.alloc(1048576, 42);
      const echoed = new Promise<Buffer>((resolve) =>
        ws.once("message", (d) => resolve(Buffer.from(d as Buffer))),
      );
      ws.send(large);
      assert.deepEqual(await echoed, large);
      const stop = await request(
        "environments/manage",
        { action: "stop", id },
        alice.cookie,
      );
      assert.equal(stop.status, 200);
      assert.equal((await call("/", { cookie })).status, 401);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error("WebSocket not revoked"));
        }, 4000);
        ws.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const stopJob = (await host.agent("claim", {})).data.job;
      await host.agent("complete", {
        id: stopJob.id,
        lease: stopJob.lease,
        ok: true,
        resourceId: "fixture-resource",
      });
      const before = (await request("runtime", undefined, alice.cookie)).data
        .balance.included;
      await transaction(maintainRuntime);
      assert.equal(
        (await request("runtime", undefined, alice.cookie)).data.balance
          .included,
        before,
        "stopped containers do not consume minutes",
      );
      await request(
        "environments/manage",
        { action: "start", id, expectedRate: 1 },
        alice.cookie,
      );
      const restart = (await host.agent("claim", {})).data.job;
      await host.agent("complete", {
        id: restart.id,
        lease: restart.lease,
        ok: true,
        resourceId: "fixture-resource",
      });
      // Exhausted funds: one stop job only, immediate access revocation, never a negative balance.
      await transaction(async (c: any) => {
        await c.query("SELECT pg_advisory_xact_lock(6820192032)");
        await c.query(
          "UPDATE accounts SET runtime_included=0,runtime_purchased=0 WHERE id=$1",
          [a.workspace.account_id],
        );
        await c.query(
          "UPDATE customer_environments SET paid_until=now()-interval '1 second' WHERE id=$1",
          [id],
        );
        await maintainRuntime(c);
      });
      await transaction(maintainRuntime);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM environment_jobs WHERE environment_id=$1 AND status='queued'",
            [id],
          )
        ).rows[0].n,
        1,
      );
      const automatic = (await host.agent("claim", {})).data.job;
      assert.equal(automatic.action, "stop");
      await host.agent("complete", {
        id: automatic.id,
        lease: automatic.lease,
        ok: true,
      });
      assert.equal(
        (
          await request(
            "environments/manage",
            { action: "start", id, expectedRate: 1 },
            alice.cookie,
          )
        ).status,
        402,
      );
      assert.equal(
        (
          await request(
            "environments/manage",
            { action: "delete", id, confirmation: "wrong" },
            alice.cookie,
          )
        ).status,
        400,
      );
      const e = (
        await request("runtime", undefined, alice.cookie)
      ).data.environments.find((x: any) => x.id === id);
      await request(
        "environments/manage",
        { action: "delete", id, confirmation: e.name },
        alice.cookie,
      );
      const removal = (await host.agent("claim", {})).data.job;
      await host.agent("complete", {
        id: removal.id,
        lease: removal.lease,
        ok: true,
      });
      relay.close();
      await gateway!.close();
      gateway = undefined;
    },
  );
  await t.test(
    "Containerzahlungen: geprüfte Position, keine Gutschrift aus Rückleitung, Idempotenz und Erstattung",
    async () => {
      const order = randomUUID(),
        sessionId = "cs_runtime_fixture",
        customer = "cus_runtime_fixture";
      await pool.query(
        "UPDATE accounts SET stripe_customer_id=$2,runtime_purchased=0 WHERE id=$1",
        [a.workspace.account_id, customer],
      );
      await pool.query(
        "INSERT INTO runtime_orders(id,account_id,product_id,minutes,price_cents,stripe_price_id,stripe_session_id) VALUES($1,$2,'runtime-300',300,500,'price_runtime_fixture',$3)",
        [order, a.workspace.account_id, sessionId],
      );
      const session: any = {
        id: sessionId,
        mode: "payment",
        payment_status: "paid",
        customer,
        currency: "eur",
        amount_subtotal: 500,
        amount_total: 500,
        metadata: {
          runtime_order_id: order,
          account_id: a.workspace.account_id,
        },
        client_reference_id: order,
        payment_intent: "pi_runtime_fixture",
        line_items: {
          data: [
            {
              quantity: 1,
              price: {
                id: "price_runtime_fixture",
                unit_amount: 500,
                currency: "eur",
              },
            },
          ],
        },
      };
      const event: any = {
        id: "evt_runtime_payment",
        type: "checkout.session.completed",
        data: { object: {} },
      };
      await applyRuntimePayment(
        { ...event, id: "evt_runtime_unpaid" },
        { ...session, payment_status: "unpaid" },
      );
      assert.equal(
        (
          await pool.query(
            "SELECT runtime_purchased FROM accounts WHERE id=$1",
            [a.workspace.account_id],
          )
        ).rows[0].runtime_purchased,
        0,
      );
      await assert.rejects(() =>
        applyRuntimePayment(
          { ...event, id: "evt_runtime_bad_price" },
          { ...session, amount_subtotal: 1 },
        ),
      );
      await applyRuntimePayment(event, session);
      await applyRuntimePayment(event, session);
      await applyRuntimePayment(
        {
          ...event,
          id: "evt_runtime_payment_duplicate",
          type: "checkout.session.async_payment_succeeded",
        },
        session,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT runtime_purchased FROM accounts WHERE id=$1",
            [a.workspace.account_id],
          )
        ).rows[0].runtime_purchased,
        18000,
      );
      await pool.query("UPDATE accounts SET runtime_purchased=60 WHERE id=$1", [
        a.workspace.account_id,
      ]);
      await applyRuntimePayment({
        id: "evt_runtime_refund",
        type: "charge.refunded",
        data: {
          object: {
            payment_intent: "pi_runtime_fixture",
            amount_refunded: 500,
          },
        },
      } as any);
      const balance = (
        await pool.query(
          "SELECT runtime_purchased,runtime_debt FROM accounts WHERE id=$1",
          [a.workspace.account_id],
        )
      ).rows[0];
      assert.equal(balance.runtime_purchased, 0);
      assert.equal(balance.runtime_debt, 17940);
      await applyRuntimePayment({
        id: "evt_runtime_refund_repeated",
        type: "charge.refunded",
        data: {
          object: {
            payment_intent: "pi_runtime_fixture",
            amount_refunded: 500,
          },
        },
      } as any);
      assert.equal(
        (
          await pool.query("SELECT runtime_debt FROM accounts WHERE id=$1", [
            a.workspace.account_id,
          ])
        ).rows[0].runtime_debt,
        17940,
      );
      const correction = await request(
        "admin/runtime",
        {
          action: "grant",
          workspaceId: a.workspace.id,
          seconds: 18000,
        },
        admin.cookie,
      );
      assert.equal(correction.status, 200);
      const corrected = (
        await pool.query(
          "SELECT runtime_purchased,runtime_debt FROM accounts WHERE id=$1",
          [a.workspace.account_id],
        )
      ).rows[0];
      assert.equal(
        corrected.runtime_debt,
        0,
        "admin credit settles outstanding runtime corrections first",
      );
      assert.equal(corrected.runtime_purchased, 60);
      assert.equal(
        (
          await request(
            "admin/runtime",
            { action: "grant", workspaceId: a.workspace.id, seconds: -61 },
            admin.cookie,
          )
        ).status,
        400,
      );
      await pool.query(
        "UPDATE accounts SET runtime_debt=0,stripe_customer_id=NULL WHERE id=$1",
        [a.workspace.account_id],
      );
    },
  );
  await t.test(
    "Agenten und Workspace stoppen: laufenden HTTP-Modellaufruf abbrechen und alte Leases sperren",
    async () => {
      let started = false,
        aborted = false;
      const slow = createServer(async (req, res) => {
        if(req.method === "GET" && req.url?.endsWith("/models")) { res.statusCode=404; res.end(); return; }
        for await (const _ of req) {
        }
        started = true;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          'data: {"choices":[{"delta":{"role":"assistant","content":"Begonnen"}}]}\n\n',
        );
        res.on("close", () => {
          aborted = !res.writableEnded;
        });
      });
      await new Promise<void>((resolve) =>
        slow.listen(0, "127.0.0.1", resolve),
      );
      const workspace = (
          await request(
            "workspaces",
            { name: "Execution control fixture" },
            alice.cookie,
          )
        ).data.id,
        cookie = alice.cookie + "; kc_workspace=" + workspace;
      const state = (await request("state", undefined, cookie)).data,
        agent = state.agents[0],
        model = randomUUID();
      await pool.query(
        "INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,input_rate,output_rate,streaming) VALUES($1,$2,'Slow fixture','Fixture',$3,'slow',$4,0,0,true)",
        [
          model,
          workspace,
          `http://127.0.0.1:${(slow.address() as any).port}/v1`,
          encrypt("fixture-only"),
        ],
      );
      await pool.query("UPDATE agents SET model_id=$2 WHERE id=$1", [
        agent.id,
        model,
      ]);
      const { createRun, changeRun, lockTask, claim } =
        await import("../../src/server/store.ts");
      const run = await createRun(state.workspace, "Wait for stop", agent.id);
      await eventually(
        async () => started,
        "slow provider was not called by worker",
      );
      const running = (
        await pool.query("SELECT * FROM tasks WHERE run_id=$1", [run.id])
      ).rows[0];
      assert.equal(
        (
          await request(
            "execution/control",
            { action: "stop", agentId: agent.id },
            bob.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            "execution/control",
            { action: "stop", agentId: agent.id },
            cookie,
          )
        ).status,
        200,
      );
      await eventually(
        async () => aborted,
        "upstream model HTTP request did not abort",
      );
      await assert.rejects(() =>
        transaction((c: any) => lockTask(c, running.id, running.lease_token)),
      );
      assert.equal(
        (
          await pool.query("SELECT execution_paused FROM agents WHERE id=$1", [
            agent.id,
          ])
        ).rows[0].execution_paused,
        true,
      );
      assert.equal(
        (await request("execution/control", { action: "stop" }, cookie)).status,
        200,
      );
      await assert.rejects(() =>
        createRun(state.workspace, "Blocked", agent.id),
      );
      assert.equal(
        (await claim(randomUUID()))?.task.workspace_id === workspace,
        false,
      );
      await changeRun(workspace, run.id, "cancel");
      await request("execution/control", { action: "resume" }, cookie);
      assert.equal(
        (await request("state", undefined, cookie)).data.workspace
          .execution_paused,
        false,
      );
      assert.equal(
        (await request("state", undefined, cookie)).data.agents.find(
          (x: any) => x.id === agent.id,
        ).execution_paused,
        true,
        "workspace resume preserves individual stop",
      );
      await request(
        "execution/control",
        { action: "resume", agentId: agent.id },
        cookie,
      );
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    },
  );
  if (gateway) await gateway.close();
  relay?.terminate();
  if (originalBase === undefined) delete process.env.PUBLIC_ENVIRONMENT_URL;
  else process.env.PUBLIC_ENVIRONMENT_URL = originalBase;
}
