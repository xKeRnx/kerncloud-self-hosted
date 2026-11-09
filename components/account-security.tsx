"use client";
import { useLanguage } from "./language";
import { useEffect, useState } from "react";
import { api } from "./api-client";
type Status = {
  enabled: boolean;
  password_enabled: boolean;
  recovery_codes: number;
  identities: { provider: string; email: string }[];
};
export function AccountSecurity() {
  const { ui, localeTag } = useLanguage();

  const [status, setStatus] = useState<Status | null>(null),
    [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [providers, setProviders] = useState<string[]>([]);
  const load = () => api<Status>("profile/security").then(setStatus);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    void api<{ providers: string[] }>("auth/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => {});
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function proof(form: HTMLFormElement) {
    const f = new FormData(form);
    return {
      password: String(f.get("password") ?? ""),
      code: String(f.get("code") ?? ""),
    };
  }
  const proofFields = (mfa = false) => (
    <div className="form-grid">
      {status?.password_enabled ? (
        <label className="field">
          <span>{ui("Aktuelles Passwort")}</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
      ) : (
        <p className="form-note">
          {ui(
            "Bei Anmeldung ausschließlich über einen Dienst ist eine erneute Anmeldung innerhalb der letzten zehn Minuten nötig.",
          )}
        </p>
      )}
      {mfa && (
        <label className="field">
          <span>{ui("Authenticator- oder Wiederherstellungscode")}</span>
          <input
            name="code"
            autoComplete="one-time-code"
            maxLength={80}
            required
          />
        </label>
      )}
    </div>
  );
  return (
    <>
      <section className="panel settings-panel account-security">
        <h2>{ui("Zwei-Faktor-Authentifizierung")}</h2>
        <p>
          {ui(
            "Schütze dein Konto mit einer Authenticator-App, z. B. Google Authenticator, Microsoft Authenticator oder 2FAS. Zusätzlich erhältst du zehn einmal verwendbare Wiederherstellungscodes.",
          )}
        </p>
        <span className={`security-status ${status?.enabled ? "enabled" : ""}`}>
          {status
            ? status.enabled
              ? ui("2FA aktiviert")
              : ui("2FA noch nicht aktiviert")
            : ui("Lädt …")}
        </span>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="form-note">
            {notice}
          </p>
        )}
        {status && !status.enabled && !setup && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const body = proof(e.currentTarget);
              void run(async () => {
                setSetup(await api("profile/security/setup", body));
                setCodes([]);
              });
            }}
          >
            {proofFields()}
            <button className="primary" disabled={busy}>
              {ui("Authenticator einrichten")}
            </button>
          </form>
        )}
        {setup && (
          <div className="mfa-enrollment">
            <img
              src={setup.qr}
              alt={ui("QR-Code für die Authenticator-Einrichtung")}
              width={240}
              height={240}
            />
            <div>
              <h3>{ui("QR-Code mit deiner Authenticator-App scannen")}</h3>
              <p>{ui("Alternativ diesen Schlüssel eintragen:")}</p>
              <code className="mfa-secret">{setup.secret}</code>
              <p>
                {ui(
                  "Einrichtung zehn Minuten gültig. Der Code wird lokal erzeugt.",
                )}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = proof(e.currentTarget);
                  void run(async () => {
                    const result = await api<{ recoveryCodes: string[] }>(
                      "profile/security/enable",
                      body,
                    );
                    setCodes(result.recoveryCodes);
                    setSetup(null);
                    await load();
                    setNotice(
                      ui(
                        "2FA ist aktiv. Andere Sitzungen wurden beendet. Wiederherstellungscodes jetzt sicher aufbewahren.",
                      ),
                    );
                  });
                }}
              >
                {proofFields(true)}
                <button className="primary" disabled={busy}>
                  {ui("2FA bestätigen und aktivieren")}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSetup(null)}
                >
                  {ui("Abbrechen")}
                </button>
              </form>
            </div>
          </div>
        )}
        {codes.length > 0 && (
          <div className="recovery-codes">
            <h3>{ui("Wiederherstellungscodes – jetzt sichern")}</h3>
            <p>
              {ui(
                "Diese Codes werden nur jetzt angezeigt. Jeder ersetzt einmal deinen Authenticator-Code. Bewahre sie getrennt von deinem Passwort auf.",
              )}
            </p>
            <pre>{codes.join("\n")}</pre>
            <button
              className="secondary"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob(
                    [
                      ui("KeRnCloud – Wiederherstellungscodes\n\n") +
                        codes.join("\n"),
                    ],
                    { type: "text/plain" },
                  ),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "kerncloud-recovery-codes.txt";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              {ui("Codes als Text herunterladen")}
            </button>
            <button className="text-button" onClick={() => setCodes([])}>
              {ui("Ich habe die Codes gesichert")}
            </button>
          </div>
        )}
        {status?.enabled && (
          <details>
            <summary>{ui("2FA deaktivieren")}</summary>
            <p>
              {ui("Noch ")}
              {status.recovery_codes}
              {ui(
                " Wiederherstellungscodes verfügbar. Ein bereits verwendeter Authenticator-Code wird erst mit dem nächsten 30-Sekunden-Code wieder akzeptiert.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const body = proof(e.currentTarget);
                void run(async () => {
                  await api("profile/security/disable", body);
                  setCodes([]);
                  await load();
                  setNotice(
                    ui("2FA deaktiviert; andere Sitzungen wurden beendet."),
                  );
                });
              }}
            >
              {proofFields(true)}
              <button className="secondary" disabled={busy}>
                {ui("2FA deaktivieren")}
              </button>
            </form>
          </details>
        )}
      </section>
      {status && (
        <section className="panel settings-panel">
          <h2>
            {status.password_enabled
              ? ui("Passwort ändern")
              : ui("Lokales Passwort ergänzen")}
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              if (f.get("new_password") !== f.get("repeat")) {
                setError(ui("Die neuen Passwörter stimmen nicht überein."));
                return;
              }
              void run(async () => {
                await api("profile/password", {
                  current: f.get("password") ?? "",
                  password: f.get("new_password"),
                  code: f.get("code") ?? "",
                });
                form.reset();
                await load();
                setNotice(
                  ui("Passwort gespeichert. Andere Sitzungen wurden beendet."),
                );
              });
            }}
          >
            {proofFields(status.enabled)}
            <div className="form-grid">
              <label className="field">
                <span>{ui("Neues Passwort")}</span>
                <input
                  type="password"
                  name="new_password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <label className="field">
                <span>{ui("Neues Passwort wiederholen")}</span>
                <input
                  type="password"
                  name="repeat"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
            </div>
            <button className="secondary" disabled={busy}>
              {ui("Passwort speichern")}
            </button>
          </form>
        </section>
      )}
      <section className="panel settings-panel">
        <h2>{ui("Verbundene Anmeldedienste")}</h2>
        <p>
          {ui(
            "Eine Verknüpfung ersetzt nur die Passwort-Eingabe bei der Anmeldung. Deine aktivierte 2FA bleibt erforderlich.",
          )}
        </p>
        {status?.identities.map((p) => (
          <div key={p.provider}>
            <strong>
              {p.provider === "google"
                ? "Google"
                : p.provider === "github"
                  ? "GitHub"
                  : "Microsoft"}
            </strong>{" "}
            · {p.email}
            {ui(" · verbunden")}
            <details>
              <summary>{ui("Verknüpfung entfernen")}</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const body = proof(event.currentTarget);
                  void run(async () => {
                    await api("profile/oauth/unlink", {
                      ...body,
                      provider: p.provider,
                    });
                    await load();
                    setNotice(
                      ui(
                        "Anmeldedienst getrennt. Andere Sitzungen wurden beendet.",
                      ),
                    );
                  });
                }}
              >
                {proofFields(status.enabled)}
                <button className="secondary" disabled={busy}>
                  {ui("Verknüpfung entfernen")}
                </button>
              </form>
            </details>
          </div>
        ))}
        {!providers.length && (
          <p className="muted">
            {ui(
              "Der Betreiber hat noch keinen externen Anmeldedienst freigeschaltet.",
            )}
          </p>
        )}
        {providers.map((provider) => (
          <details key={provider}>
            <summary>
              {provider === "google"
                ? "Google"
                : provider === "github"
                  ? "GitHub"
                  : "Microsoft"}{" "}
              {ui("verbinden / erneut anmelden")}
            </summary>
            {status?.identities.some((i) => i.provider === provider) ? (
              <a
                className="secondary"
                href={`/api/auth/oauth/${provider}/start`}
              >
                {ui("Erneut über ")}
                {provider}
                {ui(" anmelden")}
              </a>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = proof(e.currentTarget);
                  void run(async () => {
                    const { url } = await api<{ url: string }>(
                      `auth/oauth/${provider}/link`,
                      body,
                    );
                    window.location.assign(url);
                  });
                }}
              >
                {proofFields(Boolean(status?.enabled))}
                <button className="secondary" disabled={busy}>
                  {ui("Verknüpfung bestätigen")}
                </button>
              </form>
            )}
          </details>
        ))}
      </section>
    </>
  );
}
