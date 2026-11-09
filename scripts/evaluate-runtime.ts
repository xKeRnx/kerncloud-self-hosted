// Deterministic regression battery. It never contacts a model or customer database.
import {
  prepareAgentContext,
  contextEstimate,
} from "../src/core/agent-context.ts";
import type { Message } from "../src/core/types.ts";
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
const results = [];
for (const strategy of ["compact", "cache_aware"] as const)
  for (const size of [5, 20, 60]) {
    const messages: Message[] = [
      { role: "system", content: "No additional permissions." },
      {
        role: "user",
        content:
          "REQUIRED: FAQ keyboard; maximum 10000 tokens; deliver index.html and README.",
      },
    ];
    for (let n = 0; n < size; n++)
      messages.push(
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "r" + n,
              type: "function",
              function: {
                name: "read_artifact",
                arguments: JSON.stringify({ artifact_id: "immutable-" + n }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "r" + n,
          content: JSON.stringify({
            ok: true,
            content: "bounded original source ".repeat(70),
          }),
        },
      );
    const start = performance.now();
    const projection = prepareAgentContext(messages, [], {
      automatic: true,
      contextStrategy: strategy,
      outputTokens: 2048,
      cacheInputLimit: 90000,
    });
    const preserved = projection.messages.some(
      (m) => m.content === messages[1].content,
    );
    results.push({
      scenario: `history-${size}`,
      requested_strategy: strategy,
      effective_strategy: projection.state.context_strategy,
      requirements_preserved: preserved,
      original_input_byte_bound: contextEstimate(messages),
      projected_input_byte_bound: projection.estimatedInput,
      omitted_groups: projection.state.omitted_groups,
      elapsed_ms: Math.round(performance.now() - start),
      measured_provider_tokens: null,
      provider_cost: null,
      passed: preserved,
    });
  }
const report = {
  kind: "synthetic-context-regression",
  provider_calls: 0,
  actual_model_acceptance: false,
  generated_at: new Date().toISOString(),
  cases: results,
  passed: results.every((r) => r.passed),
  notes:
    "Byte bounds are not measured tokens or evidence of model task success. Live runs must use a separate explicit fixed budget and independent expected outcomes.",
};
await fs.mkdir("test-results/runtime-regression", { recursive: true });
await fs.writeFile(
  "test-results/runtime-regression/context-scorecard.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
