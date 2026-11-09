"use client";
import { useLanguage } from "./language";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api-client";
import type { Save } from "./materials-panel";
import { LegalEditor } from "./legal-editor";
import { legalTitles, type Locale } from "@/src/core/languages";
import type { LegalFormat } from "@/src/core/legal-content";
type Config = {
  site: {
    brand: string;
    analyticsEnabled: boolean;
    analyticsRetention: number;
  };
  legal: Record<
    string,
    {
      title: string;
      content: string;
      format?: LegalFormat;
      published: boolean;
      version?: number;
      template?: boolean;
      templateVersion?: string;
      reviewed?: boolean;
      missing?: string[];
    }
  >;
  legalTranslations?: Record<Locale, Config["legal"]>;
  billing: {
    enabled: boolean;
    configured: boolean;
    webhookConfigured: boolean;
    mode: string;
    returnUrl: string;
    automaticTax: boolean;
    country: string;
    taxTreatment: string;
    invoiceService: string;
  };
};
function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { ui, localeTag } = useLanguage();

  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function AdminBusiness({
  section,
  save,
}: {
  section: "site" | "legal" | "billing";
  save: Save;
}) {
  const { ui, localeTag, t, locale: currentLocale } = useLanguage();

  const [legalLocale, setLegalLocale] = useState<Locale>(currentLocale);
  const [templates, setTemplates] = useState<
    Record<string, Config["legal"][string]>
  >({});
  const [data, setData] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Config>("admin/site")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const submit = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await save(path, body);
      await load();
      if (path === "admin/legal") {
        const b = body as { key: string; locale: string };
        setTemplates((old) => {
          const next = { ...old };
          delete next[`${b.locale}:${b.key}`];
          return next;
        });
      }
      window.dispatchEvent(new Event("kc:site-updated"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <p>{error || ui("Einstellungen werden geladen …")}</p>;
  const storedLegal = data.legalTranslations?.[legalLocale] ?? data.legal;
  const legal = Object.fromEntries(
    Object.keys(legalTitles[legalLocale]).map((k) => [
      k,
      templates[`${legalLocale}:${k}`] ?? storedLegal[k],
    ]),
  ) as Config["legal"];
  return (
    <>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {section === "site" && (
        <section className="panel settings-panel">
          <h2>{ui("Website & Analyse")}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void submit("admin/site", {
                brand: f.get("brand"),
                analyticsEnabled: f.get("analytics") === "on",
                analyticsRetention: Number(f.get("retention")),
              });
            }}
          >
            <Field title={ui("Plattformname")}>
              <input
                name="brand"
                defaultValue={data.site.brand}
                required
                maxLength={80}
              />
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                name="analytics"
                defaultChecked={data.site.analyticsEnabled}
              />
              {ui(
                "Optionale Nutzungsanalyse anbieten (erst nach Einwilligung)",
              )}
            </label>
            <Field title={ui("Analysedaten aufbewahren (Tage)")}>
              <input
                name="retention"
                type="number"
                min="1"
                max="365"
                defaultValue={data.site.analyticsRetention}
                required
              />
            </Field>
            <div className="form-note">
              {ui(
                "Keine gespeicherten IP-Adressen oder vollständigen User-Agents. Referrer werden auf den Hostnamen gekürzt, Klicks nur für vordefinierte Bedienelemente erfasst. Aktive Nutzer zählen ausschließlich angemeldete Konten mit Analyse-Einwilligung. Rechtstexte und tatsächlichen Betrieb vor Veröffentlichung prüfen.",
              )}
            </div>
            <button className="primary" disabled={busy}>
              {ui("Website-Einstellungen speichern")}
            </button>
          </form>
        </section>
      )}
      {section === "legal" && (
        <>
          <section className="panel settings-panel">
            <h2>{ui("Rechtstexte verwalten")}</h2>
            <div
              className="tabs"
              role="group"
              aria-label={ui("Sprache der Rechtstexte")}
            >
              <button
                type="button"
                className={legalLocale === "de" ? "active" : ""}
                onClick={() => setLegalLocale("de")}
              >
                Deutsch
              </button>
              <button
                type="button"
                className={legalLocale === "en" ? "active" : ""}
                onClick={() => setLegalLocale("en")}
              >
                English
              </button>
            </div>
            <p>
              {ui(
                "Formatiere deine Texte direkt im Editor oder bearbeite den HTML-Code. Die Vorschau zeigt die öffentliche Darstellung. Änderungen werden versioniert; unveröffentlichte Texte bleiben privat.",
              )}
            </p>
            <p>
              {t(
                "Vorlagen sind anpassbare Entwürfe für Deutschland. Firmendaten werden über {{company.…}} eingesetzt. Vor Veröffentlichung tatsächliche Dienstleister, Tarifbedingungen und Verbraucherabläufe prüfen.",
                "Templates are editable drafts for Germany. {{company.…}} placeholders insert shared company details. Review actual providers, plan terms and consumer processes before publication.",
              )}
            </p>
            <a className="secondary" href="/admin/company">
              {t(
                "Zentrale Firmendaten bearbeiten",
                "Edit shared company details",
              )}
            </a>
          </section>
          {Object.entries(legalTitles[legalLocale]).map(([key, title]) => (
            <section
              key={`${key}-${legalLocale}-${legal[key]?.version}`}
              className="panel settings-panel"
            >
              <h2>{title}</h2>
              <div className="button-row">
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api<any>(
                      `admin/legal-template?key=${key}&locale=${legalLocale}`,
                    )
                      .then((result) =>
                        setTemplates((old) => ({
                          ...old,
                          [`${legalLocale}:${key}`]: {
                            ...result,
                            version: Date.now(),
                          },
                        })),
                      )
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  {t(
                    "Deutsche Rechtsvorlage als Entwurf einsetzen",
                    "Insert German-law template as draft",
                  )}
                </button>
              </div>
              {legal[key]?.missing?.length ? (
                <p className="form-note">
                  {t(
                    "Vor Veröffentlichung ergänzen: ",
                    "Complete before publication: ",
                  )}
                  {legal[key].missing?.join(" · ")}
                </p>
              ) : null}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void submit("admin/legal", {
                    key,
                    locale: legalLocale,
                    title: f.get("title"),
                    content: f.get("content"),
                    format: f.get("format"),
                    published: f.get("published") === "on",
                    template: Boolean(legal[key]?.template),
                    templateVersion: legal[key]?.templateVersion,
                    reviewed: f.get("reviewed") === "on",
                  });
                }}
              >
                <Field title={ui("Seitentitel")}>
                  <input
                    name="title"
                    defaultValue={legal[key]?.title || title}
                    maxLength={150}
                    required
                  />
                </Field>
                <LegalEditor
                  title={title}
                  content={legal[key]?.content ?? ""}
                  format={legal[key]?.format}
                  documentLocale={legalLocale}
                />
                <label className="check-row">
                  <input
                    type="checkbox"
                    name="published"
                    defaultChecked={legal[key]?.published}
                  />
                  {ui("Öffentlich veröffentlichen")}
                </label>
                {legal[key]?.template && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="reviewed"
                      defaultChecked={legal[key]?.reviewed}
                    />
                    {t(
                      "Vorlage mit meinen tatsächlichen Firmendaten, Verarbeitungen und Vertragsabläufen geprüft und vervollständigt.",
                      "I have reviewed and completed this template for my actual company details, processing and contractual processes.",
                    )}
                  </label>
                )}
                <div className="button-row">
                  <button className="primary" disabled={busy}>
                    {ui("Text speichern")}
                  </button>
                  <a
                    href={`/legal/${key}?lang=${legalLocale}`}
                    className="secondary"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ui("Öffentliche Seite ansehen")}
                  </a>
                </div>
              </form>
            </section>
          ))}
        </>
      )}
      {section === "billing" && (
        <>
          <section className="panel settings-panel">
            <h2>{ui("Stripe-Anbindung")}</h2>
            <p>
              {ui(
                "Checkout, Kundenportal, signierte Webhooks und Rechnungs-PDFs. Standardmäßig deaktiviert. Preis-IDs ordnest du unter „Pläne“ zu.",
              )}
            </p>
            <div className="form-note">
              {ui("API-Schlüssel: ")}
              {data.billing.configured ? ui("gespeichert") : ui("fehlt")}{" "}
              {ui("· Webhook-Secret:")}{" "}
              {data.billing.webhookConfigured ? ui("gespeichert") : ui("fehlt")}
              {ui(" · Zahlungen: ")}
              {data.billing.enabled ? ui("aktiviert") : ui("deaktiviert")}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void submit("admin/billing", {
                  enabled: f.get("enabled") === "on",
                  mode: f.get("mode"),
                  returnUrl: f.get("url"),
                  secret: f.get("secret") || undefined,
                  webhookSecret: f.get("webhook") || undefined,
                  automaticTax: f.get("tax") === "on",
                  country: "DE",
                  taxTreatment: f.get("tax_treatment"),
                  invoiceService: f.get("invoice_service"),
                });
              }}
            >
              <div className="form-grid">
                <Field title={ui("Unternehmensland")}>
                  <input value={ui("Deutschland")} readOnly />
                </Field>
                <Field title={ui("Umsatzsteuerregelung")}>
                  <select
                    name="tax_treatment"
                    defaultValue={data.billing.taxTreatment}
                  >
                    <option value="unset">{ui("Noch zu klären")}</option>
                    <option value="regular">{ui("Regelbesteuerung")}</option>
                    <option value="small_business">
                      {ui("Kleinunternehmerregelung")}
                    </option>
                  </select>
                </Field>
                <Field title={ui("Rechnungsdienst (optional)")}>
                  <input
                    name="invoice_service"
                    defaultValue={data.billing.invoiceService}
                    maxLength={200}
                    placeholder={ui("Vorhandenen Dienst eintragen")}
                  />
                  <small>
                    {ui(
                      "Dokumentiert die Auswahl; die technische E-Rechnungsanbindung wird separat eingerichtet.",
                    )}
                  </small>
                </Field>
                <Field title={ui("Stripe-Modus")}>
                  <select name="mode" defaultValue={data.billing.mode}>
                    <option value="test">{ui("Testmodus")}</option>
                    <option value="live">{ui("Live-Modus")}</option>
                  </select>
                </Field>
                <Field title={ui("Öffentliche Plattform-URL")}>
                  <input
                    name="url"
                    type="url"
                    defaultValue={data.billing.returnUrl}
                    required
                  />
                </Field>
                <Field title="Secret API Key">
                  <input
                    name="secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      data.billing.configured
                        ? ui("Gespeichert – leer lassen zum Beibehalten")
                        : "sk_test_…"
                    }
                  />
                </Field>
                <Field title="Webhook Signing Secret">
                  <input
                    name="webhook"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      data.billing.webhookConfigured
                        ? ui("Gespeichert – leer lassen zum Beibehalten")
                        : "whsec_…"
                    }
                  />
                </Field>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="tax"
                  defaultChecked={data.billing.automaticTax}
                />
                {ui("Stripe Tax verwenden (vorher in Stripe einrichten)")}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={data.billing.enabled}
                />
                {ui("Zahlungsabwicklung aktivieren")}
              </label>
              <p className="muted">
                {ui(
                  "Webhook-Adresse: /api/billing/webhook. Erforderliche Events: invoice.paid, invoice.finalized, invoice.payment_failed, customer.subscription.created/updated/deleted. Lokale Webhooks über die Stripe CLI weiterleiten. Firmendaten, Rechnungsnummern, Portal, AGB-Link und Steuerregeln in Stripe konfigurieren.",
                )}
              </p>
              <button className="primary" disabled={busy}>
                {ui("Stripe-Einstellungen speichern")}
              </button>
            </form>
          </section>
          <section className="panel settings-panel">
            <h2>{ui("E-Rechnungen / ZUGFeRD")}</h2>
            <span className="subtle-chip">
              {t(
                "Lokale Erzeugung & Formatprüfung",
                "Local generation & validation",
              )}
            </span>
            <p>
              {ui(
                "Ein Stripe-PDF ist nicht automatisch eine ZUGFeRD-Rechnung. Dafür werden strukturierte Rechnungsdaten, eine passende PDF/A-3-Datei mit eingebettetem XML und eine Formatprüfung benötigt.",
              )}
            </p>
            <p>
              {t(
                "Unter E-Rechnungen verwaltest du das Rechnungsarchiv, erstellst manuelle Rechnungen und siehst fehlgeschlagene Prüfungen oder Stripe-Importe.",
                "Manage the invoice archive, issue manual invoices and review failed checks or Stripe imports under E-invoices.",
              )}
            </p>
            <a className="secondary" href="/admin/einvoices">
              {t("E-Rechnungen öffnen", "Open electronic invoices")}
            </a>
          </section>
        </>
      )}
    </>
  );
}
type Report = {
  series: { date: string; views: number; users: number; clicks: number }[];
  pages: { page: string; count: number }[];
  referrers: { referrer: string; count: number }[];
  clicks: { page: string; target: string; count: number }[];
  totals: {
    views: number;
    users: number;
    clicks: number;
    suspected_bots: number;
  };
  registrations: { date: string; registrations: number }[];
  note: string;
};
type AnalyticsSummary = {
  periods: {
    key: string;
    days: number;
    from: string;
    to: string;
    views: number;
    users: number;
    clicks: number;
    registrations: number;
  }[];
  retentionDays: number;
  enabled: boolean;
  asOf: string;
  note: string;
};
function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
}
export function AdminAnalytics() {
  const { ui, localeTag } = useLanguage();

  const [report, setReport] = useState<Report | null>(null),
    [summary, setSummary] = useState<AnalyticsSummary | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preset, setPreset] = useState("24h"),
    [bucket, setBucket] = useState("hour"),
    [bots, setBots] = useState("exclude"),
    [from, setFrom] = useState(() =>
      localDateTime(new Date(Date.now() - 86400000)),
    ),
    [to, setTo] = useState(() => localDateTime(new Date()));
  const serial = useRef(0);
  const load = useCallback(
    async (start: string, end: string, group: string, botFilter: string) => {
      const ticket = ++serial.current;
      setBusy(true);
      setError("");
      try {
        const next = await api<Report>("admin/analytics", {
          from: new Date(start).toISOString(),
          to: new Date(end).toISOString(),
          bucket: group,
          bots: botFilter,
        });
        if (ticket === serial.current) setReport(next);
      } catch (e) {
        if (ticket === serial.current) setError((e as Error).message);
      } finally {
        if (ticket === serial.current) setBusy(false);
      }
    },
    [],
  );
  const refreshSummary = useCallback(
    () =>
      api<AnalyticsSummary>("admin/analytics-summary")
        .then(setSummary)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    const end = new Date();
    void load(
      localDateTime(new Date(end.getTime() - 86400000)),
      localDateTime(end),
      "hour",
      "exclude",
    );
    void refreshSummary();
    return () => {
      serial.current++;
    };
  }, [load, refreshSummary]);
  function choose(days: number, key: string) {
    const end = new Date(),
      start = new Date(end.getTime() - days * 86400000);
    const a = localDateTime(start),
      b = localDateTime(end),
      group = days === 1 ? "hour" : days === 30 ? "day" : "month";
    setFrom(a);
    setTo(b);
    setPreset(key);
    setBucket(group);
    void load(a, b, group, bots);
  }
  return (
    <>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>{ui("Analyse auf einen Blick")}</h2>
            <p>
              {ui(
                "Letzte 24 Stunden, 30 Tage und 365 Tage. Die Detailansicht startet automatisch mit 24 Stunden.",
              )}
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              void refreshSummary();
              void load(from, to, bucket, bots);
            }}
          >
            {ui("Aktualisieren")}
          </button>
        </div>
        <div className="analytics-periods">
          {[
            { key: "24h", days: 1, title: ui("Letzte 24 Stunden") },
            { key: "30d", days: 30, title: ui("Letzte 30 Tage") },
            { key: "365d", days: 365, title: ui("Letzte 365 Tage") },
          ].map((period) => {
            const p = summary?.periods.find((p) => p.key === period.key);
            return (
              <button
                type="button"
                className={
                  preset === period.key
                    ? "analytics-period active"
                    : "analytics-period"
                }
                key={period.key}
                aria-pressed={preset === period.key}
                onClick={() => choose(period.days, period.key)}
              >
                <h3>{period.title}</h3>
                <strong>{p ? p.views.toLocaleString(localeTag) : "…"}</strong>
                <span>{ui("Seitenaufrufe")}</span>
                <dl>
                  <div>
                    <dt>{ui("Aktive Konten*")}</dt>
                    <dd>{p?.users ?? "…"}</dd>
                  </div>
                  <div>
                    <dt>{ui("Klicks*")}</dt>
                    <dd>{p?.clicks ?? "…"}</dd>
                  </div>
                  <div>
                    <dt>{ui("Registrierungen")}</dt>
                    <dd>{p?.registrations ?? "…"}</dd>
                  </div>
                </dl>
              </button>
            );
          })}
        </div>
        <p className="muted">
          {summary?.note ?? ui("Zusammenfassung wird geladen …")}
        </p>
        {summary && (
          <p className="form-note">
            {ui("Ereignis-Aufbewahrung: ")}
            {summary.retentionDays}
            {ui(
              " Tage. Längere Vergleichszeiträume enthalten nur noch vorhandene Ereignisse. Eine Jahresansicht ist bei kürzerer Aufbewahrung unvollständig. * Nur eingewilligte Nutzung.",
            )}{" "}
            {summary.enabled
              ? ui("Analyse ist aktiviert.")
              : ui(
                  "Analyse ist deaktiviert; es werden keine neuen Nutzungsereignisse erfasst.",
                )}
          </p>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>{ui("Detailzeitraum")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPreset("custom");
            void load(from, to, bucket, bots);
          }}
        >
          <div className="form-grid">
            <Field title={ui("Von (einschließlich)")}>
              <input
                name="from"
                type="datetime-local"
                step="1"
                value={from}
                required
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPreset("custom");
                }}
              />
            </Field>
            <Field title={ui("Bis (ausschließlich)")}>
              <input
                name="to"
                type="datetime-local"
                step="1"
                value={to}
                required
                onChange={(e) => {
                  setTo(e.target.value);
                  setPreset("custom");
                }}
              />
            </Field>
            <Field title={ui("Gruppierung")}>
              <select
                name="bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
              >
                {[
                  ["hour", ui("Stündlich")],
                  ["day", ui("Täglich")],
                  ["week", ui("Wöchentlich")],
                  ["month", ui("Monatlich")],
                  ["year", ui("Jährlich")],
                ].map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field title={ui("Vermutete Bots")}>
              <select
                name="bots"
                value={bots}
                onChange={(e) => setBots(e.target.value)}
              >
                <option value="exclude">{ui("Ausblenden")}</option>
                <option value="all">{ui("Einbeziehen")}</option>
                <option value="only">{ui("Nur vermutete Bots")}</option>
              </select>
            </Field>
          </div>
          <p className="muted">
            {ui(
              "Eingaben in deiner lokalen Zeitzone. Die Vergleichskarten blenden vermutete Bots stets aus; der Filter gilt für die Detailauswertung.",
            )}
          </p>
          <button className="primary" disabled={busy}>
            {busy ? ui("Wird ausgewertet …") : ui("Zeitraum auswerten")}
          </button>
        </form>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </section>
      {report && (
        <>
          <div className="stats-grid">
            {[
              [ui("Seitenaufrufe"), report.totals.views],
              [ui("Aktive Konten mit Einwilligung"), report.totals.users],
              [ui("Klicks"), report.totals.clicks],
              [
                ui("Neue Registrierungen"),
                report.registrations.reduce((n, r) => n + r.registrations, 0),
              ],
            ].map(([k, v]) => (
              <article className="stat-card" key={k}>
                <div>{k}</div>
                <strong>{v}</strong>
              </article>
            ))}
          </div>
          <section className="panel settings-panel">
            <h2>{ui("Verlauf")}</h2>
            <div className="analytics-bars">
              {report.series.map((r) => (
                <div key={r.date}>
                  <time>
                    {bucket === "hour"
                      ? new Date(r.date).toLocaleString(localeTag, {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : new Date(r.date).toLocaleDateString(localeTag)}
                  </time>
                  <span
                    style={{
                      width: `${Math.max(2, (100 * r.views) / Math.max(1, ...report.series.map((s) => s.views)))}%`,
                    }}
                  />
                  <b>
                    {r.views}
                    {ui(" Aufrufe · ")}
                    {r.users}
                    {ui(" Konten · ")}
                    {r.clicks}
                    {ui(" Klicks")}
                  </b>
                </div>
              ))}
            </div>
            {!report.series.length && (
              <p>
                {ui(
                  "Für diesen Zeitraum wurden keine passenden Nutzungsereignisse erfasst.",
                )}
              </p>
            )}
            <p className="muted">{report.note}</p>
          </section>
          <div className="catalog-grid">
            {[
              [ui("Seiten"), report.pages.map((r) => [r.page, r.count])],
              [
                ui("Referrer (nur Hostnamen)"),
                report.referrers.map((r) => [
                  r.referrer || ui("Direkt / unbekannt"),
                  r.count,
                ]),
              ],
              [
                ui("Klicks nach Seite & Element"),
                report.clicks.map((r) => [`${r.page} · ${r.target}`, r.count]),
              ],
              [
                ui("Registrierungen"),
                report.registrations.map((r) => [
                  new Date(r.date).toLocaleDateString(localeTag),
                  r.registrations,
                ]),
              ],
            ].map(([title, rows]) => (
              <section className="panel settings-panel" key={String(title)}>
                <h3>{String(title)}</h3>
                <div className="table-wrap">
                  <table>
                    <tbody>
                      {(rows as (string | number)[][]).map(([k, v], i) => (
                        <tr key={i}>
                          <td>{k}</td>
                          <td>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
