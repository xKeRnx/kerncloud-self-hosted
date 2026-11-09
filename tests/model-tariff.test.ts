import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProviderPrices,
  calculateModelTariff,
  type ModelTariffConfig,
} from "../src/core/model-tariff.ts";
import { creditCost } from "../src/core/pricing.ts";

const profile: ModelTariffConfig = {
  mode: "catalog",
  currency: "USD",
  input_per_million: 1,
  output_per_million: 2,
  request: 0.0005,
  eur_per_currency_unit: 0.9,
  eur_per_1000_credits: 0.1,
  markup_percent: 100,
  cost_buffer_percent: 10,
  acknowledge_extras: false,
};
test("Documented pricing units distinguish unknown from free and use conservative conditional rates", () => {
  assert.equal(
    parseProviderPrices({ prompt: "0", completion: "0", request: "0" }),
    null,
    "Unknown units must not be guessed",
  );
  const free = parseProviderPrices(
    { prompt: "0", completion: "0", request: "0" },
    true,
  )!;
  assert.equal(free.input_per_million, 0);
  assert.equal(free.request, 0);
  const unknown = parseProviderPrices(
    { prompt: "-1", completion: "NaN", request: "", image: "0.1" },
    true,
  )!;
  assert.equal(unknown.input_per_million, null);
  assert.equal(unknown.output_per_million, null);
  assert.equal(unknown.request, null);
  assert.deepEqual(unknown.extras, ["image"]);
  const p = parseProviderPrices({
    currency: "EUR",
    unit: "per_token",
    prompt: "1e-6",
    completion: "0.000002",
    request: "0",
    overrides: [
      { min_prompt_tokens: 20000, prompt: "0.000005", completion: "0.000004" },
    ],
  })!;
  assert.equal(p.currency, "EUR");
  assert.equal(p.input_per_million, 5);
  assert.equal(p.output_per_million, 4);
  assert.ok(p.extras.includes("overrides"));
  assert.equal(
    parseProviderPrices({
      currency: "EUR",
      unit: "per_token",
      prompt: "1e-6",
      completion: "0",
      request: "0",
      overrides: [{ prompt: "-1" }],
    })?.input_per_million,
    null,
  );
});
test("Tariff formula accounts for FX, cost buffer and markup with upward rounding compatible with actual credit billing", () => {
  const rates = calculateModelTariff(profile);
  assert.ok(rates.input_rate >= 19.8 && rates.input_rate <= 19.8001);
  assert.ok(rates.output_rate >= 39.6 && rates.output_rate <= 39.6001);
  assert.equal(rates.base_credits, 10);
  assert.equal(
    calculateModelTariff({ ...profile, eur_per_1000_credits: 0.01 })
      .base_credits,
    99,
    "Exact decimal results must not gain a credit from binary floating point",
  );
  assert.equal(
    calculateModelTariff({ ...profile, platform_base_credits: 5 }).base_credits,
    15,
  );
  assert.equal(creditCost(1000, 1000, rates), 70);
  assert.equal(
    calculateModelTariff({
      ...profile,
      currency: "EUR",
      eur_per_currency_unit: 0.1,
      input_per_million: 1,
      output_per_million: 0,
      request: 0,
      markup_percent: 0,
      cost_buffer_percent: 0,
    }).input_rate,
    10,
  );
  const tiny = calculateModelTariff({
    ...profile,
    input_per_million: 1e-12,
    output_per_million: 0,
    request: 0,
  });
  assert.equal(
    tiny.input_rate,
    0.0001,
    "A tiny positive cost must not round down to free",
  );
  assert.deepEqual(
    calculateModelTariff({
      ...profile,
      input_per_million: 0,
      output_per_million: 0,
      request: 0,
    }),
    { input_rate: 0, output_rate: 0, base_credits: 0 },
  );
});
test("Tariff calculation rejects incomplete, negative, unbounded or invalid assumptions", () => {
  for (const change of [
    { input_per_million: null },
    { request: null },
    { eur_per_1000_credits: 0 },
    { eur_per_currency_unit: 0 },
    { markup_percent: -1 },
    { cost_buffer_percent: Infinity },
    { input_per_million: 1e9 },
  ])
    assert.throws(() => calculateModelTariff({ ...profile, ...change }));
});
