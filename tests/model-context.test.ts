import test from "node:test";
import assert from "node:assert/strict";
import { artifactContext } from "../src/core/model-context.ts";
import type { Message } from "../src/core/types.ts";
const call = (id: string, name: string, args: unknown): Message => ({
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
const reply = (id: string, value: unknown): Message => ({
  role: "tool",
  tool_call_id: id,
  content: JSON.stringify(value),
});
test("Große gespeicherte Dateiversionen werden referenziert, Originalprotokoll und Tool-IDs bleiben erhalten", () => {
  const messages: Message[] = [
    { role: "system", content: "Rules" },
    { role: "user", content: "Goal" },
  ];
  for (let i = 0; i < 3; i++)
    messages.push(
      call("save" + i, "save_artifact", {
        name: "index.html",
        content: "x".repeat(100000),
      }),
      reply("save" + i, { artifact_id: "file" + i, name: "index.html" }),
    );
  const original = JSON.stringify(messages),
    compact = artifactContext(messages);
  assert.ok(Buffer.byteLength(original) > 180000);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 5000);
  assert.equal(JSON.stringify(messages), original);
  assert.deepEqual(
    compact.map((m) => m.tool_call_id),
    messages.map((m) => m.tool_call_id),
  );
  assert.match(compact[2].tool_calls![0].function.arguments, /file0/);
});
test("Mehrere aktuelle Dateiauszüge bleiben lesbar; Duplikate und übergroße Historie werden begrenzt", () => {
  const messages = [
    call("r1", "read_artifact", { artifact_id: "file", offset: 0 }),
    reply("r1", {
      name: "a.html",
      total_characters: 60000,
      offset: 0,
      content: "a".repeat(20000),
    }),
    call("r2", "read_artifact", { artifact_id: "file", offset: 20000 }),
    reply("r2", {
      name: "a.html",
      total_characters: 60000,
      offset: 20000,
      content: "b".repeat(20000),
    }),
  ];
  assert.deepEqual(artifactContext(messages), messages);
  messages.push(
    call("r3", "read_artifact", { artifact_id: "file", offset: 0 }),
    reply("r3", JSON.parse(messages[1].content!)),
  );
  const compact = artifactContext(messages);
  assert.match(compact[1].content!, /artifact_id=file/);
  assert.equal(JSON.parse(compact[1].content!).total_characters, 60000);
  assert.equal(compact[3].content, messages[3].content);
  assert.equal(compact[5].content, messages[5].content);
  for (let i = 4; i < 12; i++)
    messages.push(
      call("r" + i, "read_artifact", {
        artifact_id: "file",
        offset: i * 20000,
      }),
      reply("r" + i, {
        name: "a.html",
        total_characters: 300000,
        offset: i * 20000,
        content: "x".repeat(20000),
      }),
    );
  const bounded = artifactContext(messages);
  assert.equal(bounded.at(-1)!.content, messages.at(-1)!.content);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) < 100000);
});
test("Fehlgeschlagene und offene Dateiaktionen sowie Fehlerkorrekturen werden nicht als gespeichert zusammengefasst", () => {
  const messages = [
    call("pending", "save_artifact", { name: "a", content: "x".repeat(10000) }),
    call("bad", "save_artifact", { name: "b", content: "y".repeat(10000) }),
    {
      ...reply("bad", { ok: false, error: "Denied" }),
      recovery_code: "TOOL_CORRECTION",
    },
  ];
  assert.deepEqual(artifactContext(messages), messages);
});
test("Nutzeranweisungen und externe Werkzeugaufrufe samt ungeklärten Ergebnissen bleiben unverändert", () => {
  const messages: Message[] = [
    { role: "system", content: "Rules" },
    { role: "user", content: "x".repeat(200000) },
    call("external", "environment_command", { command: "do something" }),
    reply("external", { status: "uncertain", content: "y".repeat(20000) }),
  ];
  assert.deepEqual(artifactContext(messages), messages);
  assert.ok(
    Buffer.byteLength(JSON.stringify(artifactContext(messages))) > 180000,
  );
});

test("Gespeicherte Dateipakete bleiben bei fehlgeschlagener Browserprüfung referenziert statt kopiert", () => {
  const messages = [
    call("bundle", "deliver_artifacts", {
      files: [{ name: "index.html", content: "x".repeat(100000) }],
      checks: [{ action: "assert_text", selector: "body", value: "Working" }],
      summary: "Website",
    }),
    {
      ...reply("bundle", {
        files: [{ name: "index.html", artifact_id: "immutable-file" }],
        validation: { passed: false, errors: ["Actual JS failure"] },
      }),
      recovery_code: "TOOL_CORRECTION",
    },
  ];
  const original = JSON.stringify(messages),
    compact = artifactContext(messages);
  assert.equal(JSON.stringify(messages), original);
  assert.ok(JSON.stringify(compact).length < 2000);
  assert.match(compact[0].tool_calls![0].function.arguments, /immutable-file/);
  assert.equal(compact[1].content, messages[1].content);
  assert.deepEqual(artifactContext([messages[0]]), [messages[0]]);
});

test("Wiederverwendung gilt nur für tatsächlich sichtbare vollständige Ausschnitte", async () => {
  const { visibleArtifactReads } = await import("../src/core/model-context.ts");
  const messages = [
    call("read", "read_artifact", { artifact_id: "immutable-file" }),
    reply("read", {
      content: "Actual source",
      offset: 0,
      total_characters: 13,
    }),
  ];
  assert.deepEqual(visibleArtifactReads(messages), [
    { artifact_id: "immutable-file", offset: 0, length: 13, call_id: "read" },
  ]);
  assert.deepEqual(
    visibleArtifactReads([
      messages[0],
      reply("read", {
        content: "[Älterer Dateiauszug kompakt referenziert]",
        offset: 0,
        total_characters: 13,
      }),
    ]),
    [],
  );
  assert.deepEqual(
    visibleArtifactReads([
      messages[0],
      { ...messages[1], recovery_code: "TOOL_CORRECTION" },
    ]),
    [],
  );
  assert.deepEqual(
    visibleArtifactReads([
      messages[0],
      { ...messages[1], content: '{"content":"truncated' },
    ]),
    [],
  );
});
