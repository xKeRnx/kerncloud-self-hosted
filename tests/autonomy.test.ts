import test from "node:test";
import assert from "node:assert/strict";
import {
  activeTools,
  parseToolArguments,
  workingState,
} from "../src/core/autonomy.ts";
import { prepareAgentContext } from "../src/core/agent-context.ts";
import { artifactContext } from "../src/core/model-context.ts";
import {
  artifactFingerprint,
  validationInput,
} from "../src/core/artifact-validation.ts";
import type { Message } from "../src/core/types.ts";

test("Malformed/truncated arguments are never replaced by executable guesses", () => {
  for (const raw of ['{"changes":', "null", "[]", "true", ""])
    assert.equal(parseToolArguments(raw).error?.executed, false);
  assert.deepEqual(parseToolArguments('{"artifact_id":"ok"}').args, {
    artifact_id: "ok",
  });
});
test("Tool discovery starts small and never exposes unlisted definitions", () => {
  const tools = ["save_artifact", "environment_command", "mcp_private"].map(
    (name) => ({ function: { name } }),
  );
  assert.deepEqual(
    activeTools(tools).map((t) => t.function.name),
    ["save_artifact"],
  );
  assert.deepEqual(
    activeTools(tools, ["environment_command", "invented"]).map(
      (t) => t.function.name,
    ),
    ["save_artifact", "environment_command"],
  );
});
test("Automatic context reduction keeps all user constraints and complete latest tool pairs across resumes", () => {
  const m: Message[] = [
    { role: "system", content: "Permissions" },
    { role: "user", content: "Never publish; deliver a website" },
  ];
  for (let i = 0; i < 30; i++)
    m.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: String(i),
            type: "function",
            function: { name: "read_artifact", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: String(i), content: "source".repeat(1800) },
    );
  m.push({ role: "user", content: "New exact constraint after old work" });
  const original = JSON.stringify(m),
    p = prepareAgentContext(m, [], {
      outputTokens: 16384,
      automatic: true,
      inputTokenLimit: 60000,
    });
  assert.ok(p.estimatedInput <= 18000);
  assert.ok(p.state.omitted_groups > 0);
  assert.equal(JSON.stringify(m), original);
  for (const user of m.filter((x) => x.role === "user"))
    assert.ok(p.messages.some((x) => x.content === user.content));
  assert.ok(p.messages.some((x) => x.tool_call_id === "29"));
  const resumed = prepareAgentContext(JSON.parse(original), [], {
    outputTokens: 16384,
    automatic: true,
    inputTokenLimit: 60000,
  });
  assert.deepEqual(resumed.messages, p.messages);
  assert.deepEqual(workingState(JSON.parse(original)), workingState(m));
});
test("Applied patches become recoverable references; failed/pending patches remain verbatim", () => {
  const m: Message[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "p",
          type: "function",
          function: {
            name: "patch_artifact",
            arguments: JSON.stringify({
              artifact_id: "old",
              changes: [
                { find: "x".repeat(12000), replace: "y".repeat(12000) },
              ],
            }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "p",
      content: JSON.stringify({ artifact_id: "new", name: "index.html" }),
    },
  ];
  const copy = JSON.stringify(m),
    p = artifactContext(m);
  assert.ok(JSON.stringify(p).length < 1000);
  assert.equal(JSON.stringify(m), copy);
  assert.match(p[0].tool_calls![0].function.arguments, /new/);
  assert.deepEqual(artifactContext([m[0]]), [m[0]]);
  const bad = { ...m[1], recovery_code: "TOOL_CORRECTION" };
  assert.deepEqual(artifactContext([m[0], bad]), [m[0], bad]);
});
test("Browser acceptance requires an actual assertion and fingerprints all preview assets", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    validationInput.safeParse({
      artifact_id: id,
      checks: [{ action: "click", selector: "button" }],
    }).success,
    false,
  );
  assert.equal(
    validationInput.safeParse({
      artifact_id: id,
      checks: [
        { action: "assert_attribute", selector: "button", value: "true" },
      ],
    }).success,
    false,
  );
  assert.equal(
    validationInput.safeParse({
      artifact_id: id,
      checks: [{ action: "assert_text", selector: "body", value: "Hello" }],
    }).success,
    true,
  );
  const files = [
    { id, name: "index.html", content: "test" },
    { id: "css", name: "style.css", content: "body{}" },
  ];
  assert.equal(
    artifactFingerprint(files),
    artifactFingerprint([...files].reverse()),
  );
  assert.notEqual(
    artifactFingerprint(files),
    artifactFingerprint([{ ...files[0], content: "changed" }, files[1]]),
  );
});

test("Soft context target never drops an affordable mandatory user instruction", () => {
  const goal = "Do not change this constraint. ".repeat(900);
  const p = prepareAgentContext(
    [
      { role: "system", content: "Policy" },
      { role: "user", content: goal },
    ],
    [],
    { outputTokens: 8192, automatic: true, inputTokenLimit: 60000 },
  );
  assert.ok(p.estimatedInput > 18000);
  assert.equal(p.messages[1].content, goal);
});

test("Kleine erfolgreiche Schritte werden früh verdichtet, Vorgaben und offene Fehler bleiben erhalten", () => {
  const messages: Message[] = [
    { role: "system", content: "No external permissions" },
    { role: "user", content: "Keep this exact requirement" },
  ];
  for (let i = 0; i < 15; i++)
    messages.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: String(i),
            type: "function",
            function: {
              name: "read_memory",
              arguments: JSON.stringify({ key: "work" + i }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: String(i),
        content: JSON.stringify({
          ok: true,
          note: "Known work " + i + " " + "x".repeat(180),
        }),
      },
    );
  messages.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "failure",
          type: "function",
          function: { name: "validate_artifact", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "failure",
      content: "Actual failure must be repaired",
      recovery_code: "TOOL_CORRECTION",
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "pending",
          type: "function",
          function: { name: "save_artifact", arguments: "{}" },
        },
      ],
    },
  );
  const original = JSON.stringify(messages),
    compact = prepareAgentContext(messages, [], {
      automatic: true,
      outputTokens: 2048,
    });
  assert.equal(JSON.stringify(messages), original);
  assert.ok(compact.state.omitted_groups >= 12);
  assert.ok(JSON.stringify(compact.messages).length < original.length * 0.7);
  for (const id of ["12", "13", "14", "failure"])
    assert.ok(compact.messages.some((m) => m.tool_call_id === id));
  assert.ok(
    compact.messages.some((m) => m.tool_calls?.some((c) => c.id === "pending")),
  );
  assert.ok(
    compact.messages.some(
      (m) => m.role === "user" && m.content === "Keep this exact requirement",
    ),
  );
});
