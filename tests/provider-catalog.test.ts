import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  parseProviderCatalog,
  filterProviderModels,
} from "../src/core/provider-catalog.ts";
import {
  inspectProviderCatalog,
  inspectModel,
} from "../src/server/model-discovery.ts";

test("Provider catalogs sanitize and deduplicate entries; local search matches name and ID", () => {
  const result = parseProviderCatalog({
    data: [
      null,
      {},
      { id: "" },
      { id: "bad\nidentifier" },
      { id: "x".repeat(201) },
      {
        id: "z/model",
        name: "Alpha\nModel",
        context_length: 4096,
        secret: "private",
        description: "private",
      },
      { id: "z/model", name: "duplicate" },
      { id: "opaque" },
    ],
  })!;
  assert.equal(result.models.length, 2);
  assert.equal(result.models[0].prices, null);
  const priced = parseProviderCatalog(
    {
      data: [
        {
          id: "provider/model",
          name: "Named",
          pricing: { prompt: "0.000001", completion: "0", request: "0" },
        },
      ],
    },
    true,
    "openrouter.ai",
  )!;
  assert.equal(priced.models[0].provider, "openrouter.ai");
  assert.equal(priced.models[0].prices?.input_per_million, 1);
  assert.equal(priced.models[0].prices?.output_per_million, 0);
  assert.equal(result.models[0].name, "Alpha Model");
  assert.equal(result.models[0].capabilities.context_window_tokens, 4096);
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.deepEqual(
    filterProviderModels(result.models, "  ALPHA  z/model ").map((x) => x.id),
    ["z/model"],
  );
  assert.equal(filterProviderModels(result.models, "missing").length, 0);
  assert.equal(filterProviderModels(result.models, "").length, 2);
  assert.equal(parseProviderCatalog({ models: [] }), null);
  assert.deepEqual(parseProviderCatalog({ data: [] })?.models, []);
  assert.equal(
    parseProviderCatalog({ data: [], has_more: true })?.partial,
    true,
  );
  const large = parseProviderCatalog({
    data: Array.from({ length: 5001 }, (_, i) => ({ id: String(i) })),
  })!;
  assert.equal(large.models.length, 5000);
  assert.equal(large.partial, true);
});

test("Catalog transport stays read-only, bounded, redirect-safe and reports incomplete lists honestly", async () => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  let redirected = false,
    generated = false,
    authenticated = false;
  const server = createServer((req, res) => {
    if (req.url?.includes("chat")) generated = true;
    if (req.url === "/target") redirected = true;
    if (req.url === "/ok/models") {
      authenticated = req.headers.authorization === "Bearer fixture-only";
      return res.end(JSON.stringify({ data: [{ id: "one", name: "One" }] }));
    }
    if (req.url === "/partial/models")
      return res.end(JSON.stringify({ data: [], has_more: true }));
    if (req.url === "/empty/models")
      return res.end(JSON.stringify({ data: [] }));
    if (req.url === "/redirect/models") {
      res.statusCode = 302;
      res.setHeader("Location", "/target");
      return res.end();
    }
    if (req.url === "/huge/models")
      return res.end("x".repeat(16 * 1024 * 1024 + 1));
    res.statusCode = 401;
    res.end("private provider diagnostic");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal(
      (await inspectProviderCatalog(base + "/ok", "fixture-only")).models[0].id,
      "one",
    );
    assert.equal(authenticated, true);
    assert.equal(
      (await inspectModel(base + "/partial", "missing", "")).status,
      "unsupported",
    );
    assert.equal(
      (await inspectModel(base + "/empty", "missing", "")).status,
      "unlisted",
    );
    assert.equal(
      (await inspectProviderCatalog(base + "/redirect", "")).status,
      "unavailable",
    );
    const denied = await inspectProviderCatalog(base + "/denied", "");
    assert.equal(denied.status, "unavailable");
    assert.ok(!JSON.stringify(denied).includes("private"));
    assert.equal(
      (await inspectProviderCatalog(base + "/huge", "")).status,
      "unsupported",
    );
    assert.equal(redirected, false);
    assert.equal(generated, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
