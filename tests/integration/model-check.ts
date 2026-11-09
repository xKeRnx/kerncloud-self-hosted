import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Pool } from "pg";
import { checkModel } from "../../src/server/model-monitor.ts";

type Result = { status: number; data: Record<string, any>; cookie: string };
type Request = (
  path: string,
  body?: unknown,
  cookie?: string,
) => Promise<Result>;
export async function modelCheckTests(
  t: TestContext,
  { request, pool, admin }: { request: Request; pool: Pool; admin: Result },
) {
  const owner = await request("auth/signup", {
    email: "model-check-fixture@test.local",
    password: "model-check-fixture-password",
    name: "Model check fixture",
    privacyAccepted: true,
  });
  assert.equal(owner.status, 200);
  let requests = 0;
  let gate: (() => void) | undefined;
  let arrived: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/models");
    requests++;
    if (arrived) {
      const notify = arrived;
      arrived = undefined;
      await new Promise<void>((resolve) => {
        gate = resolve;
        notify();
      });
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "model-check-fixture" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = "http://127.0.0.1:" + address.port;
  const created = await request(
    "models",
    {
      name: "Catalog fixture",
      provider_name: "Fixture",
      endpoint,
      model: "model-check-fixture",
      key: "fixture-key",
      monitor_enabled: false,
    },
    owner.cookie,
  );
  assert.equal(created.status, 200);
  const id = created.data.id;
  const workspace = (
    await pool.query("SELECT workspace_id FROM model_offerings WHERE id=$1", [
      id,
    ])
  ).rows[0].workspace_id;
  const check = (cookie = owner.cookie) =>
    request("models/action", { id, action: "check" }, cookie);
  const expire = () =>
    pool.query(
      "UPDATE model_offerings SET checked_at=now()-interval '6 minutes' WHERE id=$1",
      [id],
    );
  try {
    await t.test(
      "manual catalog check reuses a recent result without writing or provider I/O",
      async () => {
        await expire();
        const first = await check();
        assert.equal(first.status, 200);
        assert.equal(first.data.status, "available");
        assert.equal(first.data.check_performed, true);
        const before = requests;
        const cached = await check();
        assert.equal(cached.status, 200);
        assert.equal(cached.data.check_performed, false);
        assert.equal(cached.data.status, "available");
        assert.equal(cached.data.checked_at, first.data.checked_at);
        assert.equal(cached.data.next_check_at, first.data.next_check_at);
        assert.ok(
          cached.data.retry_after_seconds > 0 &&
            cached.data.retry_after_seconds <= 300,
        );
        assert.equal(requests, before);
      },
    );
    await t.test(
      "manual checks remain scoped and disabled models get a specific error",
      async () => {
        const before = requests;
        assert.equal(
          (
            await request(
              "admin/models/action",
              { id, action: "check" },
              admin.cookie,
            )
          ).status,
          404,
        );
        await pool.query(
          "UPDATE model_offerings SET active=false WHERE id=$1",
          [id],
        );
        const disabled = await check();
        assert.equal(disabled.status, 409);
        assert.match(disabled.data.error, /deaktiviert|disabled/);
        assert.equal(requests, before);
        await pool.query("UPDATE model_offerings SET active=true WHERE id=$1", [
          id,
        ]);
      },
    );
    await t.test(
      "simultaneous manual checks share one claimed request",
      async () => {
        await expire();
        const seen = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        const pending = check();
        try {
          await seen;
          const before = requests;
          const concurrent = await check();
          assert.equal(concurrent.status, 200);
          assert.equal(concurrent.data.status, "checking");
          assert.equal(concurrent.data.check_performed, false);
          assert.equal(requests, before);
        } finally {
          gate?.();
          gate = undefined;
        }
        assert.equal((await pending).data.status, "available");
      },
    );
    await t.test(
      "a completed response cannot overwrite a newer claim or edited model",
      async () => {
        await expire();
        const seen = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        const pending = check();
        try {
          await seen;
          await pool.query(
            "UPDATE model_offerings SET checked_at=date_trunc('milliseconds',clock_timestamp())+interval '1 second',check_status='unavailable' WHERE id=$1",
            [id],
          );
        } finally {
          gate?.();
          gate = undefined;
        }
        assert.equal((await pending).data.superseded, true);
        assert.equal(
          (
            await pool.query(
              "SELECT check_status FROM model_offerings WHERE id=$1",
              [id],
            )
          ).rows[0].check_status,
          "unavailable",
        );
      },
    );
    await t.test(
      "an expired cooldown allows a fresh manual catalog request",
      async () => {
        await expire();
        const before = requests;
        assert.equal((await check()).data.check_performed, true);
        assert.equal(requests, before + 1);
      },
    );
    await t.test(
      "automatic monitoring still respects the daily interval",
      async () => {
        await pool.query(
          "UPDATE model_offerings SET monitor_enabled=true WHERE id=$1",
          [id],
        );
        const before = requests;
        await checkModel(null);
        assert.equal(requests, before);
        await pool.query(
          "UPDATE model_offerings SET checked_at=now()-interval '25 hours' WHERE id=$1",
          [id],
        );
        await checkModel(null);
        assert.equal(requests, before + 1);
        assert.equal(
          (
            await pool.query(
              "SELECT check_status FROM model_offerings WHERE id=$1",
              [id],
            )
          ).rows[0].check_status,
          "available",
        );
        await pool.query(
          "UPDATE model_offerings SET monitor_enabled=false WHERE id=$1",
          [id],
        );
      },
    );
    assert.equal((await checkModel(workspace, id))?.check_performed, false);
  } finally {
    gate?.();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
