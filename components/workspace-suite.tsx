"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { IntegrationGallery } from "./integration-gallery";
import { useLanguage } from "./language";
function useResource(path: string, workspaceId: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => setData(await api(path));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [path, workspaceId]);
  const act = async (p: string, b: unknown) => {
    setBusy(true);
    setError("");
    try {
      const r = await api(p, b);
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { data, error, busy, act, load };
}
export function WorkAppsPanel({
  workspaceId,
  isAdmin,
}: {
  workspaceId: string;
  isAdmin: boolean;
}) {
  return <IntegrationGallery workspaceId={workspaceId} isAdmin={isAdmin} />;
}
export function ProjectsPanel({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: string;
}) {
  const { t } = useLanguage(),
    { data, error, busy, act } = useResource("suite/projects", workspaceId),
    manage = ["owner", "admin"].includes(role);
  return (
    <section className="panel settings-panel">
      <h1>{t("Entwicklungsprojekte", "Development projects")}</h1>
      <p>
        {t(
          "Verbinde ein GitHub-Repository mit einer gebuchten Entwicklungsumgebung. Agenten können Arbeitsbranch, Tests, Diff und lokale Commits bearbeiten. Ein Draft-Pull-Request wird über das freigegebene GitHub-Arbeitskonto veröffentlicht.",
          "Connect a GitHub repository to a booked development environment. Agents can manage a working branch, tests, diffs and local commits. A draft pull request is published through an approved GitHub work account.",
        )}
      </p>
      <div className="form-note">
        {t(
          "Öffentliche Repositories werden ohne Zugangsschlüssel geklont. Private Repositories brauchen eine vom Kunden im Container eingerichtete Git-Anmeldung. OAuth-Schlüssel bleiben außerhalb des Containers. Vorschau startet keinen Server: Der Agent muss die App erst auf dem eingestellten Port starten.",
          "Public repositories clone without credentials. Private repositories require customer-configured Git authentication in the container. OAuth credentials remain outside the container. Preview does not start a server: the agent must first start the app on the configured port.",
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {manage && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await act("suite/projects", {
              action: "create",
              name: f.get("name"),
              repo_url: f.get("repo"),
              branch: f.get("branch"),
              environment_id: f.get("environment"),
              preview_port: f.get("port") ? Number(f.get("port")) : null,
            });
          }}
        >
          <div className="form-grid">
            {[
              ["name", t("Projektname", "Project name"), ""],
              ["repo", "GitHub URL", "https://github.com/owner/repo"],
              [
                "branch",
                t("Arbeitsbranch", "Working branch"),
                "kerncloud/work",
              ],
            ].map(([name, label, value]) => (
              <label className="field" key={name}>
                <span>{label}</span>
                <input name={name} required defaultValue={value} />
              </label>
            ))}
            <label className="field">
              <span>
                {t("Entwicklungsumgebung", "Development environment")}
              </span>
              <select name="environment" required defaultValue="">
                <option value="" disabled>
                  {t("Umgebung auswählen", "Choose environment")}
                </option>
                {data?.environments.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("App-Port für Vorschau", "App preview port")}</span>
              <input
                name="port"
                type="number"
                min={1024}
                max={65535}
                placeholder="3000"
              />
            </label>
          </div>
          <button
            className="primary"
            disabled={busy || !data?.environments.length}
          >
            {t("Projekt anlegen", "Create project")}
          </button>
        </form>
      )}
      {data && !data.environments.length && (
        <p className="form-note">
          {t(
            "Noch keine Entwicklungsumgebung vorhanden. Buche zuerst eine Umgebung, bevor du ein Projekt zuordnest.",
            "No development environment yet. Book an environment before linking a project.",
          )}{" "}
          <a href="/environments">
            {t("Zu den Umgebungen", "Open environments")}
          </a>
        </p>
      )}
      {data?.items.map((p: any) => (
        <article className="form-note" key={p.id}>
          <h2>{p.name}</h2>
          <p>
            {p.repo_url} · {p.branch}
          </p>
          <p>
            {p.environment_name} · {p.environment_status}
          </p>
          <p>
            {t("Projekt-ID für den Agenten", "Project ID for the agent")}:{" "}
            <code>{p.id}</code>
          </p>
          <p>
            {t(
              "Im Teamchat beauftragen: Projekt klonen, Änderungen umsetzen, Tests ausführen, Diff prüfen und einen Draft-PR mit Freigabe erstellen.",
              "Ask in team chat: clone the project, implement changes, run tests, inspect the diff, then create a draft PR with approval.",
            )}
          </p>
          <div className="button-row">
            {p.preview_port && role === "owner" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  const r = await act("suite/projects/preview", { id: p.id });
                  if (r?.url)
                    window.open(r.url, "_blank", "noopener,noreferrer");
                }}
              >
                {t("Laufende App öffnen", "Open running app")} ·{" "}
                {p.preview_port}
              </button>
            )}
            {manage && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act("suite/projects", { id: p.id, action: "delete" })
                }
              >
                {t("Verknüpfung entfernen", "Remove link")}
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
export function QualityPanel({
  workspaceId,
  agents,
  models,
  role,
}: {
  workspaceId: string;
  agents: { id: string; name: string }[];
  models: { id: string; name: string; active: boolean }[];
  role: string;
}) {
  const { t } = useLanguage(),
    { data, error, busy, act, load } = useResource(
      "suite/quality",
      workspaceId,
    );
  useEffect(() => {
    const timer = setInterval(() => void load().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [workspaceId]);
  return (
    <section className="panel settings-panel">
      <h1>{t("KI-Testlabor", "AI test lab")}</h1>
      <p>
        {t(
          "Zwei echte, nacheinander ausgeführte Testaufträge: Website liefern und einen Fehler selbst beheben. Feste Erwartungen werden unabhängig vom Agenten im Browser geprüft. Keine Erfolgsmeldung allein aufgrund des Agententextes.",
          "Two real sequential test tasks: deliver a website and fix a defect autonomously. Fixed expectations are checked independently in a browser. Agent text alone never counts as success.",
        )}
      </p>
      <div className="form-note">
        {t(
          "Das Gesamtlimit wird fest auf beide Fälle aufgeteilt. Wiederholungen, Kontext und Reparaturen zählen dazu. Unbekannter Verbrauch zählt nicht als bestandener Test. Diese Tests verwenden deine aktive KI und können beim Anbieter Kosten verursachen.",
          "The total limit is divided between both cases. Retries, context and repairs count toward it. Unknown usage cannot pass. Tests use your active AI and may incur provider costs.",
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {role !== "viewer" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await act("suite/quality/start", {
              action: "start",
              agent_id: f.get("agent"),
              model_id: f.get("model"),
              token_limit: Number(f.get("tokens")),
              credit_limit: Number(f.get("credits")),
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Agent</span>
              <select name="agent">
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Aktives Modell", "Active model")}</span>
              <select name="model" required defaultValue="">
                <option value="" disabled>
                  {t("Modell auswählen", "Choose model")}
                </option>
                {models
                  .filter((m) => m.active)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            {[
              [
                "tokens",
                t("Gesamte Tokens maximal", "Maximum total tokens"),
                "10000",
              ],
              [
                "credits",
                t("Gesamte Credits maximal", "Maximum total credits"),
                "1000",
              ],
            ].map(([name, label, value]) => (
              <label key={name} className="field">
                <span>{label}</span>
                <input
                  name={name}
                  type="number"
                  min={name === "tokens" ? 2000 : 0}
                  max={name === "tokens" ? 100000 : 1000000}
                  required
                  defaultValue={value}
                />
              </label>
            ))}
          </div>
          <button
            className="primary"
            disabled={busy || !models.some((m) => m.active)}
          >
            {t("Kostenpflichtigen KI-Test starten", "Start metered AI test")}
          </button>
          {!models.some((m) => m.active) && (
            <p>
              {t(
                "Kein Modell aktiv. Aktiviere zuerst ein Modell unter KI & Modelle. Es wurde kein Test gestartet.",
                "No active model. Enable a model under AI & models first. No test has been started.",
              )}
            </p>
          )}
        </form>
      )}
      {data?.items.map((e: any) => (
        <article className="form-note" key={e.id}>
          <h2>
            {new Date(e.created_at).toLocaleString()} · {e.status}
          </h2>
          <p>
            {t("Festes Gesamtlimit", "Fixed total limit")}:{" "}
            {e.token_limit.toLocaleString()} Tokens ·{" "}
            {e.credit_limit.toLocaleString()} Credits
          </p>
          {e.cases.map((q: any) => (
            <div
              key={q.id}
              style={{
                padding: "16px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <strong>
                {q.title} · {q.status}
              </strong>
              {q.run_id && (
                <p>
                  <a href={"/tasks/" + q.run_id}>
                    {t("Auftrag und Belege öffnen", "Open task and evidence")}
                  </a>
                </p>
              )}
              {q.verdict && (
                <>
                  <p>
                    {q.verdict.passed
                      ? t(
                          "Unabhängig geprüft: bestanden",
                          "Independently verified: passed",
                        )
                      : t(
                          "Nicht bestanden / nicht nachgewiesen",
                          "Failed / not verified",
                        )}{" "}
                    · {q.verdict.tokens ?? "—"} Tokens ·{" "}
                    {q.verdict.credits ?? "—"} Credits
                  </p>
                  {q.verdict.reason && <p>{q.verdict.reason}</p>}
                  <details>
                    <summary>{t("Prüfbeleg", "Evidence")}</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        maxHeight: 250,
                        overflow: "auto",
                      }}
                    >
                      {JSON.stringify(q.verdict, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </div>
          ))}
          {["queued", "running"].includes(e.status) && role !== "viewer" && (
            <button
              className="secondary"
              onClick={() =>
                void act("suite/quality/start", { action: "cancel", id: e.id })
              }
            >
              {t("Test stoppen", "Stop evaluation")}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
