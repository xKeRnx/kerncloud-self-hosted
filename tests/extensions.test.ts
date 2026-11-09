import test from "node:test";
import assert from "node:assert/strict";
import { creditCost } from "../src/core/pricing.ts";
import { mentionedAgents } from "../src/core/mentions.ts";
import { readModelResponse } from "../src/server/live.ts";
test("Credit-Tarife rechnen Eingabe, Ausgabe und Grundpreis getrennt, mit Rundung pro Aufruf", () => {
  assert.equal(
    creditCost(1000, 100, { input_rate: 2, output_rate: 8, base_credits: 3 }),
    6,
  );
  assert.equal(
    creditCost(3, 2, { input_rate: 0, output_rate: 0, base_credits: 0 }),
    0,
  );
  assert.equal(
    creditCost(120, 0, {
      input_rate: 1000,
      output_rate: 1000,
      base_credits: 0,
    }),
    120,
  );
  assert.throws(() =>
    creditCost(-1, 1, { input_rate: 1, output_rate: 1, base_credits: 0 }),
  );
});
test("@-Erwähnungen wählen benannte Agenten eindeutig und erkennen @alle", () => {
  const agents = [
    { id: "a", name: "Atlas" },
    { id: "b", name: "Nova" },
    { id: "c", name: "Content Team" },
  ];
  assert.deepEqual(
    mentionedAgents("@atlas und @Nova prüfen das. @Atlas", agents),
    ["a", "b"],
  );
  assert.deepEqual(mentionedAgents("@Content_Team bitte helfen", agents), [
    "c",
  ]);
  assert.deepEqual(mentionedAgents("@alle bitte prüfen", agents), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(mentionedAgents("Kein Empfänger", agents), []);
  assert.throws(() =>
    mentionedAgents("@Atlas", [...agents, { id: "d", name: "atlas" }]),
  );
});
test("SSE liest fragmentierte UTF-8-Antworten, Werkzeugargumente und Token-Nutzung", async () => {
  const payload =
    [
      {
        choices: [
          {
            delta: {
              role: "assistant",
              content: "Grüße ",
              tool_calls: [
                {
                  index: 0,
                  id: "call_",
                  function: { name: "read_", arguments: '{"attachment_' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              content: "Team",
              tool_calls: [
                {
                  index: 0,
                  id: "1",
                  function: { name: "attachment", arguments: 'id":"file"}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]
      .map((x) => `data: ${JSON.stringify(x)}\r\n\r\n`)
      .join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(payload);
  let offset = 0;
  const response = new Response(
    new ReadableStream({
      pull(c) {
        if (offset >= bytes.length) {
          c.close();
          return;
        }
        c.enqueue(bytes.slice(offset, offset + 7));
        offset += 7;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  let live = "";
  const result = await readModelResponse(response, async (text) => {
    live += text;
  });
  assert.equal(live, "Grüße Team");
  assert.equal(result.choices[0].message.content, live);
  assert.equal(
    result.choices[0].message.tool_calls[0].function.name,
    "read_attachment",
  );
  assert.deepEqual(
    JSON.parse(result.choices[0].message.tool_calls[0].function.arguments),
    { attachment_id: "file" },
  );
  assert.equal(result.usage.total_tokens, 15);
});
