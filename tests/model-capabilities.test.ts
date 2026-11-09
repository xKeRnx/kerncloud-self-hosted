import test from "node:test";
import assert from "node:assert/strict";
import {
  parseModelCapabilities,
  allowedReasoning,
  applyCapabilityLimits,
  capabilityIssue,
} from "../src/core/model-capabilities.ts";
test("Provider metadata keeps unknown values unknown and never trusts descriptions or malformed limits", () => {
  const c = parseModelCapabilities({
    id: "opaque",
    description: "context 999999999; secret",
    context_length: -1,
    max_output_tokens: "1234",
  });
  assert.equal(c.context_window_tokens, undefined);
  assert.equal(c.max_output_tokens, undefined);
  assert.equal(c.reasoning_efforts, null);
  assert.deepEqual(allowedReasoning(c, true), []);
  assert.ok(!JSON.stringify(c).includes("secret"));
});
test("Per-model catalog limits, mandatory reasoning and explicit allowlists are conservative", () => {
  const c = parseModelCapabilities({
    context_length: 64000,
    top_provider: { context_length: 32000, max_completion_tokens: 4096 },
    reasoning: {
      supported_efforts: ["none", "low", "high", "invented"],
      mandatory: true,
    },
  });
  assert.equal(c.context_window_tokens, 32000);
  assert.equal(c.max_output_tokens, 4096);
  assert.deepEqual(c.reasoning_efforts, ["low", "high"]);
  assert.deepEqual(
    parseModelCapabilities({ supported_parameters: ["temperature"] })
      .reasoning_efforts,
    [],
  );
  assert.ok(
    parseModelCapabilities(
      { reasoning: { supported_efforts: null } },
      true,
    ).reasoning_efforts?.includes("none"),
  );
  assert.equal(
    parseModelCapabilities({ reasoning: { supported_efforts: null } })
      .reasoning_efforts,
    null,
  );
  const m = {
    capabilities: c,
    max_output_tokens: 8192,
    context_window_tokens: 131072,
    reasoning_effort: "auto",
    auto_reasoning_effort: "low",
  };
  assert.equal(applyCapabilityLimits(m).max_output_tokens, 4096);
  assert.equal(applyCapabilityLimits(m).context_window_tokens, 32000);
  assert.equal(capabilityIssue(m), null);
  assert.ok(capabilityIssue({ ...m, auto_reasoning_effort: "max" }));
  assert.equal(
    capabilityIssue({
      ...m,
      reasoning_effort: "provider_default",
      auto_reasoning_effort: "none",
    }),
    null,
  );
  assert.equal(
    applyCapabilityLimits({
      ...m,
      capabilities: { context_window_tokens: 1e12, max_output_tokens: 1e12 },
    }).max_output_tokens,
    8192,
  );
});
