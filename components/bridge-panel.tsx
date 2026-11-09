"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import { BridgeDownloads } from "./bridge-downloads";
const capabilities = [
  ["files.read", "Dateien lesen", "Read files"],
  ["files.write", "Dateien schreiben", "Write files"],
  ["browser", "Separater Browser", "Isolated browser"],
  ["network.http", "Netzwerk / HTTP", "Network / HTTP"],
  ["program.run", "Feste Programme", "Fixed programs"],
  [
    "desktop",
    "Desktop mit lokaler Bestätigung",
    "Desktop with local confirmation",
  ],
];
export function BridgePanel() {
  const { t, date } = useLanguage();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [secret, setSecret] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("bridge", undefined, "GET", { projectScope: false }).then(setData);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, []);
  async function act(b: any) {
    setError("");
    setNotice("");
    setSecret("");
    setBusy(true);
    try {
      const r: any = await api("bridge", b, "POST", { projectScope: false });
      if (r.token) setSecret(r.token);
      setNotice(
        t(
          "Gespeichert. Geänderte Freigaben beenden ausstehende Aktionen; neue lokale Rechte müssen am Gerät erteilt werden.",
          "Saved. Grant changes end pending actions; new local permissions must be granted on the device.",
        ),
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const form = (row: any = null) => (
    <form
      className="form-grid bridge-token-form"
      key={row?.id ?? "new"}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void act({
          action: row ? "edit" : "create",
          ...(row ? { id: row.id } : {}),
          name: f.get("name"),
          expires_at: new Date(String(f.get("expiry"))).toISOString(),
          scope: {
            project_ids: f.getAll("project"),
            agent_ids: f.getAll("agent"),
            capabilities: f.getAll("capability"),
          },
        });
      }}
    >
      <label className="field">
        <span>{t("Name des Tokens / Geräts", "Token / device name")}</span>
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={row?.name ?? ""}
        />
      </label>
      <label className="field">
        <span>{t("Gültig bis", "Expires at")}</span>
        <input
          type="datetime-local"
          name="expiry"
          required
          defaultValue={new Date(
            new Date(row?.expires_at ?? Date.now() + 30 * 86400000).getTime() -
              new Date().getTimezoneOffset() * 60000,
          )
            .toISOString()
            .slice(0, 16)}
        />
      </label>
      <fieldset>
        <legend>
          {t(
            "Projekte (keine Auswahl = kein Zugriff)",
            "Projects (none selected = no access)",
          )}
        </legend>
        {data.projects.map((p: any) => (
          <label key={p.id}>
            <input
              type="checkbox"
              name="project"
              value={p.id}
              defaultChecked={row?.scope.project_ids.includes(p.id) ?? false}
            />{" "}
            {p.name}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("Agenten", "Agents")}</legend>
        {data.agents.map((p: any) => (
          <label key={p.id}>
            <input
              type="checkbox"
              name="agent"
              value={p.id}
              defaultChecked={row?.scope.agent_ids.includes(p.id) ?? false}
            />{" "}
            {p.name}
          </label>
        ))}
      </fieldset>
      <fieldset className="span-2">
        <legend>
          {t("Maximal erlaubte Fähigkeiten", "Maximum permitted capabilities")}
        </legend>
        {capabilities.map(([key, de, en]) => (
          <label key={key}>
            <input
              type="checkbox"
              name="capability"
              value={key}
              defaultChecked={row?.scope.capabilities.includes(key) ?? false}
            />{" "}
            {t(de, en)}
          </label>
        ))}
      </fieldset>
      <div className="form-actions span-2">
        <button
          type="submit"
          className="primary"
          disabled={busy || !data.eligible}
        >
          {row
            ? t("Änderungen speichern", "Save changes")
            : t("Verbindungsschlüssel erstellen", "Create enrollment key")}
        </button>
        {row && (
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing(null)}
          >
            {t("Abbrechen", "Cancel")}
          </button>
        )}
      </div>
    </form>
  );
  return (
    <div className="bridge-page">
      <header className="workspace-page-heading">
        <div>
          <p className="section-kicker">KERNCloud BRIDGE</p>
          <h1>
            {t(
              "Deine Geräte. Deine Zugriffsgrenzen.",
              "Your devices. Your access boundaries.",
            )}
          </h1>
          <p>
            {t(
              "Verbinde lokale Dateien, einen separaten Browser und freigegebene Netzwerkziele mit deinen Projekten.",
              "Connect local files, an isolated browser and approved network targets to your projects.",
            )}
          </p>
        </div>
      </header>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}
      {secret && (
        <section className="panel settings-panel">
          <h2>{t("Schlüssel jetzt sichern", "Save this key now")}</h2>
          <p>
            {t(
              "Nur einmal sichtbar. Direkt in der Bridge-App eingeben. Ein Gerät je Schlüssel; erneutes Erstellen trennt das bisherige Gerät.",
              "Shown once. Enter directly in the Bridge app. One device per key; rotating disconnects the previous device.",
            )}
          </p>
          <textarea
            readOnly
            aria-label={t(
              "Einmaliger Verbindungsschlüssel",
              "One-time enrollment key",
            )}
            value={secret}
          />
          <button className="secondary" onClick={() => setSecret("")}>
            {t("Schlüssel ausblenden", "Hide key")}
          </button>
        </section>
      )}
      <section className="panel settings-panel">
        <h2>{t("In drei Schritten verbinden", "Connect in three steps")}</h2>
        <ol>
          <li>
            {t(
              "Passendes Installationspaket herunterladen und installieren.",
              "Download and install the package for your system.",
            )}
          </li>
          <li>
            {t(
              "Hier einen Schlüssel mit Projekten, Agenten und Ablauf erstellen.",
              "Create a key here with projects, agents and expiry.",
            )}
          </li>
          <li>
            {t(
              "In der App Gerätename und Verbindungsschlüssel eingeben, lokale Ordner/Ziele freigeben und fortsetzen. Die KeRnCloud-Adresse ist bereits hinterlegt. Neue Versionen prüft und lädt die installierte Bridge anschließend automatisch.",
              "Enter the device name and enrollment key in the app, grant local folders/targets and resume. The KeRnCloud address is already configured. Installed Bridge then checks for and downloads new versions automatically.",
            )}
          </li>
        </ol>
        <BridgeDownloads />
      </section>
      {data && (
        <>
          <section className="panel settings-panel">
            <h2>
              {t("Verbindungsschlüssel & Geräte", "Enrollment keys & devices")}
            </h2>
            <p>
              {t(
                "Dein kontoweites Gerätelimit (gemeinsam mit Docker-Connectors):",
                "Your account-wide device limit (shared with Docker connectors):",
              )}{" "}
              {data.limit}
            </p>
            {!data.eligible ? (
              <p className="form-note">
                {t(
                  "Ein aktives Abo mit Kunden-Connector-Plätzen ist erforderlich.",
                  "An active plan with customer connector slots is required.",
                )}
              </p>
            ) : (
              <details>
                <summary>
                  {t("Neuen Schlüssel erstellen", "Create a new key")}
                </summary>
                {form()}
              </details>
            )}
            {data.tokens.length === 0 && (
              <p>
                {t("Noch kein Gerät verbunden.", "No device connected yet.")}
              </p>
            )}
            {data.tokens.map((r: any) => (
              <article className="bridge-device" key={r.id}>
                <div className="bridge-device-heading">
                  <div>
                    <h3>{r.name}</h3>
                    <p>
                      {r.revoked_at
                        ? t("Widerrufen", "Revoked")
                        : new Date(r.expires_at) < new Date()
                          ? t("Abgelaufen", "Expired")
                          : !r.device_id
                            ? t("Wartet auf Einrichtung", "Awaiting setup")
                            : !r.enabled
                              ? t("Webzugang pausiert", "Cloud access paused")
                              : r.local_paused
                                ? t("Lokal pausiert", "Locally paused")
                                : r.last_seen &&
                                    Date.now() - Date.parse(r.last_seen) < 20000
                                  ? t("Online", "Online")
                                  : t("Offline", "Offline")}{" "}
                      {r.platform && " · " + r.platform}
                    </p>
                  </div>
                  <span>
                    {t("Ablauf:", "Expiry:")} {date(r.expires_at)}
                  </span>
                </div>
                <p>
                  {r.scope.project_ids.length} {t("Projekte", "projects")} ·{" "}
                  {r.scope.agent_ids.length} {t("Agenten", "agents")} ·{" "}
                  {r.scope.capabilities.join(", ") ||
                    t("Keine Fähigkeiten", "No capabilities")}
                </p>
                {r.device_id && (
                  <p className="form-note">
                    {t("Lokal gemeldet:", "Locally reported:")}{" "}
                    {r.local_policy?.roots
                      ?.map((p: any) => p.alias + (p.write ? " (RW)" : " (R)"))
                      .join(", ") || "—"}{" "}
                    · {r.local_policy?.targets?.join(", ") || "—"} ·{" "}
                    {t("Zuletzt gesehen:", "Last seen:")}{" "}
                    {r.last_seen ? date(r.last_seen) : "—"}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditing(editing?.id === r.id ? null : r)}
                  >
                    {t("Bearbeiten", "Edit")}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            "Alten Geräteschlüssel sofort sperren und einen neuen Verbindungsschlüssel erstellen?",
                            "Immediately invalidate the old device key and issue a new enrollment key?",
                          ),
                        )
                      )
                        void act({ action: "rotate", id: r.id });
                    }}
                  >
                    {t("Neu erstellen", "Rotate")}
                  </button>
                  {r.device_id && !r.revoked_at && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          action: r.enabled ? "pause" : "resume",
                          id: r.id,
                        })
                      }
                    >
                      {r.enabled
                        ? t("Webzugang pausieren", "Pause cloud access")
                        : t("Webzugang fortsetzen", "Resume cloud access")}
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void act({ action: "revoke", id: r.id })}
                  >
                    {t("Widerrufen", "Revoke")}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            "Token aus der Liste entfernen und Gerät trennen? Das Aktionsprotokoll bleibt erhalten.",
                            "Remove this token from the list and disconnect the device? Action history is retained.",
                          ),
                        )
                      )
                        void act({ action: "delete", id: r.id });
                    }}
                  >
                    {t("Löschen", "Delete")}
                  </button>
                </div>
                {editing?.id === r.id && form(r)}
              </article>
            ))}
          </section>
          <section className="panel settings-panel">
            <h2>{t("Letzte Geräteaktionen", "Recent device actions")}</h2>
            <p>
              {t(
                "Keine versteckte Desktop-Sitzung: Jeder Aufruf gehört zu einem Projekt, Agenten und Auftrag. Parameter und Ergebnisse stehen beim Auftrag; hier wird nur der Status angezeigt.",
                "Every action belongs to a project, agent and task. Parameters and results are in the task; this view shows status only.",
              )}
            </p>
            {data.jobs.map((j: any) => (
              <p key={j.id}>
                <a href={"/agents/" + j.agent_id + "?task=" + j.task_id}>
                  {data.agents.find((a: any) => a.id === j.agent_id)?.name ??
                    j.agent_id}
                </a>{" "}
                · {j.action} · {j.status} · {date(j.created_at)}{" "}
                {j.status === "uncertain" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      const note = prompt(
                        t(
                          "Lokalen Zustand zuerst prüfen. Was wurde tatsächlich ausgeführt? Diese Bestätigung führt nichts erneut aus.",
                          "Check local state first. What actually happened? This confirmation does not execute the action again.",
                        ),
                      );
                      if (note && note.trim().length >= 10)
                        void act({
                          action: "review",
                          job_id: j.id,
                          note: note.trim(),
                        });
                    }}
                  >
                    {t("Zustand geprüft", "State reviewed")}
                  </button>
                )}
              </p>
            ))}
            {!data.jobs.length && (
              <p>{t("Noch keine Aktionen.", "No actions yet.")}</p>
            )}
          </section>
        </>
      )}
      <aside className="form-note">
        {t(
          "Lokale Ausführung bedeutet nicht vollständig lokale KI: Gelesene Inhalte und Ergebnisse können an KeRnCloud und das gewählte Modell gehen. Neue lokale Rechte sind nur am Gerät freigebbar. Betreiber-Support erhält darüber keinen automatischen Gerätezugriff.",
          "Local execution does not mean fully local AI: read content and results may reach KeRnCloud and the selected model. New local permissions can only be granted on the device. Operator support receives no automatic device access.",
        )}
      </aside>
    </div>
  );
}
