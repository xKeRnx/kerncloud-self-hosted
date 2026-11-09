"use client";
import { useEffect, useState } from "react";
import { useLanguage } from "./language";
import type { ModelOffering, Plan } from "@/src/core/types";
import type { ProviderModel } from "@/src/core/provider-catalog";
import {
  calculateModelTariff,
  type ModelTariffConfig,
  type ProviderPrices,
} from "@/src/core/model-tariff";

export function ModelPricingFields({
  model,
  selection,
  plans = [],
}: {
  model: ModelOffering | null;
  selection: ProviderModel | null | undefined;
  plans?: Plan[];
}) {
  const { t, localeTag } = useLanguage();
  const c = model?.pricing_config?.mode ? model.pricing_config : null;
  const [enabled, setEnabled] = useState(!!c),
    [mode, setMode] = useState(c?.mode ?? "catalog"),
    [currency, setCurrency] = useState<"USD" | "EUR">(c?.currency ?? "USD"),
    [costs, setCosts] = useState({
      input: c?.input_per_million?.toString() ?? "",
      output: c?.output_per_million?.toString() ?? "",
      request: c?.request?.toString() ?? "",
    }),
    [snapshot, setSnapshot] = useState<ProviderPrices | null>(
      c?.price_snapshot ?? null,
    ),
    [fx, setFx] = useState(c?.eur_per_currency_unit?.toString() ?? ""),
    [creditValue, setCreditValue] = useState(
      c?.eur_per_1000_credits?.toString() ?? "",
    ),
    [markup, setMarkup] = useState(String(c?.markup_percent ?? 100)),
    [buffer, setBuffer] = useState(String(c?.cost_buffer_percent ?? 0)),
    [platformBase, setPlatformBase] = useState(
      String(c?.platform_base_credits ?? 0),
    ),
    [ack, setAck] = useState(c?.acknowledge_extras ?? false),
    [manualRates, setManualRates] = useState({
      input: String(model?.input_rate ?? 1000),
      output: String(model?.output_rate ?? 1000),
      base: String(model?.base_credits ?? 0),
    });
  useEffect(() => {
    if (selection === undefined) return;
    const p = selection?.prices ?? null;
    setSnapshot(p);
    setMode("catalog");
    setAck(false);
    setCosts({
      input: p?.input_per_million?.toString() ?? "",
      output: p?.output_per_million?.toString() ?? "",
      request: p?.request?.toString() ?? "",
    });
    if (p) {
      setCurrency(p.currency);
      if (p.currency === "EUR") setFx("1");
    }
    if (selection) setEnabled(true);
  }, [selection]);
  const config: ModelTariffConfig = {
    mode,
    currency,
    input_per_million: costs.input === "" ? null : Number(costs.input),
    output_per_million: costs.output === "" ? null : Number(costs.output),
    request: costs.request === "" ? null : Number(costs.request),
    eur_per_currency_unit: currency === "EUR" ? 1 : Number(fx),
    eur_per_1000_credits: Number(creditValue),
    markup_percent: Number(markup),
    cost_buffer_percent: Number(buffer),
    acknowledge_extras: ack,
    platform_base_credits: Number(platformBase),
  };
  let rates: ReturnType<typeof calculateModelTariff> | null = null;
  try {
    rates = calculateModelTariff(config);
  } catch {}
  const cap = Math.min(
    ...plans
      .filter(
        (p) => p.active && p.managed && p.credits > 0 && p.price_cents > 0,
      )
      .map((p) => (p.price_cents / 100 / p.credits) * 1000),
  );
  const fmt = (n: number) =>
    n.toLocaleString(localeTag, { maximumFractionDigits: 6 });
  return (
    <>
      <section className="provider-model-picker" style={{ marginBlock: 20 }}>
        <strong>
          {t(
            "Einkaufspreise & Credit-Kalkulation",
            "Purchase prices & credit calculation",
          )}
        </strong>
        <label className="check-row">
          <input
            type="checkbox"
            name="pricing_enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t(
            "Credit-Tarif aus Einkaufspreisen berechnen",
            "Calculate credit rates from purchase prices",
          )}
        </label>
        {enabled && (
          <>
            <p>
              {t(
                "Aufschlag auf Einkaufskosten inklusive Puffer. Beispiel: 100 % Aufschlag verdoppelt die Kosten; das entspricht 50 % rechnerischer Marge vor weiteren Betriebskosten.",
                "Markup applies to purchase costs including the buffer. Example: 100% markup doubles the cost, equivalent to a 50% calculated margin before other operating expenses.",
              )}
            </p>
            <div className="form-grid">
              <label className="field">
                <span>{t("Preisquelle", "Price source")}</span>
                <select
                  name="pricing_mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as "catalog" | "manual");
                    setAck(false);
                  }}
                >
                  <option value="catalog">
                    {t("Anbieterkatalog", "Provider catalog")}
                  </option>
                  <option value="manual">
                    {t(
                      "Manuell bestätigte Einkaufspreise",
                      "Manually confirmed purchase prices",
                    )}
                  </option>
                </select>
              </label>
              <label className="field">
                <span>{t("Einkaufswährung", "Purchase currency")}</span>
                <select
                  name="pricing_currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as "USD" | "EUR")}
                  disabled={mode === "catalog"}
                >
                  <option>USD</option>
                  <option>EUR</option>
                </select>
                {mode === "catalog" && (
                  <input
                    type="hidden"
                    name="pricing_currency"
                    value={currency}
                  />
                )}
              </label>
              {(
                [
                  [
                    "input",
                    t(
                      "Einkauf / 1 Mio. Eingabe-Tokens",
                      "Purchase / 1M input tokens",
                    ),
                  ],
                  [
                    "output",
                    t(
                      "Einkauf / 1 Mio. Ausgabe-Tokens",
                      "Purchase / 1M output tokens",
                    ),
                  ],
                  ["request", t("Einkauf je Aufruf", "Purchase per request")],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  <span>
                    {label} ({currency})
                  </span>
                  <input
                    name={"pricing_" + key}
                    type="number"
                    min="0"
                    max="1000000000"
                    step="any"
                    required
                    value={costs[key]}
                    readOnly={mode === "catalog"}
                    placeholder={t("Unbekannt", "Unknown")}
                    onChange={(e) =>
                      setCosts({ ...costs, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className="field">
                <span>
                  {t(
                    "Kalkulationskurs: EUR je 1 USD",
                    "Calculation exchange rate: EUR per USD",
                  )}
                </span>
                <input
                  name="pricing_fx"
                  type="number"
                  min="0.000001"
                  max="1000"
                  step="any"
                  required
                  value={currency === "EUR" ? "1" : fx}
                  readOnly={currency === "EUR"}
                  onChange={(e) => setFx(e.target.value)}
                />
                <small>
                  {t(
                    "Selbst festlegen, kein automatisch abgerufener Devisenkurs.",
                    "Set explicitly; this is not an automatically retrieved exchange rate.",
                  )}
                </small>
              </label>
              <label className="field">
                <span>
                  {t(
                    "Kalkulierter Nettoerlös / 1.000 Credits (EUR)",
                    "Calculated net revenue / 1,000 credits (EUR)",
                  )}
                </span>
                <input
                  name="pricing_credit_value"
                  type="number"
                  min="0.000001"
                  max="10000"
                  step="any"
                  required
                  value={creditValue}
                  onChange={(e) => setCreditValue(e.target.value)}
                />
                <small>
                  {t(
                    "Aus dem günstigsten Paket nach Steuern und Anteilen für Hosting/Support ableiten. Credits erhalten dadurch keinen Auszahlungswert.",
                    "Derive from the cheapest plan after taxes and allowances for hosting/support. This does not give credits a cash redemption value.",
                  )}
                </small>
              </label>
              <label className="field">
                <span>{t("Kostenaufschlag (%)", "Cost markup (%)")}</span>
                <input
                  name="pricing_markup"
                  type="number"
                  min="0"
                  max="10000"
                  step="any"
                  required
                  value={markup}
                  onChange={(e) => setMarkup(e.target.value)}
                />
              </label>
              <label className="field">
                <span>
                  {t(
                    "Plattform-Grundpreis je Aufruf (Credits)",
                    "Platform base charge per request (credits)",
                  )}
                </span>
                <input
                  name="pricing_platform_base"
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  required
                  value={platformBase}
                  onChange={(e) => setPlatformBase(e.target.value)}
                />
                <small>
                  {t(
                    "Zusätzlich zum berechneten Anbieter-Grundpreis, auch bei kostenfreien Modellen.",
                    "Added to the calculated provider request cost, including for free models.",
                  )}
                </small>
              </label>
              <label className="field">
                <span>
                  {t(
                    "Zusätzlicher Kostenpuffer (%)",
                    "Additional cost buffer (%)",
                  )}
                </span>
                <input
                  name="pricing_buffer"
                  type="number"
                  min="0"
                  max="1000"
                  step="any"
                  required
                  value={buffer}
                  onChange={(e) => setBuffer(e.target.value)}
                />
                <small>
                  {t(
                    "Zum Beispiel für Anbietergebühren, Wechselkursrisiko oder nicht abzugsfähige Einkaufsteuer.",
                    "For example provider fees, exchange-rate risk or non-deductible purchase tax.",
                  )}
                </small>
              </label>
            </div>
            {mode === "catalog" && !snapshot && (
              <p role="status">
                {t(
                  "Zuerst ein Modell aus dem Katalog wählen. Fehlen Preise, die manuelle Preisquelle verwenden und jeden Betrag ausdrücklich eintragen.",
                  "Choose a catalog model first. If prices are missing, use the manual source and enter each amount explicitly.",
                )}
              </p>
            )}
            {snapshot && (
              <p>
                {t("Katalog-Preisstand: ", "Catalog price timestamp: ") +
                  new Date(snapshot.checked_at).toLocaleString(localeTag)}
              </p>
            )}
            {mode === "catalog" && !!snapshot?.extras.length && (
              <label className="check-row">
                <input
                  type="checkbox"
                  name="pricing_ack"
                  required
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {t(
                  "Weitere/bedingte Preise geprüft und berücksichtigt: ",
                  "Additional/conditional prices reviewed and accounted for: ",
                ) + snapshot.extras.join(", ")}
                .{" "}
                {t(
                  "Gemeldete Eingabe-/Ausgabe-Ausnahmen werden mit dem höchsten Tarif angesetzt; andere Zusatzkosten sind nicht automatisch enthalten.",
                  "Reported input/output overrides use the highest rate; other additional charges are not included automatically.",
                )}
              </label>
            )}
            {Number.isFinite(cap) && (
              <p>
                {t(
                  "Günstigster aktiver Paket-Bruttoerlös / 1.000 Credits: ",
                  "Lowest active plan gross revenue / 1,000 credits: ",
                ) +
                  fmt(cap) +
                  " EUR"}
              </p>
            )}
            {Number.isFinite(cap) && Number(creditValue) > cap && (
              <p role="alert">
                {t(
                  "Der kalkulierte Nettoerlös ist höher als der Paket-Bruttoerlös. Diese Kalkulation kann nicht gespeichert werden.",
                  "Calculated net revenue exceeds plan gross revenue. This calculation cannot be saved.",
                )}
              </p>
            )}
            {rates ? (
              <p role="status">
                {t("Berechnet: ", "Calculated: ") +
                  fmt(rates.input_rate) +
                  t(" Eingabe- und ", " input and ") +
                  fmt(rates.output_rate) +
                  t(
                    " Ausgabe-Credits / 1.000 Tokens + ",
                    " output credits / 1,000 tokens + ",
                  ) +
                  fmt(rates.base_credits) +
                  t(" Credits je Aufruf.", " credits per request.")}
              </p>
            ) : (
              <p role="status">
                {t(
                  "Für die Kalkulation bitte alle Einkaufspreise, Wechselkurs und Credit-Wert ergänzen. Unbekannt ist nicht 0.",
                  "Complete all purchase prices, exchange rate and credit value. Unknown is not zero.",
                )}
              </p>
            )}
            <p>
              {t(
                "Formel: Einkauf × Wechselkurs × (1 + Puffer) × (1 + Aufschlag) ÷ Credit-Wert. Aufrundung schützt vor Rundungsverlusten. Beim Speichern werden Katalogpreise neu geprüft. Bestehende Tarife ändern sich erst beim Speichern; Gewinn hängt auch von Paketen, Steuern und tatsächlichen Zusatzkosten ab.",
                "Formula: purchase cost × exchange rate × (1 + buffer) × (1 + markup) ÷ credit value. Rounding up avoids rounding losses. Catalog prices are rechecked when saving. Existing rates only change on save; profit also depends on plans, taxes and actual additional costs.",
              )}
            </p>
          </>
        )}
      </section>
      <div className="form-grid">
        {(
          [
            [
              "input",
              t(
                "Credits / 1.000 Eingabe-Tokens",
                "Credits / 1,000 input tokens",
              ),
              "input_rate",
            ],
            [
              "output",
              t(
                "Credits / 1.000 Ausgabe-Tokens",
                "Credits / 1,000 output tokens",
              ),
              "output_rate",
            ],
            [
              "base",
              t("Credits je Aufruf", "Credits per call"),
              "base_credits",
            ],
          ] as const
        ).map(([key, label, rate]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              name={key}
              type="number"
              min="0"
              max="1000000"
              step={key === "base" ? 1 : 0.0001}
              required
              readOnly={enabled}
              value={enabled ? (rates?.[rate] ?? "") : manualRates[key]}
              onChange={(e) =>
                setManualRates({ ...manualRates, [key]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
    </>
  );
}
