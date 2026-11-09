import test from "node:test";
import assert from "node:assert/strict";
import {
  detectToolLoop,
  toolArgumentsHash,
  toolOutcomeHash,
  type ToolOutcome,
} from "../src/core/agent-loops.ts";
import {
  prepareAgentContext,
  modelRequestKey,
  ContextCapacityError,
} from "../src/core/agent-context.ts";
import { mayRetryModel, recoveryCount } from "../src/core/agent-recovery.ts";
import type { Message } from "../src/core/types.ts";
const outcome = (
  name: string,
  args: unknown,
  result: unknown,
  failed = false,
): ToolOutcome => ({
  tool_name: name,
  arguments_hash: toolArgumentsHash(args),
  outcome_hash: toolOutcomeHash(name, JSON.stringify(result)),
  failed,
});

test("Schleifenerkennung ignoriert flüchtige Metadaten, aber keine geänderten Ergebnisse", () => {
  assert.equal(
    toolArgumentsHash({ b: 2, a: 1 }),
    toolArgumentsHash({ a: 1, b: 2 }),
  );
  const rows = [1, 2, 3].map((i) =>
    outcome(
      "environment_command",
      { command: "test" },
      { ok: true, stdout: "same", duration_ms: i, pid: i },
    ),
  );
  assert.equal(
    detectToolLoop(
      rows,
      "environment_command",
      toolArgumentsHash({ command: "test" }),
    )?.kind,
    "no_progress",
  );
  assert.equal(
    detectToolLoop(
      [
        ...rows,
        outcome(
          "environment_command",
          { command: "test" },
          { ok: true, stdout: "new result" },
        ),
      ],
      "environment_command",
      toolArgumentsHash({ command: "test" }),
    ),
    null,
  );
  assert.equal(
    detectToolLoop(
      rows,
      "environment_command",
      toolArgumentsHash({ command: "other test" }),
    ),
    null,
  );
});
test("Identische Fehler und A/B-Schleifen werden früher als normale Fortschritte erkannt", () => {
  const bad = outcome(
    "read",
    { path: "missing" },
    { ok: false, error: "missing" },
    true,
  );
  assert.equal(
    detectToolLoop([bad, bad], "read", bad.arguments_hash)?.kind,
    "identical_errors",
  );
  const a = outcome("read", { path: "a" }, "A"),
    b = outcome("read", { path: "b" }, "B");
  assert.equal(
    detectToolLoop([a, b, a, b], "read", a.arguments_hash)?.kind,
    "ping_pong",
  );
  assert.equal(
    detectToolLoop(
      [a, b, a, { ...b, outcome_hash: "changed" }],
      "read",
      a.arguments_hash,
    ),
    null,
  );
});
test("Neu erzeugte Delegations-IDs verschleiern wiederholte identische Teilaufträge nicht", () => {
  assert.equal(
    toolOutcomeHash("delegate_task", '{"task_id":"one","agent":"Nova"}'),
    toolOutcomeHash("delegate_task", '{"task_id":"two","agent":"Nova"}'),
  );
  assert.notEqual(
    toolOutcomeHash("read_memory", '{"revision":1}'),
    toolOutcomeHash("read_memory", '{"revision":2}'),
  );
});
test("Bezahlte Antwort behält ihren Schlüssel über einen Systemkontext-Neuaufbau; neue Nutzeranweisung ist ein neuer Schritt", () => {
  const m: Message[] = [
    { role: "system", content: "old prefix" },
    { role: "user", content: "goal" },
  ];
  assert.equal(
    modelRequestKey(m),
    modelRequestKey([{ role: "system", content: "fresh prefix" }, m[1]]),
  );
  assert.notEqual(
    modelRequestKey(m),
    modelRequestKey([...m, { role: "user", content: "changed goal" }]),
  );
});
test("Kontextkürzung erhält Nutzeranweisungen, aktuelle Tool-Paare und das vollständige Original", () => {
  const m: Message[] = [
    { role: "system", content: "Rules" },
    { role: "user", content: "Never publish anything" },
  ];
  for (let i = 0; i < 35; i++)
    m.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `c${i}`,
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ path: `f${i}` }),
            },
          },
        ],
      },
      { role: "tool", tool_call_id: `c${i}`, content: "data".repeat(1500) },
    );
  m.push({ role: "user", content: "Keep these exact constraints" });
  const original = JSON.stringify(m),
    p = prepareAgentContext(m, [], {
      outputTokens: 4096,
      contextTokens: 32768,
    });
  assert.ok(p.state.omitted_groups > 0);
  assert.ok(p.estimatedInput + p.outputTokens + 2048 <= 32768);
  assert.equal(JSON.stringify(m), original);
  for (const input of m.filter((x) => x.role === "user"))
    assert.ok(p.messages.some((x) => x.content === input.content));
  assert.ok(p.messages.some((x) => x.tool_call_id === "c34"));
  for (const reply of p.messages.filter((x) => x.role === "tool"))
    assert.ok(
      p.messages.some((x) =>
        x.tool_calls?.some((c) => c.id === reply.tool_call_id),
      ),
    );
  assert.match(p.state.summary, /read_task_history/);
});
test("Große aktuelle Werkzeugausgaben bleiben nachlesbar und werden nicht als neue Anweisungen eingesetzt", () => {
  const m: Message[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "goal" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "x",
          type: "function",
          function: { name: "read", arguments: "{}" },
        },
      ],
    },
    { role: "tool", tool_call_id: "x", content: "CONTENT".repeat(10000) },
  ];
  const p = prepareAgentContext(m, [], {
    outputTokens: 4096,
    contextTokens: 32768,
  });
  assert.match(p.messages.at(-1)!.content!, /message_index=3/);
  assert.equal(m[3].content!.length, 70000);
  assert.ok(p.messages.at(-1)!.content!.length < 10000);
});
test("Unverzichtbare Anweisungen werden nicht still abgeschnitten; konfigurierte Modellgrenze beschränkt die Ausgabe", () => {
  assert.throws(
    () =>
      prepareAgentContext([{ role: "user", content: "x".repeat(20000) }], [], {
        outputTokens: 4096,
        contextTokens: 8192,
      }),
    ContextCapacityError,
  );
  assert.equal(
    prepareAgentContext([{ role: "user", content: "goal" }], [], {
      outputTokens: 524288,
    }).outputTokens,
    524288,
  );
  assert.equal(
    prepareAgentContext([{ role: "user", content: "goal" }], [], {
      outputTokens: 524288,
      contextTokens: 32768,
    }).outputTokens,
    16384,
  );
});
test("Restbudget begrenzt die Kontextprojektion; Originale, Nutzerregeln und Korrekturbelege bleiben erhalten", () => {
  const m: Message[] = [
    { role: "system", content: "Policy" },
    { role: "user", content: "Do not publish" },
  ];
  for (let i = 0; i < 12; i++)
    m.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `budget-${i}`,
            type: "function",
            function: { name: "read_artifact", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: `budget-${i}`,
        content: "data".repeat(1800),
      },
    );
  const original = JSON.stringify(m);
  const p = prepareAgentContext(m, [], {
    outputTokens: 524288,
    inputTokenLimit: 18000,
  });
  assert.ok(p.estimatedInput <= 18000);
  assert.ok(p.state.omitted_groups > 0);
  assert.equal(JSON.stringify(m), original);
  assert.ok(p.messages.some((x) => x.content === "Do not publish"));
  assert.match(
    p.messages.find((x) => x.tool_call_id === "budget-11")!.content!,
    /message_index=25/,
  );
  assert.throws(
    () =>
      prepareAgentContext([{ role: "user", content: "x".repeat(10000) }], [], {
        outputTokens: 4096,
        inputTokenLimit: 3000,
      }),
    ContextCapacityError,
  );
  const correction: Message = {
    role: "tool",
    tool_call_id: "e",
    content: "error".repeat(3000),
    recovery_code: "TOOL_CORRECTION",
  };
  const c = prepareAgentContext(
    [{ role: "system", content: "rules" }, correction],
    [],
    { outputTokens: 4096, inputTokenLimit: 20000 },
  );
  assert.equal(c.messages.at(-1)!.content, correction.content);
});
test("Nur eine neue menschliche Anweisung erneuert das Reparaturbudget; ein Neustart tut das nicht", () => {
  const errors: Message[] = Array.from({ length: 6 }, () => ({
    role: "tool",
    content: "bad",
    recovery_code: "TOOL_CORRECTION",
  }));
  assert.equal(recoveryCount(errors), 6);
  assert.equal(mayRetryModel(errors), false);
  assert.equal(recoveryCount(JSON.parse(JSON.stringify(errors))), 6);
  assert.equal(
    mayRetryModel([
      ...errors,
      { role: "user", content: "I fixed the configuration; continue" },
    ]),
    true,
  );
  assert.equal(
    mayRetryModel([
      { role: "user", content: "retry", recovery_code: "MODEL_RESTART" },
    ]),
    false,
  );
});
