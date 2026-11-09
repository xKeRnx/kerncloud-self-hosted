"use client";
import { useLanguage } from "./language";
import { useState } from "react";
import type { Plan, ModelOffering } from "@/src/core/types";
export function PlanCalculator({
  plans,
  models,
}: {
  plans: Plan[];
  models: ModelOffering[];
}) {
  const { ui, localeTag, t } = useLanguage();

  const [input, setInput] = useState(3),
    [output, setOutput] = useState(15),
    [currency, setCurrency] = useState(0.95),
    [inputRate, setInputRate] = useState(1000),
    [outputRate, setOutputRate] = useState(1000),
    [overhead, setOverhead] = useState(5),
    [minuteCost, setMinuteCost] = useState(0.01),
    [slotCost, setSlotCost] = useState(1),
    [feePercent, setFeePercent] = useState(1.5),
    [feeFixed, setFeeFixed] = useState(0.25),
    [tax, setTax] = useState(0);
  const eur = (n: number) =>
    new Intl.NumberFormat(localeTag, {
      style: "currency",
      currency: "EUR",
    }).format(n);
  const costPerCredit = Math.max(
    input === 0
      ? 0
      : inputRate === 0
        ? Infinity
        : (input * currency) / (inputRate * 1000),
    output === 0
      ? 0
      : outputRate === 0
        ? Infinity
        : (output * currency) / (outputRate * 1000),
  );
  const fields = [
    [ui("Einkauf Input / 1 Mio. Tokens (USD)"), input, setInput],
    [ui("Einkauf Output / 1 Mio. Tokens (USD)"), output, setOutput],
    [ui("1 USD in EUR (Annahme)"), currency, setCurrency],
    [ui("Input-Credits / 1.000 Tokens"), inputRate, setInputRate],
    [ui("Output-Credits / 1.000 Tokens"), outputRate, setOutputRate],
    [ui("Betrieb / Support je Kunde (EUR)"), overhead, setOverhead],
    [
      t(
        "Kosten je enthaltener Hosting-Minute (EUR)",
        "Cost per included hosted minute (EUR)",
      ),
      minuteCost,
      setMinuteCost,
    ],
    [
      t(
        "Speicher / Reservierung je Hosting-Platz (EUR pro Monat)",
        "Storage / reservation per hosted slot (EUR per month)",
      ),
      slotCost,
      setSlotCost,
    ],
    [ui("Zahlungsgebühr (%)"), feePercent, setFeePercent],
    [ui("Feste Zahlungsgebühr (EUR)"), feeFixed, setFeeFixed],
    [ui("Im Preis enthaltene Umsatzsteuer (%)"), tax, setTax],
  ] as const;
  return (
    <section className="panel settings-panel">
      <h2>{ui("Preis- und Credit-Kalkulation")}</h2>
      <p>
        {ui(
          "Prüfe deine Pläne bei vollständiger Nutzung des enthaltenen Guthabens. Alle Eingaben sind Rechenannahmen; sie ändern weder Planpreise noch Modell-Tarife.",
        )}
      </p>
      <p className="form-note">
        {ui(
          "Beispiel: Sonnet 4.6, Standardpreis 3 USD Input / 15 USD Output pro Million Tokens laut",
        )}{" "}
        <a
          href="https://platform.claude.com/docs/en/about-claude/pricing"
          target="_blank"
          rel="noreferrer"
        >
          {ui("Anbieter")}
        </a>
        {ui(
          ". Wechselkurs frei gewählt. Zahlungsgebühren nach deinem Vertrag anpassen. Bei § 19 UStG ist der enthaltene Umsatzsteueranteil hier 0 %. Zusätzliche Werkzeugkosten sind separat zu berücksichtigen.",
        )}
      </p>
      {models.length > 0 && (
        <label className="field">
          <span>{ui("Credit-Tarif aus Plattform-Modell übernehmen")}</span>
          <select
            defaultValue=""
            onChange={(e) => {
              const m = models.find((m) => m.id === e.target.value);
              if (m) {
                setInputRate(Number(m.input_rate));
                setOutputRate(Number(m.output_rate));
              }
            }}
          >
            <option value="">{ui("Manuelle Annahme")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.input_rate} / {m.output_rate}
              </option>
            ))}
          </select>
          <small>
            {ui("Einkaufspreise bitte passend zum Modell eintragen.")}
          </small>
        </label>
      )}
      <div className="form-grid">
        {fields.map(([label, value, update]) => (
          <label className="field" key={label}>
            <span>{label}</span>
            <input
              type="number"
              min={0}
              max={1000000}
              step="any"
              value={value}
              onChange={(e) => update(Math.max(0, Number(e.target.value)))}
            />
          </label>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>{ui("Preis / Monat")}</th>
              <th>Credits</th>
              <th>{ui("KI-Einkauf bis zu*")}</th>
              <th>{t("Hosting-Annahme", "Hosting assumption")}</th>
              <th>{ui("Verbleibend nach Annahmen")}</th>
            </tr>
          </thead>
          <tbody>
            {plans
              .filter((p) => p.managed && p.price_cents > 0)
              .map((p) => {
                const ai = p.credits === 0 ? 0 : p.credits * costPerCredit;
                const hosting =
                  (p.runtime_minutes ?? 0) * minuteCost +
                  (p.max_environments ?? 0) * slotCost;
                const rest =
                  p.price_cents / 100 / (1 + tax / 100) -
                  ai -
                  hosting -
                  overhead -
                  ((p.price_cents / 100) * feePercent) / 100 -
                  feeFixed;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{eur(p.price_cents / 100)}</td>
                    <td>{p.credits.toLocaleString(localeTag)}</td>
                    <td>
                      {Number.isFinite(ai)
                        ? eur(ai)
                        : ui("Unbegrenzt: Tarif 0")}
                    </td>
                    <td>{eur(hosting)}</td>
                    <td className={rest < 0 ? "inline-error" : ""}>
                      {Number.isFinite(rest) ? eur(rest) : ui("Nicht gedeckt")}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        {ui(
          "* Konservative Obergrenze unter diesen Tokenpreisen: Das gesamte Guthaben wird für die teurere Tokenart verbraucht. Grundgebühren und Rundung können den Tokenverbrauch verringern. Caching, lange Kontexte, externe Werkzeuge, Steuern auf bezogene Leistungen, Mehrverbrauch und Sonderpreise sind nicht eingerechnet. „Verbleibend“ ist kein Unternehmensgewinn.",
        )}
      </p>
    </section>
  );
}
