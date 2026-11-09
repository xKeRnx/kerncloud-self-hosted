"use client";
import { useState, useEffect } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import type { Snapshot } from "../src/core/types";
export function AutomationsPanel({ state }: { state: Snapshot }) {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null),
    [editing, setEditing] = useState<any>(undefined),
    [agent, setAgent] = useState(state.agents[0]?.id ?? ""),
    [mode, setMode] = useState("agent"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hook, setHook] = useState<any>(null);
  async function reload() {
    setData(await api("automations"));
  }
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [state.workspace.id, state.workspace.project_id]);
  async function action(body: any) {
    setBusy(true);
    setError("");
    try {
      const result = await api<any>("automations", body);
      if (result.webhook_token)
        setHook({ id: result.id ?? body.id, token: result.webhook_token });
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const skills = state.skills.filter(
    (s) =>
      s.status === "approved" &&
      state.agents.find((a) => a.id === agent)?.skill_ids.includes(s.id),
  );
  return (
    <section className="panel settings-panel automation-panel">
      <div className="section-title">
        <h2>{t("Skill-Automationen", "Skill automations")}</h2>
        <button
          type="button"
          className="secondary"
          disabled={busy || !data?.limit}
          onClick={() => {
            setEditing(null);
            setAgent(state.agents[0]?.id ?? "");
            setMode("agent");
          }}
        >
          {t("Automation anlegen", "Create automation")}
        </button>
      </div>
      <p>
        {t(
          "Geprüfte, einem Agenten zugeordnete Skills zeitgesteuert oder per Webhook starten. Jede Ausführung hat ein festes Budget und erscheint als Auftrag. Ein laufender Auftrag verhindert überlappende Ausführungen derselben Automation.",
          "Run reviewed skills assigned to an agent on a schedule or via webhook. Each execution has a fixed budget and appears as a task. An active task prevents overlapping executions of the same automation.",
        )}
      </p>
      <small>
        {t("Planplätze (kontoweit)", "Plan slots (account-wide)")}:{" "}
        {data?.limit ?? "…"} ·{" "}
        {t("Ausführungen diesen Monat", "Executions this month")}:{" "}
        {data?.monthly_used ?? 0}/{data?.monthly_limit ?? 0} (UTC) ·{" "}
        {t(
          "Intervall mindestens 15 Minuten; Ausführung durch verbundene Worker.",
          "Minimum interval 15 minutes; connected workers execute jobs.",
        )}
      </small>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {hook && (
        <div className="notice">
          <strong>
            {t(
              "Webhook-Zugang · nur jetzt sichtbar",
              "Webhook access · visible only now",
            )}
          </strong>
          <p>
            {t(
              "Token sicher speichern. POST benötigt Authorization und einen eindeutigen Idempotency-Key; übertragene Nutzdaten werden nicht als Agentenanweisung übernommen.",
              "Store this token securely. POST requires Authorization and a unique Idempotency-Key; payload data is not ingested as agent instructions.",
            )}
          </p>
          <code>/api/automations/hooks/{hook.id}</code>
          <label className="field">
            <span>Authorization</span>
            <input readOnly value={"Bearer " + hook.token} />
          </label>
          <code>Idempotency-Key: unique-event-123</code>
          <button className="secondary" onClick={() => setHook(null)}>
            {t("Schließen", "Close")}
          </button>
        </div>
      )}
      {editing !== undefined && (
        <form
          key={editing?.id ?? "new"}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const recipe =
                mode === "agent"
                  ? undefined
                  : JSON.parse(String(f.get("recipe")));
              if (
                await action({
                  action: "save",
                  project_id: state.workspace.project_id,
                  overlap_policy: f.get("overlap_policy"),
                  catch_up: f.get("catch_up"),
                  ...(editing
                    ? { id: editing.id, revision: editing.revision }
                    : {}),
                  name: f.get("name"),
                  agent_id: agent,
                  skill_id: f.get("skill"),
                  mode,
                  goal: f.get("goal"),
                  ...(recipe ? { recipe } : {}),
                  interval_minutes: f.get("interval")
                    ? Number(f.get("interval"))
                    : null,
                  token_limit: Number(f.get("tokens")),
                  credit_limit: Number(f.get("credits")),
                  enabled: f.get("enabled") === "on",
                })
              )
                setEditing(undefined);
            } catch {
              setError(
                t(
                  "Pipeline muss gültiges JSON mit steps sein.",
                  "Pipeline must be valid JSON with steps.",
                ),
              );
            }
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>
                {t("Bei laufender Ausführung", "While a run is active")}
              </span>
              <select
                name="overlap_policy"
                defaultValue={editing?.overlap_policy ?? "coalesce"}
              >
                <option value="coalesce">
                  {t("Einen Folgeauftrag zusammenfassen", "Keep one follow-up")}
                </option>
                <option value="skip">
                  {t("Neue Auslösung überspringen", "Skip new triggers")}
                </option>
                <option value="queue">
                  {t("Begrenzt einreihen (max. 10)", "Bounded queue (max. 10)")}
                </option>
              </select>
            </label>
            <label className="field">
              <span>{t("Verpasste Zeitpunkte", "Missed schedules")}</span>
              <select
                name="catch_up"
                defaultValue={editing?.catch_up ?? "skip"}
              >
                <option value="skip">{t("Überspringen", "Skip")}</option>
                <option value="coalesce">
                  {t("Einmal nachholen", "Catch up once")}
                </option>
              </select>
            </label>
            <label className="field">
              <span>{t("Name", "Name")}</span>
              <input
                name="name"
                defaultValue={editing?.name}
                maxLength={100}
                required
              />
            </label>
            <label className="field">
              <span>Agent</span>
              <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                {state.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Skill</span>
              <select name="skill" defaultValue={editing?.skill_id} required>
                <option value="">
                  {t(
                    "Geprüften zugeordneten Skill auswählen",
                    "Choose a reviewed assigned skill",
                  )}
                </option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · v{s.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Ausführung", "Execution")}</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="agent">
                  {t("Agent arbeitet mit KI", "Agent uses AI")}
                </option>
                <option value="pipeline">
                  {t("Pipeline ohne KI-Aufrufe", "Pipeline without AI calls")}
                </option>
                <option value="pipeline_then_agent">
                  {t(
                    "Pipeline, KI nur bei Fehler",
                    "Pipeline; AI only on failure",
                  )}
                </option>
              </select>
            </label>
            <label className="field">
              <span>
                {t(
                  "Intervall in Minuten (leer = nur manuell/Webhook)",
                  "Interval in minutes (empty = manual/webhook only)",
                )}
              </span>
              <input
                name="interval"
                type="number"
                min={15}
                max={43200}
                defaultValue={editing?.interval_minutes ?? ""}
              />
            </label>
            <label className="field">
              <span>
                {t("Tokenlimit pro Ausführung", "Token limit per execution")}
              </span>
              <input
                name="tokens"
                type="number"
                min={1000}
                max={state.workspace.run_token_limit ?? 100000}
                defaultValue={
                  editing?.token_limit ??
                  Math.min(10000, state.workspace.run_token_limit ?? 100000)
                }
                required
              />
            </label>
            <label className="field">
              <span>
                {t(
                  "KI-Credit-Limit pro Ausführung",
                  "AI-credit limit per execution",
                )}
              </span>
              <input
                name="credits"
                type="number"
                min={0}
                max={state.workspace.run_credit_limit ?? 10000}
                defaultValue={editing?.credit_limit ?? 0}
                required
              />
            </label>
          </div>
          <label className="field">
            <span>
              {t("Aufgabe und erwartetes Ergebnis", "Task and expected result")}
            </span>
            <textarea
              name="goal"
              rows={3}
              minLength={10}
              maxLength={4000}
              defaultValue={editing?.goal}
              required
            />
          </label>
          {mode !== "agent" && (
            <label className="field">
              <span>
                {t(
                  "Pipeline-Rezept (JSON, höchstens 12 Schritte)",
                  "Pipeline recipe (JSON, maximum 12 steps)",
                )}
              </span>
              <textarea
                name="recipe"
                rows={8}
                defaultValue={JSON.stringify(
                  editing?.recipe ?? {
                    steps: [{ tool: "list_environments", args: {} }],
                  },
                  null,
                  2,
                )}
                required
              />
              <small>
                {t(
                  "Erlaubt: Lesen, Dateien, Prüfungen, freigegebene Containerbefehle und Browseraktionen. Jeder Schritt wird separat geprüft. Nutze tool_pipeline als Werkzeugbeschreibung für das vollständige Schema.",
                  "Allowed: reads, files, validation, permitted environment commands and browser actions. Each step is authorized separately. See tool_pipeline for the complete schema.",
                )}
              </small>
            </label>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={editing?.enabled ?? false}
            />
            {t(
              "Aktivieren – künftige Ausführungen innerhalb dieser Grenzen freigeben",
              "Enable – authorize future executions within these limits",
            )}
          </label>
          <div className="button-row">
            <button className="primary" disabled={busy}>
              {t("Speichern", "Save")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(undefined)}
            >
              {t("Abbrechen", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {data?.entries.map((a: any) => (
        <article className="automation-entry" key={a.id}>
          <h3>{a.name}</h3>
          <p>
            {a.enabled ? t("Aktiv", "Enabled") : t("Pausiert", "Paused")} ·{" "}
            {a.mode} ·{" "}
            {a.interval_minutes
              ? `${a.interval_minutes} min`
              : t("Nur manuell/Webhook", "Manual/webhook only")}{" "}
            · {a.token_limit.toLocaleString()} Tokens / {a.credit_limit} Credits
          </p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(a);
                setAgent(a.agent_id);
                setMode(a.mode);
              }}
            >
              {t("Bearbeiten", "Edit")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action({ action: "toggle", id: a.id, enabled: !a.enabled })
              }
            >
              {a.enabled ? t("Pausieren", "Pause") : t("Aktivieren", "Enable")}
            </button>
            <button
              className="secondary"
              disabled={busy || !a.enabled}
              onClick={() => void action({ action: "run", id: a.id })}
            >
              {t("Jetzt starten", "Run now")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void action({ action: "rotate_hook", id: a.id })}
            >
              {t("Webhook-Token erneuern", "Rotate webhook token")}
            </button>
          </div>
        </article>
      ))}
      {data?.history.length > 0 && (
        <details>
          <summary>{t("Ausführungsverlauf", "Execution history")}</summary>
          <ul>
            {data.history.map((h: any) => (
              <li key={h.id}>
                {new Date(h.created_at).toLocaleString()} ·{" "}
                {h.run_status ?? h.status} · {h.error ?? ""}{" "}
                {h.run_id && (
                  <a href={"/tasks/" + h.run_id}>
                    {t("Auftrag öffnen", "Open task")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
