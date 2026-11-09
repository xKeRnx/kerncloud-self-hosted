import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { processRegistry } from "../environments/processes.mjs";
const make = (options = {}) =>
  processRegistry({
    cwd: async () => "/tmp",
    environment: () => ({ PATH: "/usr/local/bin:/usr/bin:/bin" }),
    ...options,
  });
test(
  "Real Linux process survives 30s, yields a handle, and returns exit/log once",
  { timeout: 45000 },
  async () => {
    const r = make(),
      id = randomUUID();
    try {
      const first = await r.start(
        {
          command: "printf start; sleep 31; printf finished",
          timeout_seconds: 36,
          yield_seconds: 0,
        },
        id,
        "task-a",
      );
      assert.equal(first.status, "running");
      assert.equal(first.process_id, id);
      await assert.rejects(
        r.action({ process_id: id, action: "status" }, "task-b"),
        /unavailable/,
      );
      let next = await r.action(
        { process_id: id, action: "wait", cursor: 0 },
        "task-a",
      );
      if (next.status === "running")
        next = await r.action(
          { process_id: id, action: "wait", cursor: 0 },
          "task-a",
        );
      assert.equal(next.status, "exited");
      assert.equal(next.exit_code, 0);
      assert.match(next.output, /startfinished/);
      const noDuplicate = await r.action(
        { process_id: id, action: "status", cursor: next.cursor },
        "task-a",
      );
      assert.equal(noDuplicate.output, "");
    } finally {
      r.close();
    }
  },
);
test(
  "Idempotent start, bounded output, cancellation and orphan watchdog",
  { timeout: 12000 },
  async () => {
    const r = make({ leaseMs: 500 }),
      id = randomUUID();
    try {
      await r.start(
        {
          command: "printf begin; sleep 8; printf bad",
          timeout_seconds: 10,
          yield_seconds: 0,
        },
        id,
        "owner",
      );
      const same = await r.start(
        { command: "exit 99", yield_seconds: 0 },
        id,
        "owner",
      );
      assert.equal(same.process_id, id);
      await new Promise((r) => setTimeout(r, 1800));
      const stopped = await r.action(
        { process_id: id, action: "wait" },
        "owner",
      );
      assert.equal(stopped.canceled, true);
      assert.doesNotMatch(stopped.output, /bad/);
      const id2 = randomUUID();
      await r.start(
        {
          command: "node -e \"process.stdout.write('x'.repeat(100000))\"",
          yield_seconds: 0,
          timeout_seconds: 5,
        },
        id2,
        "owner",
      );
      const output = await r.action(
        { process_id: id2, action: "wait" },
        "owner",
      );
      assert.ok(output.output.length <= 24000);
      assert.equal(output.truncated, true);
      const id3 = randomUUID();
      await r.start({ command: "sleep 8", yield_seconds: 0 }, id3, "owner");
      const killed = await r.action(
        { process_id: id3, action: "stop" },
        "owner",
      );
      assert.equal(killed.canceled, true);
    } finally {
      r.close();
    }
  },
);
