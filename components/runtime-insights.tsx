"use client";
import { useState, useEffect } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function RuntimeInsights() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("runtime/insights")
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="panel settings-panel">
      <h2>
        {t(
          "Kontext & Kosten · letzte 30 Tage",
          "Context & costs · last 30 days",
        )}
      </h2>
      <p>
        {t(
          "Vergleich beobachteter Aufrufe, kein kontrollierter Modellvergleich. Unterschiedliche Aufgaben und Modelle beeinflussen die Werte.",
          "Observed calls, not a controlled model comparison. Different tasks and models affect these values.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {data?.providers?.length > 0 && (
        <div className="notice">
          <strong>{t("Anbieterpausen", "Provider cooldowns")}</strong>
          <ul>
            {data.providers.map((p: any) => (
              <li key={p.id + p.reason}>
                {p.name}: {p.reason} · {t("bis", "until")}{" "}
                {new Date(p.cooldown_until).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Strategie", "Strategy")}</th>
                <th>{t("Aufrufe", "Calls")}</th>
                <th>Tokens</th>
                <th>Cache</th>
                <th>
                  {t("Gemeldete Anbieterkosten", "Reported provider cost")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.strategies.map((s: any) => (
                <tr key={s.strategy}>
                  <td>{s.strategy}</td>
                  <td>
                    {s.calls} ({s.measured_calls} {t("mit Usage", "with usage")}
                    )
                  </td>
                  <td>{s.tokens.toLocaleString()}</td>
                  <td>
                    {s.cache_reports
                      ? `${s.cached_tokens.toLocaleString()} / ${s.cache_input_tokens.toLocaleString()}`
                      : t("Nicht gemeldet", "Not reported")}
                  </td>
                  <td>
                    {s.cost_reports
                      ? `${s.provider_cost_usd.toFixed(6)} USD · ${s.cost_reports}/${s.calls}`
                      : t("Unbekannt", "Unknown")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.strategies.length && (
            <p>
              {t(
                "Noch keine Aufrufe in diesem Zeitraum.",
                "No calls in this period yet.",
              )}
            </p>
          )}
        </div>
      )}
      <small>
        {t(
          "Teilbeträge enthalten nur vom Anbieter gemeldete Kosten; fehlende Angaben sind keine kostenlosen Aufrufe.",
          "Subtotals include only provider-reported costs; missing data does not mean free calls.",
        )}
      </small>
    </section>
  );
}
