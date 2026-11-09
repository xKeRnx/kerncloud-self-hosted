"use client";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { api, selectWorkspace } from "./api-client";
import { useLanguage } from "./language";
type Plan = {
  id: string;
  name: string;
  credits: number;
  runtime_minutes: number;
};
type Customer = {
  id: string;
  name: string;
  email: string;
  role: string;
  suspended: boolean;
  invitation_pending: boolean;
  plan_name?: string;
  access_expires_at?: string | null;
};
type Detail = {
  user: Customer & {
    mfa_enabled: boolean;
    password_enabled: boolean;
    password_change_required: boolean;
  };
  account: {
    id: string;
    plan_id: string;
    credits: number;
    runtime_purchased: number;
    subscription_status: string;
    access_expires_at: string | null;
    access_source: string;
    subscription_period_end: string | null;
    subscription_cancel_at: string | null;
    stripe_subscription_id: string | null;
  };
  allowance: {
    period: string;
    credits: number;
    runtime_seconds: number;
  } | null;
  plans: Plan[];
  workspaces: { id: string; name: string; agents: number; open_runs: number }[];
  sessions: {
    authenticated_at: string;
    expires_at: string;
    mfa_verified: boolean;
  }[];
  identities: { provider: string }[];
  notes: { id: string; content: string; actor: string; created_at: string }[];
  grants: {
    id: string;
    kind: string;
    credits: number;
    runtime_seconds: number;
    amount_cents: number;
    reason: string;
    customer_message: string;
    created_at: string;
    receipt: boolean;
    plan_id: string | null;
  }[];
  invoices: {
    id: string;
    number: string;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
  }[];
  deliveries: {
    id: string;
    purpose: string;
    status: string;
    created_at: string;
  }[];
  audit: { id: number; action: string; actor: string; created_at: string }[];
};
type Mail = {
  enabled: boolean;
  host: string;
  port: number;
  mode: string;
  username: string;
  from: string;
  configured: boolean;
  localAllowed: boolean;
};
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function ActionForm({
  title,
  children,
  submit,
  label,
  confirm = false,
  security = true,
}: {
  title: string;
  children?: ReactNode;
  submit: (f: FormData) => Promise<void>;
  label: string;
  confirm?: boolean;
  security?: boolean;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await submit(new FormData(form));
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel customer-action">
      <h3>{title}</h3>
      <form onSubmit={send}>
        {children}
        <Field
          title={t("Begründung / interne Notiz", "Reason / internal note")}
        >
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={1000}
            rows={2}
          />
        </Field>
        {confirm && (
          <Field
            title={t("Kunden-E-Mail zur Bestätigung", "Confirm customer email")}
          >
            <input
              type="email"
              name="confirmEmail"
              required
              autoComplete="off"
            />
          </Field>
        )}
        {security && (
          <div className="admin-proof">
            <p className="form-note">
              {t(
                "Aktion mit deinem eigenen Admin-Zugang bestätigen. Bei Anmeldung über einen externen Dienst gilt die kürzlich bestätigte Sitzung.",
                "Confirm using your own admin credentials. Recent authentication is used for external sign-in.",
              )}
            </p>
            <div className="form-grid">
              <Field title={t("Dein Admin-Passwort", "Your admin password")}>
                <input
                  name="adminPassword"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                />
              </Field>
              <Field
                title={t(
                  "Dein 2FA-Code, falls aktiviert",
                  "Your 2FA code, if enabled",
                )}
              >
                <input
                  name="adminCode"
                  autoComplete="one-time-code"
                  maxLength={80}
                />
              </Field>
            </div>
          </div>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" disabled={busy}>
          {busy ? t("Wird gespeichert …", "Saving …") : label}
        </button>
      </form>
    </section>
  );
}
export const common = (f: FormData) => ({
  reason: String(f.get("reason") ?? ""),
  confirmEmail: String(f.get("confirmEmail") ?? ""),
  proof: {
    password: String(f.get("adminPassword") ?? ""),
    code: String(f.get("adminCode") ?? ""),
  },
});
const iso = (value: FormDataEntryValue | null) =>
  value ? new Date(String(value)).toISOString() : null;
const localDate = (value: string | null) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
export function AdminCustomers({ onChanged }: { onChanged: () => void }) {
  const { t, localeTag, number, money } = useLanguage();
  const date = (value: string | null) =>
    value ? new Date(value).toLocaleString(localeTag) : "—";
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [plan, setPlan] = useState(""),
    [page, setPage] = useState(1),
    [list, setList] = useState<{
      users: Customer[];
      total: number;
      pages: number;
      plans: Plan[];
    } | null>(null),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState("overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [url, setUrl] = useState(""),
    [invite, setInvite] = useState(false),
    [mail, setMail] = useState<Mail | null>(null),
    [grantId, setGrantId] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    const data = await api<any>(
      `admin/customers?q=${encodeURIComponent(query)}&status=${status}&plan=${encodeURIComponent(plan)}&page=${page}`,
    );
    setList(data);
    setSelected((old) => old || data.users[0]?.id || "");
  }, [query, status, plan, page]);
  const loadDetail = useCallback(async () => {
    if (selected)
      setDetail(
        await api<Detail>("admin/customers/" + encodeURIComponent(selected)),
      );
  }, [selected]);
  useEffect(() => {
    const timer = setTimeout(
      () => void load().catch((e) => setError(e.message)),
      250,
    );
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    setDetail(null);
    setGrantId(crypto.randomUUID());
    void loadDetail().catch((e) => setError(e.message));
  }, [loadDetail]);
  useEffect(() => {
    void api<Mail>("admin/mail")
      .then(setMail)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (
      !detail?.deliveries.some((d) => ["queued", "sending"].includes(d.status))
    )
      return;
    const timer = setInterval(() => void loadDetail().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [detail, loadDetail]);
  async function action(
    type: string,
    f: FormData,
    extra: Record<string, unknown> = {},
  ) {
    const result = await api<any>("admin/customers/" + selected, {
      action: type,
      ...common(f),
      ...extra,
    });
    setNotice(t("Kundenkonto aktualisiert.", "Customer account updated."));
    setUrl(result.url ?? "");
    await Promise.all([load(), loadDetail()]);
    onChanged();
    return result;
  }
  const open = (id: string) => {
    setUrl("");
    setSelected(id);
    setTab("overview");
  };
  return (
    <div className="customer-management">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>{t("Kundenverwaltung", "Customer management")}</h2>
            <p>
              {t(
                "Zugänge, Laufzeiten, Support und Kulanz pro Kundenkonto.",
                "Access, subscription dates, support and goodwill per customer account.",
              )}
            </p>
          </div>
          <button className="primary" onClick={() => setInvite(!invite)}>
            {t("Kunden einladen", "Invite customer")}
          </button>
        </div>
        <div className="customer-toolbar">
          <Field title={t("Suchen", "Search")}>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder={t("Name oder E-Mail", "Name or email")}
            />
          </Field>
          <Field title="Status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">{t("Alle", "All")}</option>
              <option value="active">{t("Aktiv", "Active")}</option>
              <option value="invited">{t("Eingeladen", "Invited")}</option>
              <option value="suspended">{t("Gesperrt", "Suspended")}</option>
            </select>
          </Field>
          <Field title={t("Plan", "Plan")}>
            <select
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("Alle Pläne", "All plans")}</option>
              {list?.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {url && (
        <section className="panel settings-panel one-time-link">
          <h3>
            {t(
              "Einmaliger Link · 30 Minuten gültig",
              "One-time link · valid for 30 minutes",
            )}
          </h3>
          <p>
            {t(
              "Nur jetzt sichtbar. Vertraulich an den Kunden weitergeben. Ein neuer Link macht den bisherigen ungültig.",
              "Visible only now. Share privately with the customer. A new link invalidates the previous one.",
            )}
          </p>
          <input
            aria-label={t("Einmaliger Zugang", "One-time access")}
            readOnly
            value={url}
          />
          <button
            className="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .then(() => setNotice(t("Link kopiert.", "Link copied.")))
                .catch(() =>
                  setError(
                    t(
                      "Bitte den Link manuell kopieren.",
                      "Please copy the link manually.",
                    ),
                  ),
                )
            }
          >
            {t("Link kopieren", "Copy link")}
          </button>
          <button className="text-button" onClick={() => setUrl("")}>
            {t("Ausblenden", "Hide")}
          </button>
        </section>
      )}
      {invite && (
        <ActionForm
          title={t("Neues Kundenkonto einladen", "Invite a new customer")}
          label={t("Einladung erstellen", "Create invitation")}
          submit={async (f) => {
            const result = await api<any>("admin/customers", {
              ...common(f),
              name: f.get("name"),
              email: f.get("email"),
              send: f.get("send") === "on",
            });
            setSelected(result.id);
            setUrl(result.url ?? "");
            setInvite(false);
            setNotice(
              result.delivery === "queued"
                ? t(
                    "Einladung zum Versand vorgemerkt.",
                    "Invitation queued for delivery.",
                  )
                : t("Einladung erstellt.", "Invitation created."),
            );
            await load();
            onChanged();
          }}
        >
          <div className="form-grid">
            <Field title="Name">
              <input name="name" required maxLength={80} />
            </Field>
            <Field title="E-Mail">
              <input name="email" type="email" required maxLength={254} />
            </Field>
          </div>
          <label className="check-row">
            <input name="send" type="checkbox" disabled={!mail?.configured} />
            {t(
              "Einladung per E-Mail senden; sonst einmaligen Link anzeigen",
              "Send invitation by email; otherwise show a one-time link",
            )}
          </label>
          <p className="form-note">
            {t(
              "Der Kunde aktiviert sein Konto selbst und bestätigt die Datenschutzhinweise. Es wird kein Passwort per E-Mail verschickt.",
              "The customer activates their account and accepts the privacy notice. Passwords are never emailed.",
            )}
          </p>
        </ActionForm>
      )}
      <div className="customer-columns">
        <section className="panel customer-list">
          <div className="panel-heading">
            <h3>{t("Kundenkonten", "Customer accounts")}</h3>
            <span>{list?.total ?? 0}</span>
          </div>
          {list?.users.map((u) => (
            <button
              key={u.id}
              className={
                "customer-row " + (selected === u.id ? "selected" : "")
              }
              onClick={() => open(u.id)}
            >
              <strong>{u.name}</strong>
              <span>{u.email}</span>
              <small>
                {u.role === "admin" ? "Admin" : u.plan_name} ·{" "}
                {u.suspended
                  ? t("Gesperrt", "Suspended")
                  : u.invitation_pending
                    ? t("Eingeladen", "Invited")
                    : t("Aktiv", "Active")}
              </small>
              {u.access_expires_at && (
                <small>
                  {t("Zugang bis", "Access until")} {date(u.access_expires_at)}
                </small>
              )}
            </button>
          ))}
          {list && !list.users.length && (
            <p>{t("Keine passenden Kunden.", "No matching customers.")}</p>
          )}
          <div className="customer-pagination">
            <button
              className="secondary compact"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ←
            </button>
            <span>
              {page} / {list?.pages ?? 1}
            </span>
            <button
              className="secondary compact"
              disabled={page >= (list?.pages ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              →
            </button>
          </div>
        </section>
        <div className="customer-detail" key={selected}>
          {!detail ? (
            <p>{t("Kundenkonto auswählen …", "Select a customer account …")}</p>
          ) : (
            <>
              <section className="panel settings-panel">
                <h2>{detail.user.name}</h2>
                <p>{detail.user.email}</p>
                <div className="customer-summary">
                  <span>{detail.account.plan_id}</span>
                  <span>{number(detail.account.credits)} Credits</span>
                  <span>
                    {number(detail.account.runtime_purchased / 60)}{" "}
                    {t(
                      "gekaufte / geschenkte Minuten",
                      "purchased / gifted minutes",
                    )}
                  </span>
                  <span>
                    2FA:{" "}
                    {detail.user.mfa_enabled
                      ? t("aktiv", "enabled")
                      : t("aus", "off")}
                  </span>
                </div>
                <div className="tabs">
                  {[
                    ["overview", t("Übersicht", "Overview")],
                    ["access", t("Zugang & Support", "Access & support")],
                    ["billing", t("Abo & Geschenke", "Subscription & gifts")],
                    ["history", t("Verlauf", "History")],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={tab === id ? "active" : ""}
                      onClick={() => setTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>
              {tab === "overview" && (
                <>
                  <ActionForm
                    title={t("Kontodaten bearbeiten", "Edit account details")}
                    label={t("Kontodaten speichern", "Save account details")}
                    submit={async (f) => {
                      await action("profile", f, {
                        name: f.get("name"),
                        email: f.get("email"),
                      });
                    }}
                  >
                    <div className="form-grid">
                      <Field title="Name">
                        <input
                          name="name"
                          defaultValue={detail.user.name}
                          required
                          maxLength={80}
                        />
                      </Field>
                      <Field title="E-Mail">
                        <input
                          name="email"
                          type="email"
                          defaultValue={detail.user.email}
                          readOnly={detail.user.role === "admin"}
                          required
                        />
                      </Field>
                    </div>
                    <p className="form-note">
                      {t(
                        "Eine geänderte E-Mail beendet bestehende Sitzungen. Verknüpfte externe Identitäten bleiben getrennt verwaltet.",
                        "Changing the email revokes existing sessions. Linked external identities remain separately managed.",
                      )}
                    </p>
                  </ActionForm>
                  <section className="panel settings-panel">
                    <h3>Workspaces</h3>
                    {detail.workspaces.map((w) => (
                      <p key={w.id}>
                        <strong>{w.name}</strong> · {w.agents}{" "}
                        {t("Agenten", "agents")} · {w.open_runs}{" "}
                        {t("offene Aufträge", "open tasks")}
                      </p>
                    ))}
                  </section>
                  <ActionForm
                    title={t("Interne Notiz", "Internal note")}
                    security={false}
                    label={t("Notiz hinzufügen", "Add note")}
                    submit={async (f) => {
                      await action("note", f);
                    }}
                  />
                </>
              )}
              {tab === "access" && (
                <>
                  <section className="panel settings-panel">
                    <h3>{t("Anmeldungen", "Sign-ins")}</h3>
                    <p>
                      {detail.sessions.length}{" "}
                      {t("aktive Sitzungen", "active sessions")} ·{" "}
                      {detail.identities.map((x) => x.provider).join(", ") ||
                        t("Keine externen Logins", "No external sign-ins")}
                    </p>
                    {detail.user.password_change_required && (
                      <p>
                        {t(
                          "Passwortwechsel beim nächsten Login erforderlich.",
                          "Password change required at next sign-in.",
                        )}
                      </p>
                    )}
                    {detail.user.role === "admin" && (
                      <p>
                        {t(
                          "Administratorkonten verwalten ihr Passwort und ihre 2FA im eigenen Profil.",
                          "Administrators manage their password and 2FA in their own profile.",
                        )}
                      </p>
                    )}
                  </section>
                  {detail.user.role !== "admin" && (
                    <>
                      <ActionForm
                        title={t("Passwort zurücksetzen", "Reset password")}
                        label={t(
                          "Reset-Link erstellen / senden",
                          "Create / send reset link",
                        )}
                        submit={async (f) => {
                          await action("reset", f, {
                            send: f.get("send") === "on",
                          });
                        }}
                      >
                        <label className="check-row">
                          <input
                            type="checkbox"
                            name="send"
                            disabled={!mail?.configured}
                            defaultChecked={mail?.configured}
                          />
                          {t(
                            "Link per E-Mail senden; ohne Häkchen einmalig anzeigen",
                            "Email the link; otherwise show it once",
                          )}
                        </label>
                        <p>
                          {t(
                            "Einmalig, 30 Minuten gültig. Vorhandene 2FA bleibt aktiv.",
                            "Single use, valid for 30 minutes. Existing 2FA stays enabled.",
                          )}
                        </p>
                      </ActionForm>
                      <ActionForm
                        title={t(
                          "Passwort direkt setzen",
                          "Set password directly",
                        )}
                        confirm
                        label={t("Neues Passwort setzen", "Set new password")}
                        submit={async (f) => {
                          await action("password", f, {
                            newPassword: f.get("newPassword"),
                            requireChange: f.get("requireChange") === "on",
                          });
                        }}
                      >
                        <Field
                          title={t(
                            "Neues Kundenpasswort",
                            "New customer password",
                          )}
                        >
                          <input
                            type="password"
                            name="newPassword"
                            required
                            minLength={12}
                            maxLength={128}
                            autoComplete="new-password"
                          />
                        </Field>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            name="requireChange"
                            defaultChecked
                          />
                          {t(
                            "Kunde muss das Passwort beim nächsten Login ändern",
                            "Customer must change this password at next sign-in",
                          )}
                        </label>
                        <p className="form-note">
                          {t(
                            "Bestehende Sitzungen und Reset-Links werden widerrufen. Das Passwort wird nicht per E-Mail gesendet.",
                            "Existing sessions and reset links are revoked. This password is not emailed.",
                          )}
                        </p>
                      </ActionForm>
                      <ActionForm
                        title={t(
                          "Kundenansicht für Support",
                          "Customer view for support",
                        )}
                        confirm
                        label={t("Supportmodus öffnen", "Open support mode")}
                        submit={async (f) => {
                          await api("support/start", {
                            userId: selected,
                            ...common(f),
                            mode: f.get("mode"),
                          });
                          selectWorkspace(undefined);
                          window.location.assign("/overview");
                        }}
                      >
                        <Field
                          title={t(
                            "Supportrechte · maximal 15 Minuten",
                            "Support permissions · maximum 15 minutes",
                          )}
                        >
                          <select name="mode">
                            <option value="read">
                              {t("Nur ansehen", "Read only")}
                            </option>
                            <option value="write">
                              {t(
                                "Workspace bearbeiten · kann KI-Credits verbrauchen",
                                "Edit workspace · may consume AI credits",
                              )}
                            </option>
                          </select>
                        </Field>
                        <p>
                          {t(
                            "Dein Admin-Login bleibt erhalten. Sicherheit, Zahlung und Zugangsschlüssel bleiben gesperrt. Start, Ende und Änderungen werden protokolliert.",
                            "Your admin sign-in remains intact. Security, payment and credentials stay blocked. Start, end and changes are audited.",
                          )}
                        </p>
                      </ActionForm>
                      <ActionForm
                        title={
                          detail.user.suspended
                            ? t("Konto entsperren", "Restore account")
                            : t("Konto sperren", "Suspend account")
                        }
                        label={
                          detail.user.suspended
                            ? t("Entsperren", "Restore")
                            : t("Konto sperren", "Suspend")
                        }
                        submit={async (f) => {
                          await action("suspend", f, {
                            suspended: !detail.user.suspended,
                          });
                        }}
                      />
                      <ActionForm
                        title={t(
                          "2FA-Notfallrücksetzung",
                          "Emergency 2FA reset",
                        )}
                        confirm
                        label={t("2FA zurücksetzen", "Reset 2FA")}
                        submit={async (f) => {
                          await action("mfa_reset", f);
                        }}
                      >
                        <p>
                          {t(
                            "Nur nach eigener Identitätsprüfung des Kunden. Sitzungen und Wiederherstellungscodes werden widerrufen.",
                            "Only after verifying the customer’s identity. Sessions and recovery codes are revoked.",
                          )}
                        </p>
                      </ActionForm>
                    </>
                  )}
                  <ActionForm
                    title={t(
                      "Alle Kundensitzungen beenden",
                      "Revoke customer sessions",
                    )}
                    label={t("Sitzungen widerrufen", "Revoke sessions")}
                    submit={async (f) => {
                      await action("revoke", f);
                    }}
                  />
                  <ActionForm
                    title={t("Kontorolle verwalten", "Manage account role")}
                    confirm
                    label={t("Rolle ändern", "Change role")}
                    submit={async (f) => {
                      await action("role", f, { role: f.get("role") });
                    }}
                  >
                    <Field title={t("Neue Rolle", "New role")}>
                      <select name="role" defaultValue={detail.user.role}>
                        <option value="user">{t("Kunde", "Customer")}</option>
                        <option value="admin">Administrator</option>
                      </select>
                    </Field>
                  </ActionForm>
                </>
              )}
              {tab === "billing" && (
                <>
                  <section className="panel settings-panel">
                    <h3>
                      {t("Laufzeit & Abrechnung", "Access period & billing")}
                    </h3>
                    <dl className="customer-dates">
                      <dt>Status</dt>
                      <dd>{detail.account.subscription_status}</dd>
                      <dt>
                        {t("KeRnCloud-Zugang bis", "KeRnCloud access until")}
                      </dt>
                      <dd>
                        {detail.account.access_expires_at
                          ? date(detail.account.access_expires_at)
                          : t("Ohne manuelle Befristung", "No manual expiry")}
                      </dd>
                      <dt>
                        {t("Stripe-Zeitraum endet", "Stripe period ends")}
                      </dt>
                      <dd>{date(detail.account.subscription_period_end)}</dd>
                      <dt>
                        {t("Stripe-Kündigung zum", "Stripe cancellation date")}
                      </dt>
                      <dd>{date(detail.account.subscription_cancel_at)}</dd>
                    </dl>
                    {detail.account.stripe_subscription_id && (
                      <p className="form-note">
                        {t(
                          "Bei Stripe-Abos ändern lokale Fristen keine Abbuchungen. Zahlungsplan und Kündigung separat bei Stripe verwalten.",
                          "Local access dates do not change Stripe charges. Manage the paid subscription and cancellation in Stripe separately.",
                        )}
                      </p>
                    )}
                  </section>
                  <ActionForm
                    title={t("Plan & Zugangsfrist", "Plan & access expiry")}
                    label={t("Zugang aktualisieren", "Update access")}
                    submit={async (f) => {
                      await action("subscription", f, {
                        planId: f.get("plan"),
                        status: f.get("status"),
                        until: iso(f.get("until")),
                      });
                    }}
                  >
                    <div className="form-grid">
                      <Field title="Plan">
                        <select
                          name="plan"
                          defaultValue={detail.account.plan_id}
                        >
                          {detail.plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field title="Status">
                        <select
                          name="status"
                          defaultValue={detail.account.subscription_status}
                        >
                          {Array.from(
                            new Set([
                              detail.account.subscription_status,
                              "free",
                              "active",
                              "local_test",
                              "canceled",
                            ]),
                          ).map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        title={t(
                          "KeRnCloud-Zugang bis (lokale Zeitzone)",
                          "KeRnCloud access until (local time zone)",
                        )}
                      >
                        <input
                          type="datetime-local"
                          name="until"
                          defaultValue={localDate(
                            detail.account.access_expires_at,
                          )}
                        />
                      </Field>
                    </div>
                    <p className="form-note">
                      {t(
                        "Leer bedeutet unbefristet. „canceled“ sperrt den Dienst sofort. Aktive manuelle und Geschenk-Abos erhalten ihr Kontingent bei Aktivierung und danach am 1. jedes Monats (UTC), bis zum Ablaufdatum. Vorhandene Daten bleiben erhalten.",
                        "Empty means no expiry. “canceled” stops service access immediately. Active manual and gifted subscriptions receive allowances on activation and then on the first day of each month (UTC), until expiry. Existing data remains intact.",
                      )}
                    </p>
                  </ActionForm>
                  <ActionForm
                    title={t(
                      "Monatskontingent abgleichen · 0 €",
                      "Reconcile monthly allowance · €0",
                    )}
                    label={t(
                      "Aktuelles Monatskontingent einmalig buchen",
                      "Allocate current month once",
                    )}
                    submit={async (f) => {
                      await action("allowance", f, {
                        planId: detail.account.plan_id,
                      });
                    }}
                  >
                    <p>
                      {t(
                        "Aktive manuelle und Geschenk-Abos werden automatisch versorgt. Dieser Abgleich holt ein fehlendes Monatskontingent nach. Er löst keine Zahlung oder Rechnung aus und bucht bereits zugeteilte Kontingente nicht erneut.",
                        "Active manual and gifted subscriptions renew automatically. This action reconciles a missing monthly allowance. It triggers no payment or invoice and never grants an existing allowance twice.",
                      )}
                    </p>
                    <p>
                      <strong>
                        {number(
                          detail.plans.find(
                            (p) => p.id === detail.account.plan_id,
                          )?.credits ?? 0,
                        )}{" "}
                        KI-Credits ·{" "}
                        {number(
                          detail.plans.find(
                            (p) => p.id === detail.account.plan_id,
                          )?.runtime_minutes ?? 0,
                        )}{" "}
                        {t("Hosting-Minuten", "hosted minutes")}
                      </strong>
                    </p>
                    <p className="form-note">
                      {detail.allowance
                        ? t(
                            `Für ${detail.allowance.period} bereits zugeteilt. Erneutes Buchen ändert das Guthaben nicht.`,
                            `Already allocated for ${detail.allowance.period}. Repeating this action does not change the balance.`,
                          )
                        : t(
                            "Einmal pro Konto und UTC-Kalendermonat, auch bei Planwechsel. Bereits vorhandene Laufzeit-Kontingente werden nicht verdoppelt. Hosting-Minuten verfallen am Monatsende. Aktive manuelle und Geschenk-Abos werden monatlich automatisch versorgt. Stripe-Abos erhalten ihre Kontingente nach bestätigter Zahlung.",
                            "Once per account per UTC calendar month, including plan changes. Existing runtime allowances are not duplicated. Hosted minutes expire at month end. Active manual and gifted subscriptions renew automatically each month. Stripe subscriptions receive allowances after confirmed payment.",
                          )}
                    </p>
                  </ActionForm>
                  <ActionForm
                    title={t(
                      "Geschenk, Kulanz oder Korrektur · 0 €",
                      "Gift, goodwill or adjustment · €0",
                    )}
                    label={t("Einmalig mit 0 € buchen", "Record once at €0")}
                    submit={async (f) => {
                      await action("grant", f, {
                        id: grantId,
                        kind: f.get("kind"),
                        planId: f.get("giftPlan") || null,
                        until: iso(f.get("giftUntil")),
                        credits: Number(f.get("credits")),
                        minutes: Number(f.get("minutes")),
                        receipt: f.get("receipt") === "on",
                        customerMessage: f.get("customerMessage"),
                      });
                      setGrantId(crypto.randomUUID());
                    }}
                  >
                    <div className="form-grid">
                      <Field title={t("Buchungsart", "Entry type")}>
                        <select name="kind">
                          <option value="gift">{t("Geschenk", "Gift")}</option>
                          <option value="goodwill">
                            {t("Kulanz", "Goodwill")}
                          </option>
                          <option value="test">
                            {t("Testfreischaltung", "Test access")}
                          </option>
                          <option value="adjustment">
                            {t(
                              "Guthabenkorrektur (auch negativ)",
                              "Balance adjustment (may be negative)",
                            )}
                          </option>
                        </select>
                      </Field>
                      <Field
                        title={t(
                          "Optionaler Geschenkplan",
                          "Optional gifted plan",
                        )}
                      >
                        <select name="giftPlan">
                          <option value="">
                            {t("Plan beibehalten", "Keep current plan")}
                          </option>
                          {detail.plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field
                        title={t(
                          "Geschenkplan gültig bis",
                          "Gifted plan valid until",
                        )}
                      >
                        <input name="giftUntil" type="datetime-local" />
                      </Field>
                      <Field
                        title={t(
                          "Zusätzliche KI-Credits einmalig hinzufügen",
                          "Extra AI credits to add once",
                        )}
                      >
                        <input
                          name="credits"
                          type="number"
                          step="1"
                          defaultValue="0"
                          min={-100000000}
                          max={100000000}
                        />
                      </Field>
                      <Field
                        title={t(
                          "Laufzeit-Minuten einmalig hinzufügen",
                          "Runtime minutes to add once",
                        )}
                      >
                        <input
                          name="minutes"
                          type="number"
                          step="1"
                          defaultValue="0"
                          min={-1000000}
                          max={1000000}
                        />
                      </Field>
                    </div>
                    <Field
                      title={t(
                        "Nachricht für den Kunden",
                        "Message for the customer",
                      )}
                    >
                      <textarea
                        name="customerMessage"
                        maxLength={2000}
                        rows={2}
                      />
                    </Field>
                    <label className="check-row">
                      <input name="receipt" type="checkbox" />
                      {t(
                        "Herunterladbaren Geschenk-/Kulanzbeleg bereitstellen",
                        "Provide a downloadable gift / goodwill receipt",
                      )}
                    </label>
                    <p className="form-note">
                      {t(
                        "Zahlbetrag 0 €. Keine Zahlung, keine Stripe-Rechnung und keine steuerliche Gutschrift. Planfreischaltung und Guthaben sind getrennt. Monatliche Aufrufkontingente werden nicht zurückgesetzt.",
                        "Amount due €0. No payment, Stripe invoice or tax credit note. Plan access and credit are separate. Monthly call allowances are not reset.",
                      )}
                    </p>
                  </ActionForm>
                  <section className="panel settings-panel">
                    <h3>
                      {t("Kostenlose Buchungen", "Complimentary entries")}
                    </h3>
                    <p className="form-note">
                      {t(
                        "Geschenk-Abos erhalten zusätzlich ihr reguläres Monatskontingent automatisch bis zum Ablaufdatum. Einmalige Credits und Minuten werden nicht monatlich wiederholt.",
                        "Gifted subscriptions also receive their regular monthly allowance automatically until expiry. One-off credits and minutes are not repeated monthly.",
                      )}
                    </p>
                    {detail.grants.length ? (
                      detail.grants.map((g) => (
                        <article className="customer-entry" key={g.id}>
                          <strong>
                            {g.kind} · {money(g.amount_cents)}
                          </strong>
                          <p>
                            {g.credits} Credits · {g.runtime_seconds / 60}{" "}
                            {t("Minuten", "minutes")} · {g.plan_id ?? "–"}
                          </p>
                          <p>{g.reason}</p>
                          <small>{date(g.created_at)}</small>
                          {g.receipt && (
                            <a
                              className="text-button"
                              href={`/api/admin/customers/${selected}/grants/${g.id}`}
                            >
                              {t("Beleg herunterladen", "Download receipt")}
                            </a>
                          )}
                        </article>
                      ))
                    ) : (
                      <p>{t("Noch keine Buchungen.", "No entries yet.")}</p>
                    )}
                  </section>
                  <section className="panel settings-panel">
                    <h3>{t("Stripe-Rechnungen", "Stripe invoices")}</h3>
                    {detail.invoices.length ? (
                      detail.invoices.map((i) => (
                        <p key={i.id}>
                          <strong>{i.number}</strong> · {i.amount / 100}{" "}
                          {i.currency.toUpperCase()} · {i.status}{" "}
                          <a
                            className="text-button"
                            href={`/api/admin/customers/${selected}/invoices/${i.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("PDF öffnen", "Open PDF")}
                          </a>
                        </p>
                      ))
                    ) : (
                      <p>
                        {t(
                          "Keine Stripe-Rechnungen vorhanden.",
                          "No Stripe invoices available.",
                        )}
                      </p>
                    )}
                  </section>
                </>
              )}
              {tab === "history" && (
                <>
                  <section className="panel settings-panel">
                    <h3>{t("Interne Notizen", "Internal notes")}</h3>
                    {detail.notes.map((n) => (
                      <article key={n.id} className="customer-entry">
                        <p>{n.content}</p>
                        <small>
                          {n.actor} · {date(n.created_at)}
                        </small>
                      </article>
                    ))}
                  </section>
                  <section className="panel settings-panel">
                    <h3>{t("Mailversand", "Email delivery")}</h3>
                    {detail.deliveries.map((d) => (
                      <p key={d.id}>
                        {d.purpose} · <strong>{d.status}</strong> ·{" "}
                        {date(d.created_at)}
                      </p>
                    ))}
                    <p className="form-note">
                      {t(
                        "„sent“ bedeutet Annahme durch den SMTP-Server, keine Zustellgarantie. Unbestätigte Sendungen werden nicht automatisch wiederholt.",
                        "“sent” means the SMTP server accepted the message, not guaranteed delivery. Uncertain sends are not automatically retried.",
                      )}
                    </p>
                  </section>
                  <section className="panel settings-panel">
                    <h3>{t("Audit-Verlauf", "Audit history")}</h3>
                    {detail.audit.map((a) => (
                      <p key={a.id}>
                        {a.action} · {a.actor ?? "System"} ·{" "}
                        {date(a.created_at)}
                      </p>
                    ))}
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <a className="secondary" href="/admin/mail">
        {t(
          "Mailserver im Adminbereich einrichten",
          "Configure the mail server in administration",
        )}
      </a>
    </div>
  );
}

export function AdminMail() {
  const { t } = useLanguage();
  const [mail, setMail] = useState<Mail | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    void api<Mail>("admin/mail")
      .then(setMail)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="customer-management">
      <section className="panel settings-panel">
        <h2>{t("Mailserver & Versand", "Mail server & delivery")}</h2>
        <p>
          {t(
            "SMTP für Einladungen, Passwort-Links und Vertragsbestätigungen. STARTTLS typischerweise auf Port 587, SMTPS auf 465.",
            "SMTP for invitations, password links and contract receipts. STARTTLS usually uses port 587, SMTPS port 465.",
          )}
        </p>
        <p>
          {t(
            "Öffentliche Plattform-URL, SPF, DKIM und DMARC beim Mailanbieter einrichten. Die Verbindungsprüfung sendet keine Nachricht.",
            "Configure the public platform URL, SPF, DKIM and DMARC with your mail provider. The connection check does not send a message.",
          )}
        </p>
      </section>
      {error && <p className="error-box">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {mail && (
        <details open className="panel settings-panel customer-mail">
          <summary>
            {t(
              "SMTP-Mailversand für Einladungen und Passwort-Links",
              "SMTP email for invitations and password links",
            )}{" "}
            ·{" "}
            {mail.configured
              ? t("eingerichtet", "configured")
              : t("nicht eingerichtet", "not configured")}
          </summary>
          <ActionForm
            title={t("Mailserver konfigurieren", "Configure mail server")}
            label={t("SMTP speichern", "Save SMTP")}
            submit={async (f) => {
              await api("admin/mail", {
                ...common(f),
                enabled: f.get("enabled") === "on",
                host: f.get("host"),
                port: Number(f.get("port")),
                mode: f.get("mode"),
                username: f.get("username"),
                password: f.get("smtpPassword") || undefined,
                from: f.get("from"),
              });
              setMail(await api<Mail>("admin/mail"));
              setNotice(
                t(
                  "SMTP-Konfiguration gespeichert.",
                  "SMTP configuration saved.",
                ),
              );
            }}
          >
            <label className="check-row">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={mail.enabled}
              />
              {t("Mailversand aktivieren", "Enable email delivery")}
            </label>
            <div className="form-grid">
              <Field title="SMTP-Host">
                <input name="host" defaultValue={mail.host} required />
              </Field>
              <Field title="Port">
                <input
                  name="port"
                  type="number"
                  min="1"
                  max="65535"
                  defaultValue={mail.port}
                  required
                />
              </Field>
              <Field title={t("Verschlüsselung", "Encryption")}>
                <select name="mode" defaultValue={mail.mode}>
                  <option value="starttls">STARTTLS</option>
                  <option value="tls">TLS / SMTPS</option>
                  {mail.localAllowed && (
                    <option value="local">
                      {t("Nur lokaler SMTP-Test", "Local SMTP test only")}
                    </option>
                  )}
                </select>
              </Field>
              <Field title={t("SMTP-Benutzer", "SMTP username")}>
                <input name="username" defaultValue={mail.username} />
              </Field>
              <Field
                title={t(
                  "SMTP-Passwort (leer = beibehalten)",
                  "SMTP password (empty = unchanged)",
                )}
              >
                <input
                  name="smtpPassword"
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
              <Field title={t("Absender-E-Mail", "Sender email")}>
                <input
                  name="from"
                  type="email"
                  defaultValue={mail.from}
                  required
                />
              </Field>
            </div>
            <p className="form-note">
              {t(
                "Mail-Links verwenden die konfigurierte öffentliche Plattformadresse. Der Versand wird von verbundenen KeRnCloud-Workern verarbeitet. SMTP-Zugangsdaten werden verschlüsselt gespeichert.",
                "Links use the configured public platform address. Connected KeRnCloud workers deliver queued messages. SMTP credentials are stored encrypted.",
              )}
            </p>
          </ActionForm>
          {mail.configured && (
            <ActionForm
              title={t("SMTP-Verbindung prüfen", "Verify SMTP connection")}
              label={t("Verbindung prüfen", "Check connection")}
              submit={async (f) => {
                await api("admin/mail", { action: "verify", ...common(f) });
                setNotice(
                  t(
                    "SMTP-Verbindung und Anmeldung bestätigt. Es wurde keine Testmail gesendet.",
                    "SMTP connection and authentication verified. No test email was sent.",
                  ),
                );
              }}
            />
          )}
        </details>
      )}
    </div>
  );
}
