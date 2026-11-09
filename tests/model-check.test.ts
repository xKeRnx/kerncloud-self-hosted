import test from "node:test";
import assert from "node:assert/strict";
import {
  modelCheckWindow,
  modelCheckCountdown,
} from "../src/core/model-check.ts";

test("catalog cooldown expires at five minutes and tolerates absent timestamps", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  for (const value of [null, undefined, "", "invalid"])
    assert.equal(modelCheckWindow(value, now).remainingSeconds, 0);
  assert.equal(modelCheckWindow(new Date(now), now).remainingSeconds, 300);
  assert.equal(
    modelCheckWindow(new Date(now), now + 299_500).remainingSeconds,
    1,
  );
  assert.equal(
    modelCheckWindow(new Date(now), now + 300_000).remainingSeconds,
    0,
  );
  assert.equal(
    modelCheckWindow(new Date(now), now + 600_000).remainingSeconds,
    0,
  );
  assert.equal(
    modelCheckWindow(new Date(now), now + 10_000).nextCheckAt,
    "2026-10-24T12:05:00.000Z",
  );
  assert.equal(modelCheckCountdown(300), "05:00");
  assert.equal(modelCheckCountdown(61), "01:01");
  assert.equal(modelCheckCountdown(0), "00:00");
});
