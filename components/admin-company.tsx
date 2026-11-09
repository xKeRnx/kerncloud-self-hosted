"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { ActionForm, common } from "./admin-customers";
import { useLanguage } from "./language";
import {
  emptyCompany,
  companyFieldLabels,
  type Company,
} from "@/src/core/company";
export function AdminCompany() {
  const { t } = useLanguage();
  const [company, setCompany] = useState<Company | null>(null),
    [missing, setMissing] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invoiceSync, setInvoiceSync] = useState<any[]>([]);
  const load = () =>
    api<any>("admin/company").then((r) => {
      setCompany(r.company);
      setMissing(r.missing);
      setInvoiceSync(r.invoiceSync ?? []);
    });
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!invoiceSync.some((r) => ["queued", "running"].includes(r.status)))
      return;
    const timer = setInterval(
      () =>
        void api<any>("admin/company")
          .then((r) => setInvoiceSync(r.invoiceSync ?? []))
          .catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, [invoiceSync]);
  if (!company)
    return (
      <p>
        {error ||
          t("Firmendaten werden geladen …", "Loading company details …")}
      </p>
    );
  const field = (key: keyof Company, large = false) => (
    <label key={key} className="field">
      <span>
        {t(...(companyFieldLabels[key] ?? [String(key), String(key)]))}
      </span>
      {large ? (
        <textarea
          rows={4}
          maxLength={10000}
          value={String(company[key])}
          onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
        />
      ) : (
        <input
          type={
            ["email", "privacyEmail"].includes(key)
              ? "email"
              : ["website", "authorityUrl"].includes(key)
                ? "url"
                : "text"
          }
          value={String(company[key])}
          maxLength={2000}
          onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <div className="customer-management">
      <section className="panel settings-panel">
        <h2>{t("Firma & zentrale Stammdaten", "Company & shared details")}</h2>
        <p>
          {t(
            "Diese Daten füllen die Platzhalter der Rechtstexte. Änderungen werden versioniert; bestehende Rechnungen und Geschenkbelege behalten ihren ursprünglichen Stand.",
            "These details populate legal-page placeholders. Changes are versioned; existing invoices and gift receipts keep their original details.",
          )}
        </p>
        {missing.length > 0 && (
          <div className="form-note">
            {t("Noch fehlend: ", "Still missing: ")}
            {missing.join(" · ")}
          </div>
        )}
      </section>
      {error && <p className="error-box">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      <ActionForm
        title={t("Firmenprofil bearbeiten", "Edit company profile")}
        label={t(
          "Firmendaten zentral speichern",
          "Save shared company details",
        )}
        submit={async (f) => {
          await api("admin/company", { ...common(f), company });
          await load();
          setNotice(
            t(
              "Firmendaten gespeichert. Verknüpfte Texte wurden aktualisiert; unvollständige Veröffentlichungen wurden zurück auf Entwurf gesetzt.",
              "Company details saved. Linked pages were updated; incomplete publications were returned to draft.",
            ),
          );
          window.dispatchEvent(new Event("kc:site-updated"));
        }}
      >
        <h3>{t("Identität & Kontakt", "Identity & contact")}</h3>
        <div className="form-grid">
          {(
            [
              "legalName",
              "tradingName",
              "legalForm",
              "representative",
              "street",
              "postalCode",
              "city",
              "email",
              "phone",
              "website",
              "register",
              "registerNumber",
            ] as const
          ).map((k) => field(k))}
        </div>
        <h3>{t("Steuern & Kundengruppe", "Tax & customer group")}</h3>
        <div className="form-grid">
          {field("taxNumber")}
          {field("vatId")}
          {field("economicId")}
          <label className="field">
            <span>{t("Umsatzsteuerregelung", "VAT treatment")}</span>
            <select
              value={company.taxTreatment}
              onChange={(e) =>
                setCompany({ ...company, taxTreatment: e.target.value })
              }
            >
              <option value="small_business">
                {t(
                  "Kleinunternehmer gemäß § 19 UStG",
                  "Small business exemption under section 19 UStG",
                )}
              </option>
              <option value="regular">
                {t("Regelbesteuerung", "Regular VAT")}
              </option>
            </select>
            <small>
              {t(
                "Gilt für künftig vorbereitete E-Rechnungen. Regelbesteuerung verwendet 19 % bei unterstützten Inlandsleistungen. Bestehende Rechnungen behalten ihren Steuerstand. Stripe-Preise und Stripe Tax separat abstimmen.",
                "Applies to newly prepared electronic invoices. Standard taxation uses 19% for supported domestic services. Existing invoices retain their tax treatment. Configure Stripe prices and Stripe Tax separately.",
              )}
            </small>
          </label>
          <label className="field">
            <span>{t("Kundengruppe", "Customer group")}</span>
            <select
              value={company.audience}
              onChange={(e) =>
                setCompany({ ...company, audience: e.target.value })
              }
            >
              <option value="both">
                {t("Unternehmen und Privatkunden", "Businesses and consumers")}
              </option>
              <option value="business">
                {t("Nur Unternehmen", "Businesses only")}
              </option>
              <option value="consumer">
                {t("Nur Privatkunden", "Consumers only")}
              </option>
            </select>
          </label>
          <label className="field">
            <span>
              {t("Verbraucherstreitbeilegung", "Consumer dispute resolution")}
            </span>
            <select
              value={company.disputeMode}
              onChange={(e) =>
                setCompany({ ...company, disputeMode: e.target.value })
              }
            >
              <option value="unset">
                {t("Bitte rechtlich klären", "Please determine")}
              </option>
              <option value="none">
                {t(
                  "Weder verpflichtet noch teilnahmebereit",
                  "Neither obliged nor willing to participate",
                )}
              </option>
              <option value="voluntary">
                {t("Freiwillige Teilnahme", "Voluntary participation")}
              </option>
              <option value="required">
                {t("Zur Teilnahme verpflichtet", "Obliged to participate")}
              </option>
            </select>
          </label>
        </div>
        {field("disputeBody", true)}
        <h3>
          {t(
            "Datenschutz & tatsächlicher Betrieb",
            "Privacy & actual operations",
          )}
        </h3>
        <div className="form-grid">
          {field("privacyEmail")}
          {field("dpo")}
          {field("authority")}
          {field("authorityUrl")}
        </div>
        {(["hosting", "processors", "transfers", "retention"] as const).map(
          (k) => field(k, true),
        )}
        <h3>
          {t(
            "Vertragsablauf & Tarifbedingungen",
            "Contract process & plan conditions",
          )}
        </h3>
        {field("serviceTerms", true)}
        <label className="check-row">
          <input
            type="checkbox"
            checked={company.checkoutReviewed}
            onChange={(e) =>
              setCompany({ ...company, checkoutReviewed: e.target.checked })
            }
          />
          {t(
            "Bestellablauf, Preisangaben, Verbraucherinformationen, Vertragsbestätigung und Abwicklung wurden für den tatsächlichen Betrieb geprüft.",
            "The actual ordering process, prices, consumer information, contract confirmation and processing have been reviewed.",
          )}
        </label>
        <p className="form-note">
          {t(
            "Firmendaten allein machen einen Dienst nicht rechtskonform. Auftragsverarbeitung, tatsächliche Dienstleister, Einwilligungen, Kündigungen und Erstattungen müssen dazu passen. Steuer- und Stripe-Einstellungen bei einem späteren Wechsel gesondert prüfen.",
            "Company details alone do not make a service legally compliant. Processing agreements, actual providers, consent, cancellation and refunds must match. Review tax and Stripe settings separately if your status changes.",
          )}
        </p>
      </ActionForm>
      <section className="panel settings-panel">
        <h3>{t("Verwendung für Rechnungen", "Use for invoices")}</h3>
        {invoiceSync.length > 0 && (
          <p>
            {t("Rechnungsfußzeilen bei Stripe: ", "Stripe invoice footers: ")}
            {invoiceSync.map((r) => `${r.status}: ${r.count}`).join(" · ")}
          </p>
        )}
        <p>
          {t(
            "Bei eingerichtetem Stripe aktualisieren verbundene Worker die Rechnungsfußzeilen für zukünftige Rechnungen. Neue Buchungen übernehmen das Firmenprofil ebenfalls. Die rechtlichen Ausstellerdaten im Stripe-Konto müssen zusätzlich übereinstimmen. Bestehende Rechnungen werden nicht umgeschrieben. Nach einem Synchronisationsfehler Konfiguration prüfen und das Firmenprofil erneut speichern.",
            "With Stripe configured, connected workers update customer footers for future invoices. New bookings also use the company profile. The legal issuer details in Stripe must match separately. Existing invoices are not rewritten. After a sync failure, check configuration and save the company profile again.",
          )}
        </p>
        <div className="button-row">
          <a
            className="secondary"
            href="/api/admin/company/invoice-preview"
            download
          >
            {t("Rechnungsvorlage herunterladen", "Download invoice layout")}
          </a>
          <button
            className="secondary"
            onClick={() =>
              void api("admin/company/invoice-profile")
                .then((data) => {
                  const u = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const a = document.createElement("a");
                  a.href = u;
                  a.download = "kerncloud-rechnungsprofil.json";
                  a.click();
                  URL.revokeObjectURL(u);
                })
                .catch((e) => setError(e.message))
            }
          >
            {t("Rechnungsprofil exportieren", "Export invoice profile")}
          </button>
          <a href="/admin/legal" className="secondary">
            {t("Rechtstextvorlagen öffnen", "Open legal templates")}
          </a>
        </div>
      </section>
    </div>
  );
}
export function AdminContracts() {
  const { t, localeTag } = useLanguage();
  const [data, setData] = useState<any>(null),
    [status, setStatus] = useState("open"),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  const load = () =>
    api<any>(`admin/contracts?status=${status}&page=${page}`).then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [status, page]);
  return (
    <div className="customer-management">
      <section className="panel settings-panel">
        <h2>
          {t("Kündigungen & Widerrufe", "Cancellation & withdrawal statements")}
        </h2>
        <p>
          {t(
            "Eingehende Erklärungen mit gesetzlichem Eingangszeitpunkt und Bestätigungsstatus. Vertragszuordnung, Stripe-Kündigung und gegebenenfalls Erstattung anschließend bearbeiten. „Bearbeitet“ führt keine Zahlung oder Stripe-Änderung aus.",
            "Incoming statements with receipt time and confirmation status. Process contract identification, Stripe cancellation and any refund separately. Marking a statement processed does not change Stripe or execute a payment.",
          )}
        </p>
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="open">{t("Offen", "Open")}</option>
            <option value="all">{t("Alle", "All")}</option>
          </select>
        </label>
      </section>
      {error && <p className="error-box">{error}</p>}
      {data?.rows.map((r: any) => (
        <section className="panel settings-panel" key={r.id}>
          <h3>
            {r.kind === "cancel"
              ? t("Kündigung", "Cancellation")
              : t("Widerruf", "Withdrawal")}{" "}
            · {r.name}
          </h3>
          <p>
            {r.email} · {new Date(r.created_at).toLocaleString(localeTag)}
          </p>
          <p>{r.contract}</p>
          {r.kind === "cancel" && (
            <p>
              {r.termination_type} · {r.requested_end}
            </p>
          )}
          <p>{r.reason}</p>
          <p>
            {t("Eingangsnummer", "Reference")}: {r.id} ·{" "}
            {t("Mailstatus", "Email status")}: {r.confirmation_status ?? "–"}
          </p>
          {r.processed_at ? (
            <p>
              {r.outcome} · {new Date(r.processed_at).toLocaleString(localeTag)}
            </p>
          ) : (
            <ActionForm
              title={t("Abwicklung dokumentieren", "Record processing")}
              label={t("Als bearbeitet markieren", "Mark processed")}
              submit={async (f) => {
                await api("admin/contracts", { id: r.id, ...common(f) });
                await load();
              }}
            >
              <p>
                {t(
                  "In der Notiz das geprüfte Vertragsende und tatsächlich ausgeführte Schritte dokumentieren.",
                  "Record the verified contract end and actions actually completed in the note.",
                )}
              </p>
            </ActionForm>
          )}
        </section>
      ))}
      {data && (
        <section className="panel settings-panel button-row">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ←
          </button>
          <span>
            {page} / {data.pages} · {data.total}
          </span>
          <button
            disabled={page >= data.pages}
            onClick={() => setPage(page + 1)}
          >
            →
          </button>
        </section>
      )}
    </div>
  );
}
