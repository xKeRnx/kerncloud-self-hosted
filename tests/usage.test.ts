import test from "node:test";
import assert from "node:assert/strict";
import { cacheTelemetry } from "../src/core/usage-telemetry.ts";
import { usageFilters } from "../src/server/usage.ts";
test("Usage filters use bounded half-open periods and reject invalid dates, scopes and pages", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const f = usageFilters(new URLSearchParams("range=24h"), now);
  assert.equal(f.from, "2026-10-19T12:00:00.000Z");
  assert.equal(f.bucket, "hour");
  assert.equal(f.workspace, "all");
  assert.equal(usageFilters(new URLSearchParams(), now).range, "30d");
  for (const q of [
    "range=bad",
    "range=custom&from=2026-10-20T12:00:00Z&to=2026-10-19T12:00:00Z",
    "range=custom&from=2020-01-01T00:00:00Z&to=2026-10-20T12:00:00Z",
    "page=-1",
    "page=1.1",
    "source=bad",
  ]) {
    assert.throws(() => usageFilters(new URLSearchParams(q), now));
  }
});
test("Cache telemetry never invents zero or accepts impossible cache token counts", () => {
  assert.equal(cacheTelemetry({ prompt_tokens: 100 }), null);
  assert.equal(
    cacheTelemetry({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 101 },
    }),
    null,
  );
  assert.equal(
    cacheTelemetry({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: -1 },
    }),
    null,
  );
  assert.deepEqual(
    cacheTelemetry({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
    }),
    { input: 100, cached: 0 },
  );
  assert.deepEqual(
    cacheTelemetry({
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 80 },
    }),
    { input: 100, cached: 80 },
  );
});
