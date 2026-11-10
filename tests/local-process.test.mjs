import test from "node:test";
import assert from "node:assert/strict";
import { runProcess, parseServices } from "../scripts/local-process.mjs";
test("local process work does not block the event loop and reports nonzero exits", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  try {
    const result = await runProcess(
      process.execPath,
      ["-e", "setTimeout(()=>{console.log('done');process.exitCode=7},180)"],
      { capture: true },
    );
    assert.ok(ticks >= 3);
    assert.equal(result.status, 7);
    assert.equal(result.stdout.trim(), "done");
  } finally {
    clearInterval(timer);
  }
});
test("a stuck local process fails with a bounded timeout", async () => {
  await assert.rejects(
    () =>
      runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        capture: true,
        timeout: 150,
      }),
    /time limit/,
  );
});
test("Compose arrays and line-delimited status records expose only service status fields", () => {
  const rows = [
    {
      Service: "app",
      Name: "fixture-app-1",
      State: "running",
      Health: "healthy",
      Environment: { TOKEN: "must-not-escape" },
    },
    { Service: "worker", Name: "fixture-worker-1", State: "exited" },
  ];
  assert.deepEqual(
    parseServices(JSON.stringify(rows)),
    parseServices(rows.map((x) => JSON.stringify(x)).join("\n")),
  );
  assert.equal(
    JSON.stringify(parseServices(JSON.stringify(rows))).includes(
      "must-not-escape",
    ),
    false,
  );
  assert.deepEqual(parseServices("[]"), []);
});
