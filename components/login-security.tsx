"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function MfaLogin({
  done,
  cancel,
}: {
  done: () => void;
  cancel: () => void;
}) {
  const { ui, localeTag } = useLanguage();

  const { t } = useLanguage(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="mfa-login">
      <h2>{t("Zweiten Faktor bestätigen", "Verify your second factor")}</h2>
      <p>
        {t(
          "Gib deinen Authenticator-Code oder einen Wiederherstellungscode ein. Jeder Code kann nur einmal verwendet werden.",
          "Enter an authenticator code or a recovery code. Each code can only be used once.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await api("auth/mfa", { code: f.get("code") });
            done();
          } catch (e) {
            setError(
              t(
                (e as Error).message,
                "Invalid or expired code. Wait for the next authenticator code or use a recovery code.",
              ),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{t("Sicherheitscode", "Security code")}</span>
          <input
            name="code"
            autoComplete="one-time-code"
            autoFocus
            required
            minLength={6}
            maxLength={80}
          />
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {t("Anmeldung bestätigen", "Verify and sign in")}
        </button>
      </form>
      <button className="text-button" onClick={cancel}>
        {t("Zurück zur Anmeldung", "Back to sign in")}
      </button>
    </div>
  );
}
export function SocialLogin({ signup }: { signup: boolean }) {
  const { ui, localeTag } = useLanguage();

  const { t } = useLanguage(),
    [providers, setProviders] = useState<string[]>([]),
    [privacy, setPrivacy] = useState(false);
  useEffect(() => {
    void api<{ providers: string[] }>("auth/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => {});
  }, []);
  if (!providers.length) return null;
  return (
    <div className="social-logins">
      <span>
        {t("Oder mit einem Anmeldedienst", "Or use a connected service")}
      </span>
      {signup && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={privacy}
            onChange={(e) => setPrivacy(e.target.checked)}
          />
          {t(
            "Ich habe die Datenschutzhinweise gelesen.",
            "I have read the privacy notice.",
          )}
        </label>
      )}
      {providers.map((p) => (
        <a
          key={p}
          className={`secondary full ${signup && !privacy ? "disabled-link" : ""}`}
          aria-disabled={signup && !privacy}
          href={
            signup && !privacy
              ? undefined
              : `/api/auth/oauth/${p}/start?intent=${signup ? "signup&privacy=1" : "login"}`
          }
          onClick={(e) => {
            if (signup && !privacy) e.preventDefault();
          }}
        >
          {t("Mit", "Continue with")}{" "}
          {p === "google" ? "Google" : p === "github" ? "GitHub" : "Microsoft"}
        </a>
      ))}
    </div>
  );
}
export function AdminLoginProviders() {
  const { ui, localeTag } = useLanguage();

  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = () => api("admin/security").then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  if (!data) return <p>{error || ui("Anmeldedienste werden geladen …")}</p>;
  return (
    <section className="panel settings-panel">
      <h2>{ui("Anmeldung & externe Dienste")}</h2>
      <p>
        {ui(
          "Authenticator-2FA ist im Profil jedes Kontos verfügbar. Hier richtest du Google, GitHub und Microsoft für Anmeldung und Registrierung ein. Eine vorhandene E-Mail-Adresse wird niemals automatisch mit einer fremden Dienst-Identität verknüpft.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await api("admin/security", {
              publicUrl: f.get("publicUrl"),
              providers: Object.fromEntries(
                ["google", "github", "microsoft"].map((p) => [
                  p,
                  {
                    enabled: f.get(`${p}_enabled`) === "on",
                    clientId: f.get(`${p}_id`),
                    secret: f.get(`${p}_secret`) || undefined,
                  },
                ]),
              ),
            });
            await load();
            setNotice(ui("Anmeldedienste gespeichert."));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{ui("Öffentliche Plattform-URL")}</span>
          <input
            type="url"
            name="publicUrl"
            required
            defaultValue={data.publicUrl}
          />
        </label>
        {["google", "github", "microsoft"].map((p) => (
          <fieldset className="oauth-provider" key={p}>
            <legend>
              {p === "google"
                ? "Google"
                : p === "github"
                  ? "GitHub"
                  : "Microsoft"}
            </legend>
            <label className="check-row">
              <input
                type="checkbox"
                name={`${p}_enabled`}
                defaultChecked={data.providers[p].enabled}
              />
              {ui("Anmeldung freischalten")}
            </label>
            <div className="form-grid">
              <label className="field">
                <span>{ui("Client-ID")}</span>
                <input
                  name={`${p}_id`}
                  defaultValue={data.providers[p].clientId}
                  maxLength={500}
                />
              </label>
              <label className="field">
                <span>{ui("Client-Secret")}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  name={`${p}_secret`}
                  placeholder={
                    data.providers[p].configured
                      ? ui("Gespeichert – leer lassen zum Beibehalten")
                      : ui("Client-Secret eintragen")
                  }
                />
              </label>
            </div>
            <p className="form-note">
              {ui("Callback im Dienst hinterlegen:")}{" "}
              <code>{data.providers[p].callback}</code>
            </p>
            <a
              target="_blank"
              rel="noreferrer"
              href={
                p === "google"
                  ? "https://console.cloud.google.com/auth/clients"
                  : p === "github"
                    ? "https://github.com/settings/developers"
                    : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
              }
            >
              {ui("Anwendung bei ")}
              {p}
              {ui(" einrichten ↗")}
            </a>
          </fieldset>
        ))}
        <p className="muted">
          {ui(
            "Secrets werden verschlüsselt gespeichert. Dienst-Tokens werden für die Identitätsprüfung genutzt und nicht als GitHub- oder KI-Zugang übernommen. Vor Freischaltung tatsächliche Callback-Adresse, Consent-Screen und Datenschutzhinweise einrichten.",
          )}
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <button className="primary" disabled={busy}>
          {ui("Anmeldedienste speichern")}
        </button>
      </form>
    </section>
  );
}
