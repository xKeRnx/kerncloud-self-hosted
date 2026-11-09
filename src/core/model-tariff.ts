import type { CreditPricing } from "./pricing.ts";

export interface ProviderPrices {
  currency: "USD" | "EUR";
  input_per_million: number | null;
  output_per_million: number | null;
  request: number | null;
  extras: string[];
  checked_at: string;
}
export interface ModelTariffConfig {
  mode: "catalog" | "manual";
  currency: "USD" | "EUR";
  input_per_million: number | null;
  output_per_million: number | null;
  request: number | null;
  eur_per_currency_unit: number;
  eur_per_1000_credits: number;
  markup_percent: number;
  cost_buffer_percent: number;
  acknowledge_extras: boolean;
  price_snapshot?: ProviderPrices;
  platform_base_credits?: number;
  calculated_at?: string;
}
const price = (value: unknown): number | null => {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value))
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : null;
};

// Only interpret units/currency that the endpoint actually documents or reports.
export function parseProviderPrices(
  value: unknown,
  router = false,
): ProviderPrices | null {
  const p = value as Record<string, unknown> | null;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const currency = router ? "USD" : p.currency;
  if (
    (currency !== "USD" && currency !== "EUR") ||
    (!router && p.unit !== "per_token")
  )
    return null;
  if (Array.isArray(p.overrides) && p.overrides.length > 100) return null;
  const variants = [
    p,
    ...(Array.isArray(p.overrides)
      ? p.overrides
          .filter((v) => v && typeof v === "object" && !Array.isArray(v))
          .slice(0, 100)
      : []),
  ];
  const maximum = (key: string, multiplier = 1) => {
    const base = price(p[key]);
    if (base === null) return null;
    let result = base;
    for (const variant of variants.slice(1)) {
      if (!Object.hasOwn(variant, key)) continue;
      const n = price(variant[key]);
      if (n === null) return null;
      result = Math.max(result, n);
    }
    return result * multiplier <= 1e9 ? result * multiplier : null;
  };
  const ignored = new Set([
    "prompt",
    "completion",
    "request",
    "overrides",
    "currency",
    "unit",
  ]);
  const extras = new Set<string>();
  if (Array.isArray(p.overrides) && p.overrides.length) extras.add("overrides");
  for (const variant of variants)
    for (const [key, value] of Object.entries(variant)) {
      if (ignored.has(key) || key.startsWith("min_") || key.startsWith("utc_"))
        continue;
      if (price(value) !== 0 && /^[a-z_]{1,40}$/.test(key)) extras.add(key);
    }
  return {
    currency,
    input_per_million: maximum("prompt", 1e6),
    output_per_million: maximum("completion", 1e6),
    request: maximum("request"),
    extras: [...extras].slice(0, 20),
    checked_at: new Date().toISOString(),
  };
}

export function calculateModelTariff(config: ModelTariffConfig): CreditPricing {
  const costs = [
    config.input_per_million,
    config.output_per_million,
    config.request,
  ];
  if (
    costs.some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9,
    )
  )
    throw new Error(
      "Einkaufspreise fehlen oder sind ungültig. Fehlende Preise sind nicht kostenlos.",
    );
  const fx = config.currency === "EUR" ? 1 : config.eur_per_currency_unit;
  if (
    !Number.isFinite(fx) ||
    fx <= 0 ||
    fx > 1000 ||
    !Number.isFinite(config.eur_per_1000_credits) ||
    config.eur_per_1000_credits < 0.000001 ||
    config.eur_per_1000_credits > 10000 ||
    !Number.isFinite(config.markup_percent) ||
    config.markup_percent < 0 ||
    config.markup_percent > 10000 ||
    !Number.isFinite(config.cost_buffer_percent) ||
    config.cost_buffer_percent < 0 ||
    config.cost_buffer_percent > 1000
  )
    throw new Error(
      "Wechselkurs, Credit-Wert, Kostenpuffer oder Aufschlag ist ungültig.",
    );
  // Decimal ratios avoid turning an exact 99-credit charge into 100 merely
  // because binary floating point produced 99.00000000000001 before ceil.
  const ratio = (value: number) => {
    const [mantissa, exponent = "0"] = value.toString().split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    const scale = fraction.length - Number(exponent);
    return {
      n: BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, -scale)),
      d: 10n ** BigInt(Math.max(0, scale)),
    };
  };
  const exchange = ratio(fx),
    credit = ratio(config.eur_per_1000_credits),
    buffer = ratio(config.cost_buffer_percent),
    markup = ratio(config.markup_percent);
  const numerator =
    exchange.n *
    credit.d *
    (100n * buffer.d + buffer.n) *
    (100n * markup.d + markup.n);
  const denominator = exchange.d * credit.n * 100n * buffer.d * 100n * markup.d;
  const rounded = (cost: number, scale: bigint) => {
    const r = ratio(cost),
      n = r.n * numerator * scale,
      d = r.d * denominator;
    return Number((n + d - 1n) / d);
  };
  const platformBase = config.platform_base_credits ?? 0;
  if (
    !Number.isSafeInteger(platformBase) ||
    platformBase < 0 ||
    platformBase > 1e6
  )
    throw new Error("Ungültiger Plattform-Grundpreis.");
  const result = {
    input_rate: rounded(config.input_per_million!, 10000n) / 10000,
    output_rate: rounded(config.output_per_million!, 10000n) / 10000,
    base_credits: rounded(config.request!, 1000n) + platformBase,
  };
  if (
    Object.values(result).some((v) => !Number.isFinite(v) || v < 0 || v > 1e6)
  )
    throw new Error(
      "Der berechnete Credit-Tarif überschreitet die erlaubte Grenze.",
    );
  return result;
}
