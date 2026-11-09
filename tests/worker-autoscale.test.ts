import test from "node:test";
import assert from "node:assert/strict";
import {
  WorkerAutoscaler,
  desiredManagedWorkers,
} from "../src/infrastructure/worker-autoscale.ts";
const policy = {
  group: "fixture",
  image: "fixture-image",
  network: "fixture-network",
  platform: "http://fixture",
  token: "fixture-token",
  min: 0,
  max: 2,
  concurrency: 2,
  memoryMb: 256,
  cpu: 0.5,
  idleMs: 30000,
};
test("autoscaler respects other workers and a hard per-host maximum", () => {
  assert.equal(desiredManagedWorkers(4, 4, 2, 0, 4), 0);
  assert.equal(desiredManagedWorkers(1000, 0, 2, 0, 4), 4);
  assert.equal(desiredManagedWorkers(0, 0, 2, 1, 4), 1);
  assert.throws(
    () =>
      new WorkerAutoscaler({ request: async () => {} }, async () => ({}), {
        ...policy,
        max: NaN,
      }),
  );
});
test("autoscaler creates one bounded worker without mounting host files or Docker access", async () => {
  const calls: any[] = [];
  const engine = {
    request: async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      return path.startsWith("/containers/json")
        ? []
        : path.startsWith("/containers/create")
          ? { Id: "fixture-container" }
          : {};
    },
  };
  const scaler = new WorkerAutoscaler(
    engine,
    async (path) =>
      path === "autoscale/lease"
        ? { ok: true }
        : { demand_slots: 100, other_slots: 0 },
    policy,
  );
  await scaler.tick();
  const created = calls.filter((c) => c.path.startsWith("/containers/create"));
  assert.equal(created.length, 1);
  assert.equal(created[0].body.HostConfig.Memory, 256 * 1048576);
  assert.equal(created[0].body.HostConfig.ReadonlyRootfs, true);
  assert.equal(created[0].body.User, "1000:1000");
  assert.equal(created[0].body.HostConfig.Binds, undefined);
  assert.deepEqual(created[0].body.HostConfig.CapDrop, ["ALL"]);
});
test("busy workers and other containers survive scale-down; idle own workers drain before removal", async () => {
  const calls: string[] = [];
  let now = 0,
    busy = true;
  const detail = {
    Config: {
      Labels: { "kerncloud.autoscaler": "fixture" },
      Env: ["WORKER_ID=fixture-worker"],
    },
    State: { Status: "running" },
  };
  const engine = {
    request: async (method: string, path: string) => {
      calls.push(method + " " + path);
      if (path.startsWith("/containers/json"))
        return [{ Id: "ours" }, { Id: "foreign" }];
      if (path === "/containers/ours/json") return detail;
      if (path === "/containers/foreign/json")
        return {
          ...detail,
          Config: {
            ...detail.Config,
            Labels: { "kerncloud.autoscaler": "someone-else" },
          },
        };
      return {};
    },
  };
  const order: string[] = [];
  const scaler = new WorkerAutoscaler(
    engine,
    async (path) => {
      if (path === "autoscale/lease") return { ok: true };
      if (path === "autoscale/drain") {
        order.push("drain");
        return { ok: !busy };
      }
      return { demand_slots: 0, other_slots: 4 };
    },
    policy,
    () => now,
  );
  await scaler.tick();
  assert.ok(!calls.some((x) => x.includes("/stop")));
  now = 31000;
  await scaler.tick();
  assert.ok(!calls.some((x) => x.includes("/stop")));
  busy = false;
  await scaler.tick();
  assert.deepEqual(order, ["drain", "drain"]);
  assert.ok(calls.includes("POST /containers/ours/stop?t=30"));
  assert.ok(calls.includes("DELETE /containers/ours?force=false&v=false"));
  assert.ok(!calls.some((x) => x.includes("/containers/foreign/stop")));
});
test("lost autoscaler ownership prevents Docker actions", async () => {
  let calls = 0;
  const scaler = new WorkerAutoscaler(
    {
      request: async () => {
        calls++;
      },
    },
    async () => ({ ok: false }),
    policy,
  );
  await scaler.tick();
  assert.equal(calls, 0);
});
