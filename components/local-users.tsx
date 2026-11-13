"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  ShieldCheck,
  UserPlus,
  Users,
  LogOut,
  UserRoundCog,
  Pause,
  Play,
} from "lucide-react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function LocalUsers() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const load = () =>
    api<any>("admin/customers", undefined, "GET", { projectScope: false }).then(
      setData,
    );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function action(path: string, body: any) {
    setBusy(true);
    setError("");
    setLink("");
    try {
      const result: any = await api(
        path,
        {
          ...body,
          reason: "Local installation user administration",
          proof: { password, code },
        },
        "POST",
        { projectScope: false },
      );
      setPassword("");
      setCode("");
      if (result.url) setLink(result.url);
      if (result.link) setLink(result.link);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void action("admin/customers", {
      name: f.get("name"),
      email: f.get("email"),
      send: false,
    });
  }
  return (
    <section className="settings-hub local-users">
      <header className="workspace-page-heading">
        <div>
          <span className="scope-label">
            {t("LOKALE VERWALTUNG", "LOCAL ADMINISTRATION")}
          </span>
          <h1>{t("Benutzer & Zugriff", "Users & access")}</h1>
          <p>
            {t(
              "Nur Administratoren können lokale Konten und Zugriffe verwalten. Öffentliche Registrierung ist standardmäßig aus.",
              "Only administrators can manage local accounts and access. Public signup is disabled by default.",
            )}
          </p>
        </div>
      </header>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className="info-box local-invitation-link">
          <label className="field">
            <span>
              {t("Einmaliger Einladungslink", "One-time invitation link")}
            </span>
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
        </div>
      )}
      <div className="local-user-setup">
        <section
          className="panel local-user-card"
          aria-labelledby="local-admin-confirmation"
        >
          <div className="local-user-card-title">
            <span className="local-user-card-icon">
              <ShieldCheck size={21} aria-hidden="true" />
            </span>
            <h2 id="local-admin-confirmation">
              {t("Administrator bestätigen", "Confirm administrator")}
            </h2>
          </div>
          <p>
            {t(
              "Für Änderungen ist eine erneute Bestätigung mit Passwort oder MFA-Code nötig.",
              "Changes require your administrator password or MFA code again.",
            )}
          </p>
          <div className="form-grid">
            <label className="field">
              <span>{t("Dein Passwort", "Your password")}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field">
              <span>
                {t("MFA-Code, falls aktiviert", "MFA code, if enabled")}
              </span>
              <input
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          </div>
        </section>
        <form
          className="panel local-user-card"
          onSubmit={invite}
          aria-labelledby="local-user-invitation"
        >
          <div className="local-user-card-title">
            <span className="local-user-card-icon">
              <UserPlus size={21} aria-hidden="true" />
            </span>
            <h2 id="local-user-invitation">
              {t("Benutzer einladen", "Invite user")}
            </h2>
          </div>
          <p>
            {t(
              "Erstelle einen persönlichen Link für ein neues Konto in deiner Installation.",
              "Create a personal invitation link for a new account in your installation.",
            )}
          </p>
          <div className="form-grid">
            <label className="field">
              <span>{t("Name", "Name")}</span>
              <input name="name" required maxLength={80} />
            </label>
            <label className="field">
              <span>{t("E-Mail-Adresse", "Email address")}</span>
              <input name="email" type="email" required maxLength={254} />
            </label>
          </div>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy}>
              <UserPlus size={16} aria-hidden="true" />
              {t("Einladungslink erstellen", "Create invitation link")}
            </button>
          </div>
          <p className="local-user-hint">
            {t(
              "Der Benutzer setzt sein Passwort selbst. Workspace-Rollen werden unter Mitglieder & Rollen vergeben.",
              "The user sets their own password. Assign workspace roles under Members & roles.",
            )}
          </p>
        </form>
      </div>
      <section
        className="panel local-accounts"
        aria-labelledby="local-accounts-heading"
      >
        <div className="local-user-card-title local-accounts-title">
          <span className="local-user-card-icon">
            <Users size={21} aria-hidden="true" />
          </span>
          <h2 id="local-accounts-heading">
            {t("Lokale Konten", "Local accounts")}
          </h2>
          {data && (
            <span className="local-account-count">
              {data.users?.length ?? 0}
            </span>
          )}
        </div>
        {!data && (
          <p className="local-accounts-empty" role="status">
            {t("Konten werden geladen …", "Loading accounts …")}
          </p>
        )}
        {data && !data.users?.length && (
          <p className="local-accounts-empty">
            {t("Noch keine Konten vorhanden.", "No accounts yet.")}
          </p>
        )}
        {data?.users?.map((u: any) => (
          <article className="local-account-row" key={u.id}>
            <div className="local-account-person">
              <span className="local-account-avatar" aria-hidden="true">
                {u.name?.slice(0, 1).toUpperCase() || "?"}
              </span>
              <div>
                <strong>{u.name}</strong>
                <p>{u.email}</p>
                <div className="local-account-badges">
                  <span>
                    {u.role === "admin"
                      ? t("Administrator", "Administrator")
                      : t("Benutzer", "User")}
                  </span>
                  <span
                    className={
                      "local-account-state " +
                      (u.suspended
                        ? "is-suspended"
                        : u.invitation_pending
                          ? "is-pending"
                          : "is-active")
                    }
                  >
                    {u.suspended
                      ? t("Gesperrt", "Suspended")
                      : u.invitation_pending
                        ? t("Eingeladen", "Invited")
                        : t("Aktiv", "Active")}
                  </span>
                </div>
              </div>
            </div>
            <div
              className="button-row local-account-actions"
              role="group"
              aria-label={t("Aktionen für ", "Actions for ") + u.name}
            >
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action("admin/customers/" + u.id, {
                    action: "suspend",
                    suspended: !u.suspended,
                  })
                }
              >
                {u.suspended ? (
                  <Play size={15} aria-hidden="true" />
                ) : (
                  <Pause size={15} aria-hidden="true" />
                )}
                {u.suspended
                  ? t("Entsperren", "Unsuspend")
                  : t("Sperren", "Suspend")}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action("admin/customers/" + u.id, { action: "revoke" })
                }
              >
                <LogOut size={15} aria-hidden="true" />
                {t("Sitzungen beenden", "Revoke sessions")}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action("admin/customers/" + u.id, {
                    action: "role",
                    role: u.role === "admin" ? "user" : "admin",
                  })
                }
              >
                <UserRoundCog size={15} aria-hidden="true" />
                {u.role === "admin"
                  ? t("Zum Benutzer machen", "Make user")
                  : t("Zum Admin machen", "Make admin")}
              </button>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
