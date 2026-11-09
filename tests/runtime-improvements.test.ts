import test from "node:test";
import assert from "node:assert/strict";
import {
  pipelineInput,
  resolveStepArgs,
  selectStepResult,
} from "../src/core/tool-pipeline.ts";
import { parseEnvironmentTool } from "../src/core/environment-tools.ts";
import { prepareAgentContext } from "../src/core/agent-context.ts";
import type { Message } from "../src/core/types.ts";
import {
  retryAfterSeconds,
  providerBackoff,
} from "../src/core/provider-health.ts";
import { searchToolIndex } from "../src/core/tool-search.ts";
import { evaluateAcceptance } from "../src/core/runtime-evaluation.ts";
import { artifactFingerprint } from "../src/core/artifact-validation.ts";
import { createHash } from "node:crypto";
test("Pipelines use bounded explicit steps and earlier results; no recursive or privileged tools", () => {
  assert.throws(() =>
    pipelineInput.parse({ steps: [{ tool: "tool_pipeline", args: {} }] }),
  );
  assert.throws(() =>
    pipelineInput.parse({
      steps: Array.from({ length: 13 }, () => ({
        tool: "read_artifact",
        args: {},
      })),
    }),
  );
  assert.deepEqual(
    resolveStepArgs({ artifact_id: { $step: 0, path: ["artifact_id"] } }, [
      { artifact_id: "saved" },
    ]),
    { artifact_id: "saved" },
  );
  assert.throws(() => resolveStepArgs({ $step: 1, path: [] }, [{}]));
  assert.throws(() => resolveStepArgs({ $step: 0, path: ["__proto__"] }, [{}]));
  assert.deepEqual(
    selectStepResult({ ok: false, error: "actual failure" }, ["ok"]),
    { ok: false, error: "actual failure" },
  );
  assert.deepEqual(
    selectStepResult({ ok: true, large: "private intermediate" }, ["ok"]),
    { ok: true },
  );
});
test("Long commands are explicit and process access needs task/environment identifiers", () => {
  const environment_id = "10000000-0000-4000-8000-000000000001";
  assert.throws(() =>
    parseEnvironmentTool("environment_command", {
      environment_id,
      command: "build",
      timeout_seconds: 31,
    }),
  );
  assert.equal(
    parseEnvironmentTool("environment_command", {
      environment_id,
      command: "build",
      timeout_seconds: 600,
      background: true,
    }).permission,
    "exec",
  );
  assert.throws(() =>
    parseEnvironmentTool("environment_command", {
      environment_id,
      command: "build",
      timeout_seconds: 1801,
      background: true,
    }),
  );
  assert.throws(() =>
    parseEnvironmentTool("environment_process", {
      environment_id,
      process_id: "guessed",
      action: "wait",
    }),
  );
});
test("Provider cooldown honors HTTP dates, caps invalid values and expands repeated failures", () => {
  assert.equal(retryAfterSeconds("120"), 120);
  assert.equal(
    retryAfterSeconds(
      "Wed, 21 Oct 2026 15:10:00 GMT",
      Date.parse("2026-10-21T15:00:00Z"),
    ),
    600,
  );
  assert.equal(retryAfterSeconds("bad"), 1);
  assert.equal(retryAfterSeconds("9999999"), 86400);
  assert.equal(providerBackoff("auth", 1), 300);
  assert.equal(providerBackoff("rate_limit", 4, 2), 8);
});
test("Search ranks only supplied tools and supports German action words", () => {
  const result = searchToolIndex(
    [
      { name: "environment_read_file", description: "Read project files" },
      { name: "environment_command", description: "Execute command" },
    ],
    "Dateien lesen",
  );
  assert.equal(result[0].name, "environment_read_file");
  assert.equal(
    searchToolIndex([{ name: "public", description: "Visible" }], "secret")
      .length,
    0,
  );
});
test("Independent acceptance rejects stale browser receipts and missing required interactions", () => {
  const content = "<h1>Fixture</h1>",
    id = "fixture-file",
    file = { id, name: "index.html", content };
  const report = {
    passed: true,
    fingerprint: artifactFingerprint([file]),
    results: [
      {
        viewport: { width: 390 },
        passed: true,
        errors: [],
        layout: { scroll: 390, client: 390 },
      },
    ],
    checks: [{ action: "click", selector: "#demo" }],
  };
  const receipt = {
    run: { status: "completed", tokens_used: 2, token_limit: 1000 },
    calls: [
      {
        status: "settled",
        usage_known: true,
        input_tokens: 1,
        output_tokens: 1,
      },
    ],
    assisted: false,
    operatorWritesAfterStart: 0,
    files: [
      {
        id,
        name: file.name,
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    ],
    operations: [
      {
        tool_name: "validate_artifact",
        result: { result: JSON.stringify(report) },
      },
    ],
    skills: [{ status: "draft" }],
    evidence: { evidence: [{ verified: true }] },
  };
  const expected = {
      name: "Fixture only",
      maxTokens: 1000,
      files: ["index.html"],
      widths: [390],
      assertions: [{ action: "click", selector: "#demo" }],
    },
    files = { "index.html": Buffer.from(content) };
  assert.equal(evaluateAcceptance(receipt, files, expected).passed, true);
  assert.equal(
    evaluateAcceptance(receipt, files, {
      ...expected,
      assertions: [{ action: "press", selector: "#demo", value: "Enter" }],
    }).passed,
    false,
  );
  assert.equal(
    evaluateAcceptance(
      {
        ...receipt,
        operations: [
          {
            tool_name: "validate_artifact",
            result: {
              result: JSON.stringify({ ...report, fingerprint: "stale" }),
            },
          },
        ],
      },
      files,
      expected,
    ).passed,
    false,
  );
  assert.equal(
    evaluateAcceptance(
      { ...receipt, run: { ...receipt.run, tokens_used: 5000 } },
      files,
      expected,
    ).passed,
    false,
  );
});
test("Cache preference preserves exact history when affordable and compacts under pressure without losing constraints", () => {
  const messages: Message[] = [
    { role: "system", content: "Policy" },
    { role: "user", content: "Keep exact task requirement: keyboard support" },
  ];
  for (let n = 0; n < 9; n++)
    messages.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c" + n,
            type: "function",
            function: {
              name: "read_artifact",
              arguments: JSON.stringify({ artifact_id: "f" + n }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "c" + n,
        content: JSON.stringify({ content: "x".repeat(1200) }),
      },
    );
  const stable = prepareAgentContext(messages, [], {
    automatic: true,
    contextStrategy: "cache_aware",
    cacheInputLimit: 100000,
    outputTokens: 2048,
  });
  assert.deepEqual(stable.messages, messages);
  assert.equal(stable.state.context_strategy, "cache_aware");
  const compact = prepareAgentContext(messages, [], {
    automatic: true,
    contextStrategy: "cache_aware",
    cacheInputLimit: 2000,
    outputTokens: 2048,
  });
  assert.equal(compact.state.context_strategy, "compact");
  assert.ok(compact.state.omitted_groups > 0);
  assert.ok(
    compact.messages.some((m) =>
      m.content?.includes("Keep exact task requirement"),
    ),
  );
});
