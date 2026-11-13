import { test } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  budgetFits,
  postInput,
  publicUrl,
  searchPlan,
  sourceResults,
  compactResearch,
} from "../src/core/studio-research.ts";
import { integrationHeaders } from "../src/core/integration-plans.ts";
import { modeAllowsTool } from "../src/core/work-modes.ts";
import { resolveWorkspacePath } from "../src/core/navigation.ts";
test("monetary ceilings use integer micro-USD and fail closed at exact request and cost boundaries", () => {
  assert.equal(money.parse("0.000001"), 1);
  assert.equal(money.parse("1.123456"), 1123456);
  for (const bad of ["-1", "NaN", "1e3", "0.1234567", "1000000"])
    assert.equal(money.safeParse(bad).success, false);
  assert.equal(
    budgetFits(
      { cost_limit: 10, cost_used: 9, request_limit: 1, requests_used: 0 },
      1,
    ),
    true,
  );
  assert.equal(
    budgetFits(
      { cost_limit: 10, cost_used: 10, request_limit: 1, requests_used: 0 },
      1,
    ),
    false,
  );
  assert.equal(
    budgetFits(
      { cost_limit: 10, cost_used: 0, request_limit: 1, requests_used: 1 },
      0,
    ),
    false,
  );
  assert.equal(
    budgetFits(
      { cost_limit: 0, cost_used: 0, request_limit: 0, requests_used: 0 },
      0,
    ),
    false,
  );
});
test("content contracts require media for media-only platforms and reject credential/local URLs", () => {
  const base = {
    title: "Fixture",
    text: "Hello",
    platforms: ["instagram"],
    connection_id: "11111111-1111-4111-8111-111111111111",
  };
  assert.equal(postInput.safeParse(base).success, false);
  assert.equal(
    postInput.safeParse({
      ...base,
      media_urls: ["https://media.example.invalid/photo.jpg"],
    }).success,
    true,
  );
  for (const url of [
    "http://example.com/a",
    "https://secret:password@example.com/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://172.16.0.1/a",
    "https://metadata.google.internal/a",
  ])
    assert.equal(publicUrl.safeParse(url).success, false);
  assert.equal(
    postInput.safeParse({
      ...base,
      platforms: ["twitter"],
      text: "x".repeat(281),
    }).success,
    false,
  );
});
test("search contracts fix result counts and exclude automatic expensive add-ons", () => {
  const tavily = searchPlan("tavily", "protocol fixture");
  assert.equal((tavily.body as any).search_depth, "basic");
  assert.equal((tavily.body as any).auto_parameters, false);
  assert.equal((tavily.body as any).include_raw_content, false);
  const exa = searchPlan("exa", "protocol fixture");
  assert.equal((exa.body as any).type, "lite");
  assert.equal((exa.body as any).numResults, 5);
  assert.equal(
    integrationHeaders(
      "brave",
      "fixture-secret",
      searchPlan("brave", "protocol fixture").url,
    )["X-Subscription-Token"],
    "fixture-secret",
  );
  assert.throws(() => searchPlan("unapproved", "fixture"));
  const results = sourceResults("tavily", {
    results: [
      { url: "javascript:alert(1)" },
      {
        url: "https://source.example.invalid/a",
        title: "A",
        content: "x".repeat(9000),
      },
    ],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].excerpt.length, 3500);
});
test("agent research discovery is a compact index, with excerpts loaded one query at a time", () => {
  const data = {
    job: {
      id: "job",
      title: "Fixture",
      revision: 3,
      report: "x".repeat(60000),
    },
    queries: Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      query: "Fixture",
      status: "done",
      results: [
        { url: "https://source.example.invalid/a", excerpt: "x".repeat(3500) },
      ],
    })),
  };
  const index = compactResearch(data);
  assert.ok(JSON.stringify(index).length < 5000);
  assert.equal(index.report_characters, 60000);
  assert.ok(!JSON.stringify(index).includes("xxxx"));
  const detail = compactResearch(data, "1");
  assert.equal((detail as any).sources[0].excerpt.length, 1200);
  assert.throws(() => compactResearch(data, "foreign"));
  assert.equal(modeAllowsTool("draft", "research_query"), false);
  assert.equal(modeAllowsTool("draft", "save_content_draft"), true);
  assert.equal(modeAllowsTool("draft", "save_research_report"), true);
  assert.equal(
    resolveWorkspacePath("/projects/fixture/research")?.view,
    "research",
  );
  assert.equal(
    resolveWorkspacePath("/projects/fixture/studio")?.view,
    "studio",
  );
});
import { apiErrorMessage } from "../src/core/api-error-language.ts";
test("Studio budget errors retain actionable application text without exposing arbitrary errors", () => {
  const price = "A current confirmed per-request price ceiling is required";
  assert.equal(apiErrorMessage("en", price, 409), price);
  assert.match(apiErrorMessage("de", price, 409), /Preisobergrenze/);
  assert.match(
    apiErrorMessage(
      "en",
      "Fixed project external budget or request limit reached; no provider call started",
      409,
    ),
    /no provider call/,
  );
  assert.doesNotMatch(
    apiErrorMessage("en", "Upstream returned secret-token", 409),
    /secret-token/,
  );
});
