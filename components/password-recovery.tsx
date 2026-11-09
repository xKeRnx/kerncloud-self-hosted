"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLanguage } from "./language";
import { api } from "./api-client";
export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const { t } = useLanguage();
  const [token, setToken] = useState(""),
    [invitation, setInvitation] = useState(false),
    [valid, setValid] = useState(!reset),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (!reset || initialized.current) return;
    initialized.current = true;
    const value = window.location.hash.slice(1);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    setToken(value);
    if (!/^[a-f0-9]{64}$/.test(value)) {
      setError(
        t(
          "Bitte einen gültigen Passwort-Link anfordern.",
          "Please request a valid password link.",
        ),
      );
      return;
    }
    void api<any>("auth/password-reset/check", { token: value })
      .then((r) => {
        setValid(true);
        setInvitation(r.invitation);
      })
      .catch((e) => setError(e.message));
  }, [reset, t]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (reset) {
        if (f.get("password") !== f.get("confirm"))
          throw Error(
            t(
              "Die Passwörter stimmen nicht überein.",
              "Passwords do not match.",
            ),
          );
        await api("auth/password-reset", {
          token,
          password: f.get("password"),
          privacyAccepted: f.get("privacy") === "on",
        });
        setToken("");
        setDone(true);
        setMessage(
          t(
            "Passwort gespeichert. Bitte anmelden; eine bestehende 2FA bleibt erforderlich.",
            "Password saved. Sign in; existing 2FA is still required.",
          ),
        );
      } else {
        await api("auth/password-forgot", { email: f.get("email") });
        setMessage(
          t(
            "Falls ein passendes Konto besteht, wurde eine E-Mail angefordert.",
            "If a matching account exists, an email has been requested.",
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="password-recovery">
      <a href="/">← KeRnCloud</a>
      <section className="panel settings-panel">
        <h1>
          {reset
            ? invitation
              ? t("Einladung annehmen", "Accept invitation")
              : t("Neues Passwort festlegen", "Set a new password")
            : t("Passwort vergessen?", "Forgot your password?")}
        </h1>
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {!done && valid && (
          <form onSubmit={submit}>
            {reset ? (
              <>
                <label className="field">
                  <span>
                    {t(
                      "Neues Passwort · mindestens 12 Zeichen",
                      "New password · at least 12 characters",
                    )}
                  </span>
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label className="field">
                  <span>{t("Passwort wiederholen", "Repeat password")}</span>
                  <input
                    name="confirm"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                {invitation && (
                  <label className="check-row">
                    <input type="checkbox" name="privacy" required />
                    {t(
                      "Ich bestätige die Datenschutzhinweise.",
                      "I accept the privacy notice.",
                    )}{" "}
                    <a
                      href="/legal/datenschutz"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("Lesen", "Read")}
                    </a>
                  </label>
                )}
              </>
            ) : (
              <label className="field">
                <span>E-Mail</span>
                <input
                  name="email"
                  type="email"
                  maxLength={254}
                  required
                  autoComplete="email"
                />
              </label>
            )}
            <button className="primary" disabled={busy}>
              {reset
                ? t("Passwort speichern", "Save password")
                : t("Link anfordern", "Request link")}
            </button>
          </form>
        )}
        <a href="/login">{t("Zur Anmeldung", "Back to sign-in")}</a>
      </section>
    </main>
  );
}
export function RequiredPasswordChange({ done }: { done: () => void }) {
  const { t } = useLanguage();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="password-recovery">
      <section className="panel settings-panel">
        <h1>
          {t("Bitte dein Passwort ändern", "Please change your password")}
        </h1>
        <p>
          {t(
            "Für dein Konto wurde ein vorläufiges Passwort gesetzt. Lege zuerst ein eigenes Passwort fest.",
            "A temporary password was set for your account. Set your own password before continuing.",
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              if (f.get("password") !== f.get("confirm"))
                throw Error(
                  t(
                    "Die Passwörter stimmen nicht überein.",
                    "Passwords do not match.",
                  ),
                );
              await api("profile/password", {
                current: f.get("current"),
                password: f.get("password"),
                code: f.get("code"),
              });
              done();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {[
            ["current", t("Vorläufiges Passwort", "Temporary password")],
            ["password", t("Neues Passwort", "New password")],
            ["confirm", t("Neues Passwort wiederholen", "Repeat new password")],
          ].map(([name, label]) => (
            <label className="field" key={name}>
              <span>{label}</span>
              <input
                name={name}
                type="password"
                minLength={12}
                maxLength={128}
                required
                autoComplete={
                  name === "current" ? "current-password" : "new-password"
                }
              />
            </label>
          ))}
          <label className="field">
            <span>
              {t("2FA-Code, falls aktiviert", "2FA code, if enabled")}
            </span>
            <input name="code" autoComplete="one-time-code" maxLength={80} />
          </label>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {t("Passwort ändern", "Change password")}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void api("auth/logout", {})
                .then(() => window.location.assign("/login"))
                .catch((e) => setError(e.message))
            }
          >
            {t("Abmelden", "Sign out")}
          </button>
        </form>
      </section>
    </main>
  );
}
