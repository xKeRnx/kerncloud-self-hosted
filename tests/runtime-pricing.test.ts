import test from "node:test";
import assert from "node:assert/strict";
import { runtimePlanBalance } from "../src/core/runtime-pricing.ts";
test("Planwechsel erhält verbrauchte Laufzeit und schreibt keinen Kauf erneut gut", () => {
  assert.equal(runtimePlanBalance(300, 100, 600), 400);
  assert.equal(runtimePlanBalance(600, 400, 300), 100);
  assert.equal(runtimePlanBalance(600, 100, 300), 0);
  assert.equal(runtimePlanBalance(300, 100, 300), 100);
  assert.equal(runtimePlanBalance(300, 100, 0), 0);
});
