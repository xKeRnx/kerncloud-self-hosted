const test = require("node:test"),
  assert = require("node:assert/strict");
const progress = require("../progress.js");
test("quiet builds keep elapsed time and a useful note without inventing completion", () => {
  let state = progress.begin("start", 1000);
  state = progress.apply(state, { phase: "build" }, 2000);
  const view = progress.view(state, "en", 63000);
  assert.equal(view.elapsed, "1:02");
  assert.equal(view.quiet, true);
  assert.match(view.note, /No new output/);
  assert.equal(view.steps.find((x) => x.phase === "build").state, "active");
  assert.equal(view.steps.find((x) => x.phase === "health").state, "pending");
  state = progress.apply(state, { detail: "Build output received" }, 64000);
  assert.equal(progress.view(state, "en", 65000).quiet, false);
});
test("a failed startup never marks readiness complete; only successful command exit does", () => {
  const initial = progress.apply(
    progress.begin("start", 1000),
    { phase: "services" },
    2000,
  );
  const failed = progress.apply(initial, { done: true, failed: true }, 3000),
    view = progress.view(failed, "de", 9000);
  assert.equal(view.elapsed, "0:02");
  assert.match(view.heading, /nicht abgeschlossen/);
  assert.equal(view.steps.find((x) => x.phase === "services").state, "failed");
  assert.equal(view.steps.find((x) => x.phase === "health").state, "pending");
  assert.equal(
    progress
      .view(progress.apply(initial, { done: true }, 3000))
      .steps.every((x) => x.state === "complete"),
    true,
  );
});
test("service summaries distinguish stopped, warming up, ready and partially failed stacks", () => {
  assert.equal(progress.serviceSummary(null, false), "unknown");
  assert.equal(progress.serviceSummary([], false), "stopped");
  assert.equal(
    progress.serviceSummary([{ state: "exited" }], false),
    "stopped",
  );
  assert.equal(
    progress.serviceSummary([{ state: "running", health: "starting" }], false),
    "starting",
  );
  assert.equal(
    progress.serviceSummary([{ state: "running", health: "healthy" }], true),
    "running",
  );
  assert.equal(
    progress.serviceSummary(
      [{ state: "running", health: "healthy" }, { state: "exited" }],
      true,
    ),
    "attention",
  );
});
