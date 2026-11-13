import test from "node:test";
import assert from "node:assert/strict";
import {
  engineRequest,
  normalizeEngineResponse,
  engineKinds,
} from "../src/core/inference-engine.ts";
import { modeAllowsTool } from "../src/core/work-modes.ts";
import type { Message } from "../src/core/types.ts";

const messages: Message[] = [
  { role: "system", content: "Only authorized actions." },
  { role: "user", content: "Build a report." },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "read_artifact", arguments: '{"id":"file"}' },
      },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "Source" },
];
const parameters = {
  model: "protocol-fixture",
  messages,
  tools: [
    {
      type: "function",
      function: {
        name: "read_artifact",
        description: "Read a file",
        parameters: { type: "object", properties: { id: { type: "string" } } },
      },
    },
  ],
  output: 321,
  secret: "fixture-only",
  stream: true,
  reasoning: { reasoning_effort: "low" },
};
test("All API adapters retain the fixed output cap and native tool result correlation", () => {
  for (const kind of engineKinds) {
    const r = engineRequest(kind, parameters),
      body: any = r.body;
    assert.equal(
      body.max_completion_tokens ?? body.max_output_tokens ?? body.max_tokens,
      321,
    );
    assert.ok(
      !("previous_response_id" in body),
      "No implicit unbounded provider session",
    );
    assert.match(JSON.stringify(body), /call_1/);
    assert.ok(!JSON.stringify(body).includes(parameters.secret));
    assert.equal(
      kind === "anthropic" ? r.headers["x-api-key"] : r.headers.Authorization,
      kind === "anthropic" ? "fixture-only" : "Bearer fixture-only",
    );
  }
  const r: any = engineRequest("openai-responses", parameters).body;
  assert.equal(r.store, false);
  assert.equal(r.parallel_tool_calls, false);
  assert.equal(r.reasoning.effort, "low");
  assert.deepEqual(r.input.at(-1), {
    type: "function_call_output",
    call_id: "call_1",
    output: "Source",
  });
});
test("Native Responses usage includes reasoning in output and preserves opaque continuation only for the same model", () => {
  const response = normalizeEngineResponse("openai-responses", {
    model: "protocol-fixture",
    status: "completed",
    output: [
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "opaque-fixture",
      },
      {
        type: "function_call",
        call_id: "c1",
        name: "finish_task",
        arguments: "{}",
      },
    ],
    usage: {
      input_tokens: 60,
      output_tokens: 40,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens_details: { reasoning_tokens: 30 },
    },
  });
  assert.equal(response.usage.completion_tokens, 40);
  assert.equal(response.usage.prompt_tokens, 60);
  const message = response.choices[0].message;
  const next: any = engineRequest("openai-responses", {
    ...parameters,
    messages: [message],
  }).body;
  assert.equal(next.input[0].encrypted_content, "opaque-fixture");
  assert.ok(
    !JSON.stringify(
      engineRequest("openai-chat", { ...parameters, messages: [message] }).body,
    ).includes("opaque-fixture"),
  );
  assert.ok(
    !JSON.stringify(
      engineRequest("openai-responses", {
        ...parameters,
        model: "different",
        messages: [message],
      }).body,
    ).includes("opaque-fixture"),
  );
});
test("Incomplete native outputs retain billable usage but never become successful tool calls", () => {
  for (const kind of ["openai-responses", "anthropic"] as const) {
    const value =
      kind === "anthropic"
        ? {
            stop_reason: "max_tokens",
            content: [
              { type: "tool_use", id: "a", name: "finish_task", input: {} },
            ],
          }
        : {
            status: "incomplete",
            output: [
              {
                type: "function_call",
                call_id: "a",
                name: "finish_task",
                arguments: "{}",
              },
            ],
          };
    const response = normalizeEngineResponse(kind, {
      ...value,
      usage: { input_tokens: 80, output_tokens: 20 },
    });
    assert.equal(response.choices[0].finish_reason, "length");
    assert.equal(response.usage.completion_tokens, 20);
  }
  assert.equal(
    normalizeEngineResponse("anthropic", {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done" }],
    }).usage,
    undefined,
    "Unreported usage stays unknown",
  );
});
test("Anthropic cache read and write tokens remain part of the total task consumption", () => {
  const response = normalizeEngineResponse("anthropic", {
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Report" }],
    usage: {
      input_tokens: 10,
      output_tokens: 15,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 20,
    },
  });
  assert.equal(response.usage.prompt_tokens, 60);
  assert.equal(response.usage.prompt_tokens_details.cached_tokens, 30);
});
test("Drafts cannot run external tools or bypass the mode through pipelines; execute mode cannot hire or delegate", () => {
  for (const name of [
    "bridge_action",
    "environment_exec",
    "tool_pipeline",
    "delegate_task",
    "request_agent",
    "restructure_team",
    "mcp_server_tool",
  ])
    assert.equal(modeAllowsTool("draft", name), false, name);
  for (const name of [
    "save_artifact",
    "patch_artifact",
    "deliver_artifacts",
    "save_project_page",
    "list_project_pages",
  ])
    assert.equal(modeAllowsTool("draft", name), true, name);
  assert.equal(modeAllowsTool("execute", "delegate_task"), false);
  assert.equal(modeAllowsTool("execute", "request_agent"), false);
  assert.equal(modeAllowsTool("team", "delegate_task"), true);
  assert.equal(
    modeAllowsTool(undefined, "delegate_task"),
    true,
    "Existing task policy preserved",
  );
});
