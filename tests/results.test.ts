import test from "node:test";
import assert from "node:assert/strict";
import { modelResultProblem } from "../src/core/model-result.ts";
import { artifactPath, resultFiles } from "../src/core/artifacts.ts";
import { previewHtml, previewCsp } from "../src/server/artifacts.ts";
import { readModelResponse } from "../src/server/live.ts";

test("Leere Antworten, Tokenabbruch und unvollständige Werkzeugaufrufe sind kein Erfolg", () => {
  assert.match(
    modelResultProblem({ role: "assistant", content: null })!,
    /leere Antwort/,
  );
  assert.match(
    modelResultProblem({ role: "assistant", content: "   " })!,
    /leere Antwort/,
  );
  assert.match(
    modelResultProblem({ role: "assistant", content: "unfinished" }, "length")!,
    /Ausgabelimit/,
  );
  const tool = {
    id: "call1",
    type: "function" as const,
    function: { name: "save_artifact", arguments: "{}" },
  };
  assert.equal(
    modelResultProblem(
      { role: "assistant", content: null, tool_calls: [tool] },
      "tool_calls",
    ),
    null,
  );
  assert.match(
    modelResultProblem(
      { role: "assistant", content: null, tool_calls: [tool] },
      "length",
    )!,
    /Ausgabelimit/,
  );
  assert.match(
    modelResultProblem({
      role: "assistant",
      content: null,
      tool_calls: [{ ...tool, id: "" }],
    })!,
    /unvollständigen Werkzeugaufruf/,
  );
  assert.equal(
    modelResultProblem({ role: "assistant", content: "Delivered." }, "stop"),
    null,
  );
});
test("SSE erhält Abbruchgrund und Verbrauch; Fehler und abgebrochene Streams werden abgewiesen", async () => {
  const frames = [
    { choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: "length" }] },
    {
      choices: [],
      usage: {
        completion_tokens: 2048,
        completion_tokens_details: { reasoning_tokens: 2048 },
      },
    },
  ];
  const stream = (text: string) =>
    new Response(text, { headers: { "content-type": "text/event-stream" } });
  const answer = await readModelResponse(
    stream(
      frames.map((x) => "data: " + JSON.stringify(x) + "\n\n").join("") +
        "data: [DONE]\n\n",
    ),
    async () => {},
  );
  assert.equal(answer.choices[0].finish_reason, "length");
  assert.equal(answer.usage.completion_tokens, 2048);
  assert.equal(answer.choices[0].message.content, null);
  await assert.rejects(
    () =>
      readModelResponse(
        stream('data: {"error":{"message":"private provider detail"}}\n\n'),
        async () => {},
      ),
    /Antwortstream einen Fehler/,
  );
  await assert.rejects(
    () =>
      readModelResponse(
        stream('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
        async () => {},
      ),
    /ohne Abschluss unterbrochen/,
  );
});
test("Vollständige Code-Dateien werden erkannt; unvollständige Blöcke und unsichere Pfade nicht", () => {
  const files = resultFiles(
    "Here are files:\n```html\n<html>Hi</html>\n```\n```css filename=assets/style.css\nh1{color:red}\n```",
  );
  assert.deepEqual(
    files.map((f) => f.name),
    ["index.html", "assets/style.css"],
  );
  assert.equal(resultFiles("```html\nunfinished").length, 0);
  assert.equal(
    resultFiles("```js filename=../escape.js\nalert(1)\n```").length,
    0,
  );
  assert.equal(
    resultFiles("<!doctype html><html><body>Hi</body></html>")[0].name,
    "index.html",
  );
  for (const name of ["../file", "/file", "C:\\file", "a/../../b", "a\nfile"])
    assert.throws(() => artifactPath(name));
  assert.equal(artifactPath("assets/style.css"), "assets/style.css");
});
test("Vorschau bindet nur eigene lokale Assets ein und schottet aktive Inhalte ab", () => {
  const html = previewHtml(
    {
      name: "site/index.html",
      content:
        '<html><link rel="stylesheet" href="../assets/style.css"><script src="app.js"></script><link rel="stylesheet" href="https://outside.test/evil.css"></html>',
    },
    [
      { name: "assets/style.css", content: "h1{color:red}" },
      { name: "site/app.js", content: 'document.body.dataset.ready="yes"' },
    ],
  );
  assert.match(html, /<style>h1\{color:red\}<\/style>/);
  assert.match(html, /<script>document.body.dataset.ready/);
  assert.match(html, /href="https:\/\/outside.test/);
  assert.match(previewCsp, /connect-src 'none'/);
  assert.match(previewCsp, /sandbox allow-scripts/);
  assert.doesNotMatch(previewCsp, /allow-same-origin|https:|http:/);
  assert.match(
    previewHtml({ name: "code.ts", content: "<script>bad()</script>" }, []),
    /&lt;script&gt;bad/,
  );
});
