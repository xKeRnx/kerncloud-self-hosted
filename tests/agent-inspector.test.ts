import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectionEntry,
  inspectorPayload,
  inspectorText,
} from "../src/core/agent-inspector.ts";
import { resolveWorkspacePath } from "../src/core/navigation.ts";
test("agent inspector links survive reload and remain in the agent section", () => {
  assert.deepEqual(resolveWorkspacePath("/agents/agent-123"), {
    view: "agents",
    agentId: "agent-123",
  });
  assert.equal(resolveWorkspacePath("/agents/agent-123/other"), null);
});
test("inspection projections hide credentials and reasoning and never project raw provider objects", () => {
  const value = inspectorPayload(
    JSON.stringify({
      password: "hidden-password",
      nested: { api_key: "hidden-api", reasoning_details: "hidden-reasoning" },
      url: "https://user:private@fixture.invalid?token=private-query",
      result: "Bearer private-bearer",
      command: "API_KEY=private-env echo hello",
    }),
  );
  for (const v of [
    "hidden-password",
    "hidden-api",
    "hidden-reasoning",
    "private-query",
    "private-bearer",
    "private-env",
    "user:private",
  ])
    assert.ok(!value.includes(v), value);
  assert.ok(value.includes("echo hello"));
  assert.equal(JSON.parse(value).password, "[redacted]");
  assert.ok(
    !inspectorPayload({
      private_key: "private-pem",
      client_secret: "private-client",
    }).includes("private-pem"),
  );
  assert.ok(inspectorText("sk-private-key").includes("[redacted]"));
  const row = inspectionEntry(4, {
    role: "assistant",
    content: "Visible reply",
    reasoning: "invisible analysis",
    tool_calls: [
      {
        id: "call-1",
        function: {
          name: "team_message",
          arguments: '{"message":"hello","token":"private"}',
        },
      },
    ],
  });
  assert.equal(row.index, 4);
  assert.equal(row.content, "Visible reply");
  assert.ok(!JSON.stringify(row).includes("invisible analysis"));
  assert.ok(!row.tools[0].arguments.includes("private"));
  assert.equal(
    inspectionEntry(5, { role: "tool", content: "x".repeat(9000) }).content
      .length,
    6000,
  );
  assert.equal(
    inspectionEntry(5, { role: "tool", content: "x".repeat(9000) }).truncated,
    true,
  );
});
