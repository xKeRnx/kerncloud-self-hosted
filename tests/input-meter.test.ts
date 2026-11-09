import test from "node:test";
import assert from "node:assert/strict";
import { inputBasis, measuredInputBound } from "../src/core/input-meter.ts";
import type { Message } from "../src/core/types.ts";
test("Measured input reuse requires the exact same model, system and tool prefix", () => {
  const m: Message[] = [
    { role: "system", content: "Policy" },
    { role: "user", content: "Goal" },
  ];
  const p = { ...inputBasis(m, [], "model-a"), tokens: 1000 };
  assert.equal(
    measuredInputBound(p, inputBasis(m, [], "model-b"), 10000),
    10000,
  );
  assert.equal(
    measuredInputBound(
      p,
      inputBasis([{ role: "system", content: "Changed" }, m[1]], [], "model-a"),
      10000,
    ),
    10000,
  );
  assert.equal(
    measuredInputBound(
      p,
      inputBasis(m, [{ name: "new-tool" }], "model-a"),
      10000,
    ),
    10000,
  );
  assert.ok(
    measuredInputBound(p, inputBasis(m, [], "model-a"), 10000) >= p.tokens,
  );
});
test("New/changed input is charged at a byte bound; removed history is never subtracted", () => {
  const m: Message[] = [
    { role: "system", content: "Policy" },
    { role: "user", content: "Goal" },
    { role: "tool", content: "old" },
  ];
  const p = { ...inputBasis(m, [], "m"), tokens: 1000 };
  const current = inputBasis(
    [...m, { role: "assistant", content: "x".repeat(3000) }],
    [],
    "m",
  );
  const result = measuredInputBound(p, current, 10000);
  assert.ok(result >= 4000 && result < 10000);
  assert.ok(
    measuredInputBound(p, inputBasis(m.slice(0, 2), [], "m"), 10000) >=
      p.tokens,
  );
  const duplicated = inputBasis([m[0], m[1], m[1]], [], "m");
  assert.ok(
    measuredInputBound(p, duplicated, 10000) >
      measuredInputBound(p, inputBasis(m.slice(0, 2), [], "m"), 10000),
  );
  assert.equal(measuredInputBound({ ...p, tokens: 0 }, current, 10000), 10000);
});

test("Browser assertions accept typed primitive values without an extra repair call", async () => {
  const { validationInput } =
    await import("../src/core/artifact-validation.ts");
  const id = "11111111-1111-4111-8111-111111111111";
  const parsed = validationInput.parse({
    artifact_id: id,
    checks: [
      { action: "assert_visible", selector: "#answer", value: false },
      { action: "assert_count", selector: "button", value: 3 },
    ],
  });
  assert.equal(parsed.checks[0].value, "false");
  assert.equal(parsed.checks[1].value, "3");
});
