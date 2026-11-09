"use client";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import type { InvoiceBuyer } from "../src/core/einvoice";

type Row = {
  id: string;
  number: string;
  kind: string;
  source: string;
  status: string;
  amount: number;
  issue_date: string;
  error: string;
  original_id?: string;
};
const emptyBuyer: InvoiceBuyer = {
  name: "",
  street: "",
  postalCode: "",
  city: "",
  country: "DE",
  email: "",
  reference: "",
};
function BuyerFields({
  buyer,
  change,
}: {
  buyer: InvoiceBuyer;
  change: (value: InvoiceBuyer) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="settings-grid">
      {(
        [
          [
            "name",
            "Vollständiger Rechnungsname / Firma",
            "Full billing name / company",
          ],
          ["street", "Straße und Hausnummer", "Street and number"],
          ["postalCode", "Postleitzahl", "Postal code"],
          ["city", "Ort", "City"],
          ["email", "Rechnungs-E-Mail", "Billing email"],
          [
            "reference",
            "Käuferreferenz / Leitweg-ID",
            "Buyer reference / routing ID",
          ],
        ] as const
      ).map(([key, de, en]) => (
        <label className="field" key={key}>
          <span>{t(de, en)}</span>
          <input
            value={buyer[key]}
            onChange={(e) => change({ ...buyer, [key]: e.target.value })}
            required
            maxLength={key === "email" ? 254 : 200}
            type={key === "email" ? "email" : "text"}
          />
        </label>
      ))}
      <p className="form-note">
        {t(
          "Deutschland · EUR. Für öffentliche Auftraggeber die vom Empfänger angegebene Leitweg-ID eintragen.",
          "Germany · EUR. For public bodies enter the routing ID supplied by the recipient.",
        )}
      </p>
    </div>
  );
}
export function ElectronicInvoicesPanel() {
  const { t, localeTag } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]),
    [buyer, setBuyer] = useState(emptyBuyer),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<{ invoices: Row[] }>("billing/einvoices")
      .then((r) => setRows(r.invoices))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    void api<{ buyer: InvoiceBuyer }>("billing/recipient")
      .then((r) => setBuyer(r.buyer))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!rows.some((r) => ["queued", "processing"].includes(r.status))) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [rows]);
  return (
    <>
      <section className="panel settings-panel electronic-invoices">
        <h2>{t("E-Rechnungen", "Electronic invoices")}</h2>
        <p>
          {t(
            "ZUGFeRD-PDF mit eingebetteten Daten oder XRechnung-XML herunterladen. Beide Formate enthalten denselben unveränderlichen Rechnungsstand.",
            "Download the ZUGFeRD PDF with embedded data or the XRechnung XML. Both formats contain the same immutable invoice details.",
          )}
        </p>
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Rechnung", "Invoice")}</th>
                  <th>{t("Datum", "Date")}</th>
                  <th>{t("Betrag", "Amount")}</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.number}
                      {r.kind === "credit_note" && (
                        <small> · {t("Korrektur", "Correction")}</small>
                      )}
                    </td>
                    <td>
                      {new Date(r.issue_date).toLocaleDateString(localeTag)}
                    </td>
                    <td>
                      {new Intl.NumberFormat(localeTag, {
                        style: "currency",
                        currency: "EUR",
                      }).format(Number(r.amount) / 100)}
                    </td>
                    <td>
                      {r.status === "issued"
                        ? t("Ausgestellt", "Issued")
                        : r.status === "failed"
                          ? t("Betreiber kontaktieren", "Contact operator")
                          : t("Wird geprüft", "Being validated")}
                    </td>
                    <td>
                      {r.status === "issued" && (
                        <div className="button-row">
                          <a
                            className="secondary"
                            href={`/api/billing/einvoices/${r.id}/zugferd.pdf`}
                          >
                            ZUGFeRD PDF
                          </a>
                          <a
                            className="secondary"
                            href={`/api/billing/einvoices/${r.id}/xrechnung.xml`}
                          >
                            XRechnung XML
                          </a>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            {t(
              "Noch keine E-Rechnungen ausgestellt. Geschenke und Testfreischaltungen sind keine Rechnungen.",
              "No electronic invoices issued yet. Gifts and test access are not invoices.",
            )}
          </p>
        )}
      </section>
      <section className="panel settings-panel electronic-invoices">
        <h3>{t("Rechnungsempfänger", "Invoice recipient")}</h3>
        <p>
          {t(
            "Änderungen gelten für zukünftige Rechnungen. Bereits ausgestellte Dokumente bleiben erhalten.",
            "Changes apply to future invoices. Existing documents are retained.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            void api("billing/recipient", buyer)
              .then(() =>
                setNotice(
                  t(
                    "Rechnungsanschrift gespeichert.",
                    "Billing address saved.",
                  ),
                ),
              )
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <BuyerFields buyer={buyer} change={setBuyer} />
          <button className="secondary" disabled={busy}>
            {t("Rechnungsempfänger speichern", "Save invoice recipient")}
          </button>
        </form>
      </section>
    </>
  );
}
export function AdminElectronicInvoices() {
  const { t, localeTag } = useLanguage();
  const [data, setData] = useState<{
      invoices: Row[];
      customers: { id: string; name: string; email: string }[];
      imports: { invoice_id: string; status: string; error: string }[];
    } | null>(null),
    [buyer, setBuyer] = useState(emptyBuyer),
    [account, setAccount] = useState(""),
    [company, setCompany] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [credit, setCredit] = useState<Row | null>(null),
    [operationId, setOperationId] = useState(() => crypto.randomUUID()),
    [page, setPage] = useState(1),
    [query, setQuery] = useState("");
  const [lines, setLines] = useState([
    { description: "", quantityMilli: 1000, unitNetCents: 0 },
  ]);
  const day = new Date().toISOString().slice(0, 10);
  const net = lines.reduce(
    (sum, l) => sum + Math.round((l.quantityMilli * l.unitNetCents) / 1000),
    0,
  );
  const vat =
    company?.taxTreatment === "regular" ? Math.round((net * 19) / 100) : 0;
  const gross = net + vat;
  const price = (value: number) =>
    new Intl.NumberFormat(localeTag, {
      style: "currency",
      currency: "EUR",
    }).format(value / 100);
  const retry = credit?.status === "failed";
  const load = () =>
    api<NonNullable<typeof data>>(
      `admin/einvoices?page=${page}&q=${encodeURIComponent(query)}`,
    )
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [page, query]);
  useEffect(() => {
    void api<any>("admin/company")
      .then((r) => setCompany(r.company))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (
      !data?.invoices.some((r) => ["queued", "processing"].includes(r.status))
    )
      return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [data]);
  const invoice = (f: FormData) => ({
    buyer,
    lines,
    serviceStart: f.get("start"),
    serviceEnd: f.get("end"),
    dueDate: f.get("due"),
    paidCents: Math.round(Number(f.get("paid")) * 100),
    paymentText: f.get("payment"),
  });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("admin/einvoices", {
        id: retry ? credit!.id : operationId,
        action: retry ? "retry" : credit ? "credit" : "issue",
        accountId: account,
        invoice: credit ? undefined : invoice(f),
        expectedCompanyVersion: company?.version,
        expectedGrossCents: gross,
        originalId: credit?.id,
        confirmEmail: f.get("confirmEmail"),
        confirmNumber: f.get("confirmNumber"),
        reason: f.get("reason"),
        proof: { password: f.get("password"), code: f.get("code") },
      });
      setOperationId(crypto.randomUUID());
      setCredit(null);
      setNotice(
        t(
          "Vorgang gespeichert. Verbundene Worker erstellen und prüfen beide Formate. Erst nach erfolgreicher Prüfung sind Downloads freigegeben.",
          "Saved. Connected workers generate and validate both formats. Downloads become available only after validation passes.",
        ),
      );
      await load();
    } catch (e: any) {
      setError(e.message);
      void api<any>("admin/company")
        .then((r) => setCompany(r.company))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="customer-management electronic-invoices">
      <section className="panel settings-panel electronic-invoices">
        <h2>
          {t(
            "E-Rechnungen & Rechnungskorrekturen",
            "Electronic invoices & corrections",
          )}
        </h2>
        <p>
          {t(
            "Lokale Erzeugung von XRechnung 3.0.2 und ZUGFeRD/Factur-X im Profil EN 16931. Nur vollständig geprüfte Dateien werden ausgestellt.",
            "Local generation of XRechnung 3.0.2 and ZUGFeRD/Factur-X EN 16931. Only fully validated files are issued.",
          )}
        </p>
        <p>
          {t(
            "Aktuell: deutsche Inlandsleistungen in EUR, Kleinunternehmer oder 19 % Umsatzsteuer. Ausländische Steuerfälle, Reverse Charge und andere Steuersätze werden nicht automatisch ausgestellt.",
            "Currently supports domestic German services in EUR, small-business exemption or 19% VAT. Foreign tax cases, reverse charge and other rates are not automatically issued.",
          )}
        </p>
        <p className="form-note">
          {t(
            "Eine manuelle Rechnung legt eine echte Forderung an, führt aber keine Zahlung aus und ersetzt kein Stripe-Abo. Für Stripe-Umsätze wird dieselbe bestehende Rechnung ergänzt, keine zweite Forderung erzeugt.",
            "A manual invoice records an actual receivable, but does not charge a payment or replace a Stripe subscription. Stripe transactions enrich the existing invoice without creating a second receivable.",
          )}
        </p>
        <a href="/admin/company">
          {t(
            "Firmendaten und Steuerregelung prüfen",
            "Review company details and tax treatment",
          )}
        </a>
      </section>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="panel settings-panel electronic-invoices">
        <div className="panel-heading">
          <h3>{t("Rechnungsarchiv", "Invoice archive")}</h3>
          <button className="secondary" onClick={() => void load()}>
            {t("Aktualisieren", "Refresh")}
          </button>
        </div>
        <label className="field">
          <span>{t("Rechnungsnummer suchen", "Find invoice number")}</span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            maxLength={100}
          />
        </label>
        {!data?.invoices.length ? (
          <p>
            {t(
              "Noch keine E-Rechnungen vorhanden.",
              "No electronic invoices yet.",
            )}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Nummer", "Number")}</th>
                  <th>{t("Betrag", "Amount")}</th>
                  <th>Status</th>
                  <th>{t("Aktionen", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.number}
                      <small>
                        {" "}
                        · {r.source}
                        {r.kind === "credit_note" ? " · Storno" : ""}
                      </small>
                    </td>
                    <td>
                      {new Intl.NumberFormat(localeTag, {
                        style: "currency",
                        currency: "EUR",
                      }).format(Number(r.amount) / 100)}
                    </td>
                    <td>
                      {r.status}
                      {r.error && <p className="form-note">{r.error}</p>}
                    </td>
                    <td>
                      <div className="button-row">
                        {r.status === "issued" && (
                          <>
                            <a
                              className="secondary"
                              href={`/api/admin/einvoices/${r.id}/zugferd.pdf`}
                            >
                              ZUGFeRD
                            </a>
                            <a
                              className="secondary"
                              href={`/api/admin/einvoices/${r.id}/xrechnung.xml`}
                            >
                              XRechnung
                            </a>
                            {r.kind === "invoice" && r.source === "manual" && (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                  setCredit(r);
                                  setOperationId(crypto.randomUUID());
                                }}
                              >
                                {t("Vollständig stornieren", "Full reversal")}
                              </button>
                            )}
                          </>
                        )}
                        {r.status === "failed" && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setCredit(r)}
                          >
                            {t("Erneut prüfen", "Validate again")}
                          </button>
                        )}
                        <a href={`/api/admin/einvoices/${r.id}/report`}>
                          {t("Prüfbericht", "Validation report")}
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="button-row">
          <button
            className="secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            {t("Zurück", "Previous")}
          </button>
          <span>{page}</span>
          <button
            className="secondary"
            disabled={!data || data.invoices.length < 50}
            onClick={() => setPage(page + 1)}
          >
            {t("Weiter", "Next")}
          </button>
        </div>
        {data?.imports.some((i) => i.status === "blocked") && (
          <div className="error-box">
            <h4>
              {t(
                "Stripe-Rechnungen mit Klärungsbedarf",
                "Stripe invoices requiring review",
              )}
            </h4>
            {data.imports.map((i) => (
              <p key={i.invoice_id}>
                {i.invoice_id}: {i.error}
              </p>
            ))}
            <p>
              {t(
                "Die Stripe-Originalrechnung bleibt verfügbar. Unvollständige oder widersprüchliche Daten werden nicht als gültige E-Rechnung ausgegeben.",
                "The original Stripe invoice remains available. Incomplete or conflicting data is not issued as a valid electronic invoice.",
              )}
            </p>
          </div>
        )}
      </section>
      <form
        className="panel settings-panel electronic-invoices"
        onSubmit={submit}
      >
        <h3>
          {retry
            ? t("Erneute Formatprüfung", "Repeat validation")
            : credit
              ? t("Vollständige Rechnungskorrektur", "Full invoice reversal")
              : t("Neue Rechnung ausstellen", "Issue a new invoice")}
        </h3>
        {credit ? (
          <>
            <p>
              {credit.number}:{" "}
              {retry
                ? t(
                    "Die gespeicherten Rechnungsdaten werden unverändert erneut geprüft. Es wird keine neue Rechnungsnummer vergeben.",
                    "The stored invoice details are validated again without changes or a new invoice number.",
                  )
                : t(
                    "Die ursprünglichen Leistungen, Ausstellerdaten und Steuerbeträge werden unverändert für die Korrektur übernommen. Eine Rückzahlung erfolgt gesondert.",
                    "Original items, issuer details and taxes are retained in the correction. Any refund must be processed separately.",
                  )}
            </p>
            {!retry && (
              <label className="field">
                <span>
                  {t(
                    "Ursprüngliche Rechnungsnummer bestätigen",
                    "Confirm original invoice number",
                  )}
                </span>
                <input name="confirmNumber" required />
              </label>
            )}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setCredit(null);
                setOperationId(crypto.randomUUID());
              }}
            >
              {t("Zur neuen Rechnung", "New invoice instead")}
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>{t("Kundenkonto", "Customer account")}</span>
              <select
                required
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  if (e.target.value)
                    void api<{ buyer: InvoiceBuyer }>(
                      `admin/einvoices/recipient?accountId=${encodeURIComponent(e.target.value)}`,
                    )
                      .then((r) => setBuyer(r.buyer))
                      .catch((e) => setError(e.message));
                }}
              >
                <option value="">
                  {t("Kunden auswählen …", "Choose customer …")}
                </option>
                {data?.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.email}
                  </option>
                ))}
              </select>
            </label>
            <BuyerFields buyer={buyer} change={setBuyer} />
            <div className="settings-grid">
              {(
                [
                  ["start", "Leistung von", "Service from"],
                  ["end", "Leistung bis", "Service to"],
                  ["due", "Fällig am", "Due date"],
                ] as const
              ).map(([name, de, en]) => (
                <label className="field" key={name}>
                  <span>{t(de, en)}</span>
                  <input type="date" name={name} defaultValue={day} required />
                </label>
              ))}
            </div>
            <h4>{t("Positionen (Nettopreise)", "Items (net prices)")}</h4>
            {lines.map((line, index) => (
              <div className="invoice-line-grid" key={index}>
                <label className="field">
                  <span>{t("Leistungsbeschreibung", "Description")}</span>
                  <input
                    required
                    value={line.description}
                    maxLength={600}
                    onChange={(e) =>
                      setLines(
                        lines.map((l, i) =>
                          i === index
                            ? { ...l, description: e.target.value }
                            : l,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>{t("Menge", "Quantity")}</span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                    value={line.quantityMilli / 1000}
                    onChange={(e) =>
                      setLines(
                        lines.map((l, i) =>
                          i === index
                            ? {
                                ...l,
                                quantityMilli: Math.round(
                                  Number(e.target.value) * 1000,
                                ),
                              }
                            : l,
                        ),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>
                    {t("Netto-Einzelpreis EUR", "Unit net price EUR")}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={line.unitNetCents / 100}
                    onChange={(e) =>
                      setLines(
                        lines.map((l, i) =>
                          i === index
                            ? {
                                ...l,
                                unitNetCents: Math.round(
                                  Number(e.target.value) * 100,
                                ),
                              }
                            : l,
                        ),
                      )
                    }
                  />
                </label>
                {lines.length > 1 && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() =>
                      setLines(lines.filter((_, i) => i !== index))
                    }
                  >
                    {t("Entfernen", "Remove")}
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={lines.length >= 100}
              onClick={() =>
                setLines([
                  ...lines,
                  { description: "", quantityMilli: 1000, unitNetCents: 0 },
                ])
              }
            >
              {t("Position hinzufügen", "Add item")}
            </button>
            <p className="form-note">
              {company?.taxTreatment === "regular"
                ? t(
                    "Regelbesteuerung: 19 % Umsatzsteuer werden auf den Nettobetrag aufgeschlagen.",
                    "Standard taxation: 19% VAT is added to the net amount.",
                  )
                : t(
                    "Kleinunternehmer: steuerbefreit gemäß § 19 UStG, ohne ausgewiesene Umsatzsteuer.",
                    "Small business: exempt under § 19 UStG, without charged VAT.",
                  )}
            </p>
            <label className="field">
              <span>
                {t(
                  "Bereits bezahlt EUR (nur dokumentieren)",
                  "Already paid EUR (record only)",
                )}
              </span>
              <input
                name="paid"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0"
                required
              />
            </label>
            <label className="field">
              <span>{t("Zahlungsanweisung", "Payment instructions")}</span>
              <textarea
                name="payment"
                defaultValue={t(
                  "Zahlbar bis zum angegebenen Fälligkeitsdatum.",
                  "Payable by the stated due date.",
                )}
                maxLength={500}
                required
              />
            </label>
            <label className="field">
              <span>
                {t(
                  "Empfänger-E-Mail zur Bestätigung wiederholen",
                  "Repeat recipient email to confirm",
                )}
              </span>
              <input
                name="confirmEmail"
                type="email"
                required
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={(e) => {
                const form = e.currentTarget.form;
                if (!form) return;
                setBusy(true);
                void fetch("/api/admin/einvoices/preview", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    invoice: invoice(new FormData(form)),
                  }),
                })
                  .then(async (r) => {
                    if (!r.ok)
                      throw new Error(
                        (await r.json()).error ?? "Preview failed",
                      );
                    const url = URL.createObjectURL(await r.blob()),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = "invoice-preview.pdf";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t("PDF-Entwurf herunterladen", "Download PDF draft")}
            </button>
          </>
        )}
        <label className="field">
          <span>
            {t("Begründung / Buchungshinweis", "Reason / accounting note")}
          </span>
          <textarea name="reason" required minLength={5} maxLength={1000} />
        </label>
        <div className="settings-grid">
          <label className="field">
            <span>{t("Dein Admin-Passwort", "Your admin password")}</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>
              {t("Dein 2FA-Code, falls aktiviert", "Your 2FA code, if enabled")}
            </span>
            <input name="code" autoComplete="one-time-code" />
          </label>
        </div>
        <p className="form-note">
          {t(
            "Nach erfolgreicher Prüfung werden Nummer, Empfänger, Steuerregelung und Dateien festgeschrieben. Fehler werden durch eine verknüpfte Korrektur behoben.",
            "After validation, the number, recipient, tax treatment and files are fixed. Corrections are linked documents.",
          )}
        </p>
        {!credit && (
          <p>
            <strong>
              {t("Netto", "Net")}: {price(net)} · {t("Umsatzsteuer", "VAT")}:{" "}
              {price(vat)} · {t("Gesamt", "Total")}: {price(gross)}
            </strong>
          </p>
        )}
        <button
          className="primary"
          disabled={busy || (!credit && (!account || !company))}
        >
          {retry
            ? t("Unverändert erneut prüfen", "Validate unchanged invoice again")
            : credit
              ? t(
                  "Korrektur verbindlich erstellen",
                  "Create binding correction",
                )
              : t("Rechnung verbindlich ausstellen", "Issue binding invoice")}
        </button>
      </form>
    </div>
  );
}
