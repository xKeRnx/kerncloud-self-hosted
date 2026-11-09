"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function AccountBenefits() {
  const { t, localeTag, number } = useLanguage();
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(localeTag) : "—";
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api("account/benefits")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel settings-panel">
      <h2>
        {t(
          "Zugang & kostenlose Freischaltungen",
          "Access & complimentary benefits",
        )}
      </h2>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {t("Plan", "Plan")}: <strong>{data.account.plan_id}</strong> ·{" "}
            {data.account.subscription_status}
          </p>
          <p>
            {t("KeRnCloud-Zugang bis", "KeRnCloud access until")}:{" "}
            {data.account.access_expires_at
              ? date(data.account.access_expires_at)
              : t("Ohne manuelle Befristung", "No manual expiry")}
          </p>
          {data.account.subscription_period_end && (
            <p>
              {t(
                "Aktueller Abo-Zeitraum bis",
                "Current subscription period until",
              )}
              : {date(data.account.subscription_period_end)}
            </p>
          )}
          {data.account.subscription_cancel_at && (
            <p>
              {t("Abo endet am", "Subscription ends on")}:{" "}
              {date(data.account.subscription_cancel_at)}
            </p>
          )}
          {data.grants.map((g: any) => (
            <article className="customer-entry" key={g.id}>
              <strong>
                {t("Kostenlose Buchung", "Complimentary entry")} · 0,00 €
              </strong>
              <p>
                {g.customer_message ||
                  t("Geschenk / Kulanz", "Gift / goodwill")}
              </p>
              <small>
                {number(g.credits)} Credits · {number(g.runtime_seconds / 60)}{" "}
                {t("Minuten", "minutes")} · {date(g.created_at)}
              </small>
              {g.receipt && (
                <a
                  className="text-button"
                  href={`/api/account/benefits/${g.id}/receipt`}
                >
                  {t("Geschenkbeleg herunterladen", "Download gift receipt")}
                </a>
              )}
            </article>
          ))}
          <p className="form-note">
            {t(
              "Kostenlose Freischaltungen lösen keine Zahlung aus. Geschenkbelege sind getrennt von Rechnungen und enthalten keine ausgewiesene Umsatzsteuer.",
              "Complimentary benefits do not trigger payments. Gift receipts are separate from invoices and do not state VAT.",
            )}
          </p>
        </>
      )}
    </section>
  );
}
