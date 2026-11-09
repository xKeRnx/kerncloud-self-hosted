"use client";
import { ElectronicInvoicesPanel } from "./electronic-invoices";
import { useLanguage } from "./language";
import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  UserRound,
  ShieldCheck,
  FolderPlus,
} from "lucide-react";
import type { Snapshot } from "@/src/core/types";
import { AccountSecurity } from "./account-security";
import { api } from "./api-client";
import type { Save } from "./materials-panel";
function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { ui, localeTag, t } = useLanguage();

  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
type Profile = {
  name: string;
  email: string;
  company?: string;
  billing_email?: string;
  address?: string;
  vat_id?: string;
};
export function AccountPanel({ state, save }: { state: Snapshot; save: Save }) {
  const { ui, localeTag, t } = useLanguage();

  const [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void api<Profile>("profile")
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("DEIN KONTO")}</div>
          <h1>{ui("Profil & Rechnungsdaten")}</h1>
          <p>
            {ui("Deine persönlichen Angaben gelten für alle deine Workspaces.")}
          </p>
        </div>
        <UserRound size={27} />
      </div>
      <section className="panel settings-panel">
        <h2>{t("Abo & Vertrag", "Subscription & contract")}</h2>
        <p>
          {t(
            "Dein Abo verwalten, kündigen oder einen Widerruf erklären.",
            "Manage your subscription, cancel it or submit a withdrawal.",
          )}
        </p>
        <div className="button-row">
          <a className="secondary" href="/billing">
            {t("Plan & Guthaben", "Plan & balance")}
          </a>
          <a className="secondary" href="/contracts/cancel">
            {t("Verträge hier kündigen", "Cancel contracts here")}
          </a>
          <a className="secondary" href="/contracts/withdraw">
            {t("Vertrag widerrufen", "Withdraw from contract")}
          </a>
        </div>
      </section>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {profile && (
        <section className="panel settings-panel">
          <h2>{ui("Kontodaten")}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await save("profile", b);
                setNotice(ui("Profil gespeichert."));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <div className="form-grid">
              <Field title={ui("Dein Name")}>
                <input
                  name="name"
                  defaultValue={profile.name}
                  maxLength={80}
                  required
                />
              </Field>
              <Field title={ui("Anmelde-E-Mail")}>
                <input value={profile.email} disabled />
                <small>
                  {ui(
                    "Eine Änderung der Anmelde-Adresse benötigt künftig eine E-Mail-Bestätigung.",
                  )}
                </small>
              </Field>
              <Field title={ui("Firma (optional)")}>
                <input
                  name="company"
                  defaultValue={profile.company}
                  maxLength={200}
                />
              </Field>
              <Field title={ui("Rechnungs-E-Mail")}>
                <input
                  name="billing_email"
                  type="email"
                  defaultValue={profile.billing_email}
                  maxLength={254}
                />
              </Field>
              <Field title={ui("Umsatzsteuer-ID (optional)")}>
                <input
                  name="vat_id"
                  defaultValue={profile.vat_id}
                  maxLength={80}
                />
              </Field>
              <Field title={ui("Rechnungsanschrift")}>
                <textarea
                  name="address"
                  defaultValue={profile.address}
                  rows={4}
                  maxLength={1000}
                />
              </Field>
            </div>
            <p className="muted">
              {ui(
                "Bei einer Stripe-Zahlung werden die verbindlichen Rechnungsdaten im Checkout bzw. Kundenportal erfasst.",
              )}
            </p>
            <button className="primary">{ui("Profil speichern")}</button>
          </form>
        </section>
      )}
      <AccountSecurity />
      <section className="panel settings-panel">
        <h2>
          <ShieldCheck size={18} />
          {ui(" Deine Daten")}
        </h2>
        <p>
          {ui(
            "Exportiert Profil, alle Workspaces, Aufträge, Dateien, Chatverlauf und Buchungen als JSON. API-Schlüssel und Passwörter sind ausgeschlossen.",
          )}
        </p>
        <a className="secondary" href="/api/privacy/export" download>
          <Download size={16} />
          {ui("Meine Daten herunterladen")}
        </a>
        <p className="muted">
          {ui(
            "Datenaufbewahrung und Kontolöschung findest du unter Datenschutz.",
          )}
        </p>
      </section>
    </>
  );
}
export function InvoicesPanel() {
  const { ui, localeTag, t } = useLanguage();

  const [rows, setRows] = useState<
      {
        id: string;
        number: string;
        status: string;
        currency: string;
        amount: number;
        created_at: string;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    void api<{ invoices: typeof rows }>("billing/invoices")
      .then((r) => setRows(r.invoices))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <ElectronicInvoicesPanel />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>{t("Stripe-Originalrechnungen", "Original Stripe invoices")}</h2>
          <button
            className="secondary"
            onClick={() =>
              void api<{ url: string }>("billing/portal", {})
                .then((r) => window.location.assign(r.url))
                .catch((e) => setError(e.message))
            }
          >
            <ExternalLink size={15} />
            {ui("Abonnement verwalten")}
          </button>
        </div>
        <section className="panel settings-panel">
          <h2>{t("Abo & Vertrag", "Subscription & contract")}</h2>
          <p>
            {t(
              "Dein Abo verwalten, kündigen oder einen Widerruf erklären.",
              "Manage your subscription, cancel it or submit a withdrawal.",
            )}
          </p>
          <div className="button-row">
            <a className="secondary" href="/billing">
              {t("Plan & Guthaben", "Plan & balance")}
            </a>
            <a className="secondary" href="/contracts/cancel">
              {t("Verträge hier kündigen", "Cancel contracts here")}
            </a>
            <a className="secondary" href="/contracts/withdraw">
              {t("Vertrag widerrufen", "Withdraw from contract")}
            </a>
          </div>
        </section>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{ui("Rechnung")}</th>
                  <th>{ui("Datum")}</th>
                  <th>{ui("Betrag")}</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.number}</td>
                    <td>
                      {new Date(r.created_at).toLocaleDateString(localeTag)}
                    </td>
                    <td>
                      {new Intl.NumberFormat(localeTag, {
                        style: "currency",
                        currency: r.currency,
                      }).format(r.amount / 100)}
                    </td>
                    <td>{r.status}</td>
                    <td>
                      <a
                        className="text-button"
                        href={`/api/billing/invoices/${encodeURIComponent(r.id)}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {ui("PDF herunterladen")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            {ui(
              "Noch keine Rechnungen. Lokale Testfreischaltungen erzeugen keine Rechnung. Nach aktivierter Stripe-Anbindung erscheinen bereitgestellte Rechnungen hier.",
            )}
          </p>
        )}
      </section>
    </>
  );
}
export function WorkspacesPanel({
  state,
  save,
  switchTo,
}: {
  state: Snapshot;
  save: Save;
  switchTo: (id: string) => Promise<void>;
}) {
  const { ui, localeTag, t } = useLanguage();

  const [error, setError] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("GETRENNTE PROJEKTE. EIN KONTO.")}</div>
          <h1>{ui("Deine Workspaces")}</h1>
          <p>
            {ui(
              "Je Workspace eigene Agenten, Modelle, Dateien und Gespräche. Plan und KI-Guthaben teilt dein gesamtes Konto.",
            )}
          </p>
        </div>
        <span className="subtle-chip">
          {state.workspaces.filter((w) => w.owner_id === state.user.id).length}{" "}
          / {state.plan.max_workspaces}
        </span>
      </div>
      <div className="catalog-grid">
        {state.workspaces.map((w) => (
          <section key={w.id} className="panel settings-panel">
            <h2>{w.name}</h2>
            <p>
              {w.id === state.workspace.id
                ? ui("Aktueller Workspace")
                : ui("Separates Agententeam & Projektwissen")}
            </p>
            <button
              className="secondary"
              disabled={w.id === state.workspace.id}
              onClick={() =>
                void switchTo(w.id).catch((e) => setError(e.message))
              }
            >
              {ui("Workspace öffnen")}
            </button>
          </section>
        ))}
      </div>
      <section className="panel settings-panel">
        <h2>
          <FolderPlus size={19} />
          {ui(" Workspace anlegen")}
        </h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            try {
              const r = await save("workspaces", { name });
              await switchTo(r.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Field title={ui("Workspace-Name")}>
            <input
              name="name"
              maxLength={100}
              placeholder={ui("z. B. Support, Entwicklung oder Firma")}
              required
            />
          </Field>
          <button
            className="primary"
            disabled={
              state.workspaces.filter((w) => w.owner_id === state.user.id)
                .length >= state.plan.max_workspaces
            }
          >
            {ui("Workspace erstellen")}
          </button>
        </form>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>{t("Abo & Vertrag", "Subscription & contract")}</h2>
        <p>
          {t(
            "Dein Abo verwalten, kündigen oder einen Widerruf erklären.",
            "Manage your subscription, cancel it or submit a withdrawal.",
          )}
        </p>
        <div className="button-row">
          <a className="secondary" href="/billing">
            {t("Plan & Guthaben", "Plan & balance")}
          </a>
          <a className="secondary" href="/contracts/cancel">
            {t("Verträge hier kündigen", "Cancel contracts here")}
          </a>
          <a className="secondary" href="/contracts/withdraw">
            {t("Vertrag widerrufen", "Withdraw from contract")}
          </a>
        </div>
      </section>
    </>
  );
}
