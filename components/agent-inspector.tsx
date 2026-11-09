"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Activity,
  ArrowUpRight,
  Bot,
} from "lucide-react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import type { InspectionEntry } from "@/src/core/agent-inspector";
type TaskView = {
  id: string;
  run_id: string;
  parent_id: string | null;
  title: string;
  status: string;
  error: string | null;
  result: string | null;
  created_at: string;
  project_id: string;
  project_name: string;
  run_status: string;
  last_model_name: string | null;
  last_call_status: string | null;
};
type Info = {
  agent: {
    id: string;
    name: string;
    role: string;
    execution_paused: boolean;
    workspace_paused: boolean;
    assigned_model: string | null;
    assigned_provider: string | null;
  };
  projects: { id: string; name: string }[];
  tasks: TaskView[];
  total: number;
  page: number;
  usage: {
    calls: number;
    tokens: number;
    credits: number;
    unknown_calls: number;
    unconfirmed_tokens: number;
  };
  generated_at: string;
};
type Detail = {
  task: TaskView & {
    instructions: string;
    goal: string;
    token_limit: number;
    credit_limit: number;
    message_count: number;
    estimated_input: number | null;
    compacted_groups: number | null;
  };
  entries: InspectionEntry[];
  next_before: number | null;
  calls: {
    id: string;
    status: string;
    model_name: string | null;
    provider_name: string | null;
    managed: boolean;
    usage_known: boolean;
    input_tokens: number;
    output_tokens: number;
    tokens: number;
    budget_tokens: number;
    reserved: number;
    charged_credits: number;
    created_at: string;
    duration_ms: number | null;
    outcome: string | null;
  }[];
  running_tools: {
    id: string;
    arguments: string;
    result: string | null;
    tool: string;
    status: string;
    created_at: string;
    environment_name: string;
  }[];
  calls_total: number;
  budget: {
    measured_tokens: number;
    accounted_tokens: number;
    credits: number;
    unknown_calls: number;
  };
  relations: (TaskView & {
    agent_id: string;
    agent_name: string;
    instructions: string;
  })[];
  events: {
    id: number;
    agent_id: string | null;
    agent_name: string;
    kind: string;
    content: string;
    created_at: string;
  }[];
  plan: {
    id: string;
    title: string;
    status: string;
    planned_start: string | null;
    target_at: string | null;
    estimate_min: number | null;
    estimate_max: number | null;
    confidence: string;
  }[];
  generated_at: string;
};
function useInspection<T>(path: string | null, live: boolean, refresh: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null);
    setError("");
    setLoading(Boolean(path));
    if (!path) return;
    let active = true,
      busy = false;
    setLoading(true);
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await api<T>(path, undefined, "GET", {
          projectScope: false,
        });
        if (active) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        busy = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (live && document.visibilityState === "visible") void load();
    }, 5000);
    const visible = () => {
      if (live && document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [path, live, refresh]);
  return { data, error, loading };
}
export function AgentInspector({
  agentId,
  workspaceId,
}: {
  agentId: string;
  workspaceId: string;
}) {
  const { t, localeTag } = useLanguage(),
    router = useRouter(),
    search = useSearchParams();
  const [project, setProject] = useState(""),
    [page, setPage] = useState(1),
    [live, setLive] = useState(true),
    [refresh, setRefresh] = useState(0),
    [picked, setPicked] = useState(search.get("task") ?? "");
  const [older, setOlder] = useState<InspectionEntry[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [moreBusy, setMoreBusy] = useState(false),
    [moreError, setMoreError] = useState("");
  const selectedRef = useRef("");
  const info = useInspection<Info>(
    `agents/${agentId}/inspect?page=${page}${project ? "&filterProject=" + encodeURIComponent(project) : ""}`,
    live,
    refresh,
  );
  const selected = picked || info.data?.tasks[0]?.id || "";
  selectedRef.current = selected;
  const detail = useInspection<Detail>(
    selected ? `agents/${agentId}/inspect/task/${selected}` : null,
    live,
    refresh,
  );
  useEffect(() => {
    setOlder([]);
    setCursor(null);
    setMoreError("");
    setMoreBusy(false);
  }, [selected]);
  useEffect(() => {
    setPicked(search.get("task") ?? "");
  }, [search]);
  const choose = (id: string) => {
    setPicked(id);
    router.replace(`/agents/${agentId}?task=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  };
  const number = (v: unknown) =>
    new Intl.NumberFormat(localeTag).format(Number(v) || 0);
  const date = (v: string | null) =>
    v ? new Date(v).toLocaleString(localeTag) : "—";
  const status = (v: string) =>
    ({
      queued: t("Geplant", "Queued"),
      running: t("In Arbeit", "Running"),
      input_required: t("Eingabe nötig", "Input needed"),
      waiting: t("Wartet auf Team", "Waiting for team"),
      paused: t("Pausiert", "Paused"),
      completed: t("Abgeschlossen", "Completed"),
      failed: t("Fehlgeschlagen", "Failed"),
      canceled: t("Abgebrochen", "Canceled"),
      reserved: t("Anfrage läuft", "Request in progress"),
      uncertain: t("Ungeklärt", "Uncertain"),
      settled: t("Abgerechnet", "Settled"),
      planned: t("Geplant", "Planned"),
      ready: t("Bereit", "Ready"),
      blocked: t("Blockiert", "Blocked"),
      in_progress: t("In Arbeit", "In progress"),
    })[v] ?? v;
  const current = detail.data;
  const previousCount = useRef<number | null>(null);
  useEffect(() => {
    const count = current?.task.message_count;
    if (count != null) {
      if (previousCount.current != null && count < previousCount.current) {
        setOlder([]);
        setCursor(null);
      }
      previousCount.current = count;
    }
  }, [current?.task.message_count]);
  const entries = [...older, ...(current?.entries ?? [])]
    .filter((e, i, all) => all.findIndex((x) => x.index === e.index) === i)
    .sort((a, b) => a.index - b.index);
  const next = older.length ? cursor : (current?.next_before ?? null);
  const requestMore = async () => {
    if (next === null || !selected) return;
    const forTask = selected;
    setMoreBusy(true);
    setMoreError("");
    try {
      const result = await api<Detail>(
        `agents/${agentId}/inspect/task/${selected}?before=${next}`,
        undefined,
        "GET",
        { projectScope: false },
      );
      if (selectedRef.current === forTask) {
        setOlder((old) => [...result.entries, ...old]);
        setCursor(result.next_before);
      }
    } catch (e) {
      if (selectedRef.current === forTask) setMoreError((e as Error).message);
    } finally {
      if (selectedRef.current === forTask) setMoreBusy(false);
    }
  };
  return (
    <div className="agent-inspect-page">
      <a className="text-button" href="/agents">
        <ArrowLeft size={16} />
        {t("Zum Agententeam", "Back to agent team")}
      </a>
      <header className="agent-inspect-header">
        <div>
          <div className="eyebrow">
            {t("ARBEIT NACHVOLLZIEHEN", "FOLLOW THE WORK")}
          </div>
          <h1>
            <Bot size={28} />
            {info.data?.agent.name ?? t("Agenten-Einblick", "Agent activity")}
          </h1>
          <p>{info.data?.agent.role}</p>
        </div>
        <div className="button-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            {t("Live aktualisieren", "Live updates")}
          </label>
          <button
            className="secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={15} />
            {t("Aktualisieren", "Refresh")}
          </button>
        </div>
      </header>
      <p className="muted">
        {t(
          "Aufgaben, Werkzeugaktionen und Übergaben aus dem gespeicherten Arbeitsprotokoll. Automatisch alle 5 Sekunden, solange diese Seite sichtbar ist.",
          "Tasks, tool actions and handoffs from the saved work log. Updates every 5 seconds while this page is visible.",
        )}
      </p>
      {info.error && (
        <p className="error-box" role="alert">
          {info.error}
        </p>
      )}
      {info.loading && (
        <p role="status">{t("Agent wird geladen …", "Loading agent …")}</p>
      )}
      {info.data && (
        <>
          {(info.data.agent.execution_paused ||
            info.data.agent.workspace_paused) && (
            <p className="form-note" role="status">
              {t(
                "Die Ausführung ist angehalten. Gespeicherte Arbeit bleibt sichtbar.",
                "Execution is paused. Saved work remains visible.",
              )}
            </p>
          )}
          <section
            className="agent-inspect-stats"
            aria-label={t(
              "Verbrauch im Projektfilter",
              "Usage in project filter",
            )}
          >
            <div>
              <span>{t("Modellaufrufe", "Model calls")}</span>
              <strong>{number(info.data.usage.calls)}</strong>
            </div>
            <div>
              <span>{t("Gemeldete Tokens", "Reported tokens")}</span>
              <strong>{number(info.data.usage.tokens)}</strong>
              <small>
                {t(
                  "Ein- und Ausgabe, nur dieser Agent",
                  "Input and output, this agent only",
                )}
              </small>
            </div>
            <div>
              <span>
                {t(
                  "Credits verbraucht / reserviert",
                  "Credits spent / reserved",
                )}
              </span>
              <strong>{number(info.data.usage.credits)}</strong>
              <small>
                {t(
                  "BYOK wird beim Anbieter abgerechnet",
                  "BYOK is billed by the provider",
                )}
              </small>
            </div>
            <div>
              <span>{t("Nicht bestätigte Aufrufe", "Unconfirmed calls")}</span>
              <strong>{number(info.data.usage.unknown_calls)}</strong>
              <small>
                {number(info.data.usage.unconfirmed_tokens)}{" "}
                {t(
                  "Tokens vorsorglich gebunden",
                  "tokens conservatively accounted",
                )}
              </small>
            </div>
          </section>
          <section className="agent-inspect-filters">
            <label className="field">
              <span>{t("Projektfilter", "Project filter")}</span>
              <select
                id="agent-inspect-project"
                aria-label={t("Projektfilter", "Project filter")}
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setPage(1);
                  setPicked("");
                  router.replace(`/agents/${agentId}`, { scroll: false });
                }}
              >
                <option value="">
                  {t(
                    "Alle Projekte dieses Workspace",
                    "All projects in this workspace",
                  )}
                </option>
                {info.data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              {t("Zugewiesenes Modell", "Assigned model")}:{" "}
              <b>
                {info.data.agent.assigned_model ??
                  t("Nicht konfiguriert", "Not configured")}
              </b>
              {info.data.agent.assigned_provider
                ? " · " + info.data.agent.assigned_provider
                : ""}
              <br />
              {t(
                "Filter ändern deine aktive Projektauswahl nicht. Verbrauch gilt für alle Aufträge im Filter.",
                "Filters do not change your active project. Usage covers all tasks in the filter.",
              )}
            </p>
          </section>
          <div className="agent-inspect-layout">
            <aside
              className="agent-inspect-tasks"
              aria-label={t("Aufgaben dieses Agenten", "Tasks for this agent")}
            >
              <h2>
                {t("Aufgaben", "Tasks")}{" "}
                <small>{number(info.data.total)}</small>
              </h2>
              {info.data.tasks.length === 0 && (
                <p>
                  {t(
                    "Keine Aufgaben in diesem Filter.",
                    "No tasks in this filter.",
                  )}
                </p>
              )}
              {info.data.tasks.map((task) => (
                <button
                  key={task.id}
                  className={selected === task.id ? "is-selected" : ""}
                  aria-pressed={selected === task.id}
                  onClick={() => choose(task.id)}
                >
                  <span className="subtle-chip">{status(task.status)}</span>
                  <b>{task.title}</b>
                  <small>
                    {task.project_name} · {date(task.created_at)}
                  </small>
                </button>
              ))}
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={page === 1}
                  onClick={() => {
                    setPicked("");
                    setPage((v) => v - 1);
                  }}
                >
                  {t("Zurück", "Previous")}
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil(info.data.total / 25))}
                </span>
                <button
                  className="secondary"
                  disabled={page * 25 >= info.data.total}
                  onClick={() => {
                    setPicked("");
                    setPage((v) => v + 1);
                  }}
                >
                  {t("Weiter", "Next")}
                </button>
              </div>
            </aside>
            <div className="agent-inspect-content">
              {detail.error && (
                <p className="error-box" role="alert">
                  {detail.error}
                </p>
              )}
              {detail.loading && (
                <p role="status">
                  {t("Arbeitsprotokoll wird geladen …", "Loading work log …")}
                </p>
              )}
              {!selected && !detail.loading && (
                <section className="agent-inspect-box">
                  <h2>{t("Noch kein Arbeitsprotokoll", "No work log yet")}</h2>
                  <p>
                    {t(
                      "Sobald der Agent einen Auftrag übernimmt, erscheinen hier seine Schritte.",
                      "The agent’s steps appear here once it takes on a task.",
                    )}
                  </p>
                </section>
              )}
              {current && (
                <>
                  <section className="agent-inspect-box">
                    <div className="agent-inspect-title">
                      <h2>{current.task.title}</h2>
                      <span className="subtle-chip">
                        {status(current.task.status)}
                      </span>
                    </div>
                    <p className="muted">
                      {current.task.project_name} · {t("Auftrag", "Task")}:{" "}
                      {status(current.task.run_status)} ·{" "}
                      {t("Stand", "Updated")}: {date(current.generated_at)}
                    </p>
                    <a
                      href={`/tasks/${current.task.run_id}`}
                      className="text-button"
                    >
                      {t("Gesamten Auftrag öffnen", "Open full task")}
                      <ArrowUpRight size={14} />
                    </a>
                    <dl className="agent-inspect-facts">
                      <div>
                        <dt>{t("Aktueller Arbeitsschritt", "Current step")}</dt>
                        <dd>
                          {current.task.last_call_status === "reserved"
                            ? t(
                                "Eine Modellanfrage ist reserviert; eine Antwort liegt noch nicht vor.",
                                "A model request is reserved; no response has been saved yet.",
                              )
                            : current.task.error || status(current.task.status)}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          {t("Zuletzt verwendetes Modell", "Last model used")}
                        </dt>
                        <dd>
                          {current.task.last_model_name ??
                            t("Noch kein Modellaufruf", "No model call yet")}
                        </dd>
                      </div>
                    </dl>
                    {current.task.error && (
                      <p className="form-note warning-text">
                        {t("Blockade / Hinweis", "Blocker / notice")}:{" "}
                        {current.task.error}{" "}
                        {current.task.status === "input_required" && (
                          <a href="/decisions">
                            {t(
                              "Im Entscheidungs-Postfach prüfen",
                              "Review in decision inbox",
                            )}
                          </a>
                        )}
                      </p>
                    )}
                    {current.running_tools.map((job) => (
                      <div className="form-note" key={job.id}>
                        {t("Aktive Werkzeugaktion", "Active tool action")}:{" "}
                        <b>{job.tool}</b> · {job.environment_name} ·{" "}
                        {status(job.status)} · {date(job.created_at)}
                        <details>
                          <summary>
                            {t(
                              "Parameter und Ergebnis",
                              "Arguments and result",
                            )}
                          </summary>
                          <pre>{job.arguments}</pre>
                          <pre>
                            {job.result ??
                              t(
                                "Noch kein Ergebnis gespeichert.",
                                "No result saved yet.",
                              )}
                          </pre>
                        </details>
                      </div>
                    ))}
                    {[...current.entries]
                      .reverse()
                      .find((e) => e.tools.length)
                      ?.tools.map((tool) => (
                        <p className="muted" key={tool.id}>
                          {t(
                            "Zuletzt angefordertes Werkzeug",
                            "Last requested tool",
                          )}
                          : <b>{tool.name}</b> ·{" "}
                          <a href="#agent-inspect-log">
                            {t(
                              "Parameter und Ergebnis ansehen",
                              "View arguments and result",
                            )}
                          </a>
                        </p>
                      ))}
                    <details>
                      <summary>
                        {t(
                          "Aufgabe und übergebene Anweisungen",
                          "Task and handed-off instructions",
                        )}
                      </summary>
                      <pre>{current.task.instructions}</pre>
                    </details>
                    {current.task.result && (
                      <details>
                        <summary>
                          {t("Gespeichertes Ergebnis", "Saved result")}
                        </summary>
                        <pre>{current.task.result}</pre>
                      </details>
                    )}
                  </section>
                  <section className="agent-inspect-box">
                    <h2>
                      {t("Gemeinsames Auftragsbudget", "Shared task budget")}
                    </h2>
                    <p className="muted">
                      {t(
                        "Gilt für den gesamten Auftrag und alle beteiligten Agenten. Die Zahlen oben zeigen nur diesen Agenten.",
                        "Applies to the full task and every participating agent. The totals above cover this agent only.",
                      )}
                    </p>
                    <dl className="agent-inspect-facts">
                      <div>
                        <dt>{t("Gemeldete Tokens", "Reported tokens")}</dt>
                        <dd>
                          {number(current.budget.measured_tokens)} /{" "}
                          {number(current.task.token_limit)}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          {t(
                            "Tokens verfügbar nach Reservierungen",
                            "Tokens available after reservations",
                          )}
                        </dt>
                        <dd>
                          {number(
                            Math.max(
                              0,
                              Number(current.task.token_limit) -
                                Number(current.budget.accounted_tokens),
                            ),
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          {t(
                            "Credits verbraucht / reserviert / Limit",
                            "Credits spent / reserved / limit",
                          )}
                        </dt>
                        <dd>
                          {number(current.budget.credits)} /{" "}
                          {number(current.task.credit_limit)}
                        </dd>
                      </div>
                      <div>
                        <dt>
                          {t(
                            "Zuletzt geschätzter Eingabekontext",
                            "Last estimated input context",
                          )}
                        </dt>
                        <dd>
                          {current.task.estimated_input == null
                            ? "—"
                            : number(current.task.estimated_input)}{" "}
                          Tokens · {number(current.task.compacted_groups)}{" "}
                          {t(
                            "Schrittgruppen komprimiert",
                            "step groups compacted",
                          )}
                        </dd>
                      </div>
                    </dl>
                    <small>
                      {t(
                        "Freie Tokens müssen auch den nächsten Eingabekontext und die Ausgabe abdecken. Unbestätigter Verbrauch bleibt vorsorglich gebunden.",
                        "Available tokens must cover the next input context and output. Unconfirmed usage remains conservatively accounted.",
                      )}
                    </small>
                  </section>
                  <section className="agent-inspect-box">
                    <h2>
                      {t("Nächste geplante Schritte", "Next planned steps")}
                    </h2>
                    {current.plan.length ? (
                      current.plan.map((p) => (
                        <div className="agent-inspect-row" key={p.id}>
                          <b>{p.title}</b>
                          <span>{status(p.status)}</span>
                          <small>
                            {p.planned_start
                              ? date(p.planned_start)
                              : t("Kein Starttermin", "No start time")}
                            {p.estimate_min != null
                              ? ` · ${p.estimate_min}–${p.estimate_max ?? p.estimate_min} min`
                              : ""}
                            {p.target_at
                              ? " · " +
                                t("Ziel", "Target") +
                                ": " +
                                date(p.target_at)
                              : ""}
                          </small>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        {t(
                          "Kein weiterer Schritt für diesen Agenten im Projektplan gespeichert. Der nächste Schritt wird nicht geraten.",
                          "No next step for this agent is saved in the project plan. A next action is not inferred.",
                        )}
                      </p>
                    )}
                    <small>
                      {t(
                        "Planangaben können weitere Arbeit im selben Projekt betreffen. Zeitfenster sind Schätzungen.",
                        "Plan entries may include other work in this project. Time windows are estimates.",
                      )}
                    </small>
                  </section>
                  <section className="agent-inspect-box">
                    <h2>
                      {t("Nachrichten & Übergaben", "Messages & handoffs")}
                    </h2>
                    {current.relations.map((rel) => (
                      <details key={rel.id}>
                        <summary>
                          {rel.id === current.task.parent_id
                            ? t("Übernommen von", "Received from")
                            : t("Delegiert an", "Delegated to")}{" "}
                          {rel.agent_name} · {rel.title} · {status(rel.status)}
                        </summary>
                        <a
                          className="text-button"
                          href={`/agents/${rel.agent_id}?task=${rel.id}`}
                        >
                          {t("Agenten-Einblick öffnen", "Open agent activity")}
                        </a>
                        <pre>{rel.instructions}</pre>
                        {rel.result && <pre>{rel.result}</pre>}
                        {rel.error && (
                          <p className="warning-text">{rel.error}</p>
                        )}
                      </details>
                    ))}
                    {current.events
                      .filter((e) =>
                        ["message", "delegated", "decision"].includes(e.kind),
                      )
                      .map((e) => (
                        <div className="agent-inspect-row" key={e.id}>
                          <small>
                            {e.agent_name || "Workspace"} · {date(e.created_at)}{" "}
                            · {e.kind}
                          </small>
                          <p>{e.content}</p>
                        </div>
                      ))}
                    {!current.relations.length &&
                      !current.events.some((e) =>
                        ["message", "delegated", "decision"].includes(e.kind),
                      ) && (
                        <p className="muted">
                          {t(
                            "Keine Nachrichten oder Übergaben gespeichert.",
                            "No messages or handoffs saved.",
                          )}
                        </p>
                      )}
                  </section>
                  <section className="agent-inspect-box" id="agent-inspect-log">
                    <h2>
                      <Activity size={18} />
                      {t("Aktionsprotokoll", "Action log")}
                    </h2>
                    <p className="muted">
                      {t(
                        "Gespeicherte Ein- und Ausgaben mit Werkzeugparametern und Ergebnissen. Erkannte Zugangsdaten werden gefiltert; lange Inhalte gekürzt. Interne Denkprozesse und Systemanweisungen werden nicht angezeigt.",
                        "Saved inputs and outputs with tool arguments and results. Recognised credentials are filtered and long content shortened. Internal reasoning and system instructions are not shown.",
                      )}
                    </p>
                    {next !== null && (
                      <button
                        className="secondary"
                        disabled={moreBusy}
                        onClick={() => void requestMore()}
                      >
                        {moreBusy
                          ? t("Lädt …", "Loading …")
                          : t("Ältere Schritte laden", "Load earlier steps")}
                      </button>
                    )}
                    {moreError && (
                      <p role="alert" className="error-box">
                        {moreError}
                      </p>
                    )}
                    {!entries.length && (
                      <p>
                        {t(
                          "Noch keine Modell- oder Werkzeugausgabe gespeichert.",
                          "No model or tool output saved yet.",
                        )}
                      </p>
                    )}
                    {entries.map((entry) => (
                      <article
                        className="agent-inspect-entry"
                        key={entry.index}
                      >
                        <header>
                          <b>
                            #{entry.index + 1} ·{" "}
                            {entry.role === "tool"
                              ? t("Werkzeugergebnis", "Tool result")
                              : entry.role === "assistant"
                                ? t("Agentenausgabe", "Agent output")
                                : t(
                                    "Eingabe / Teamnachricht",
                                    "Input / team message",
                                  )}
                          </b>
                          {entry.tool_call_id && (
                            <code>{entry.tool_call_id}</code>
                          )}
                        </header>
                        {entry.content && <pre>{entry.content}</pre>}
                        {entry.tools.map((tool) => (
                          <details
                            key={tool.id}
                            open={[
                              "team_message",
                              "delegate_task",
                              "plan_work",
                              "request_input",
                            ].includes(tool.name)}
                          >
                            <summary>
                              {tool.name} · {t("Parameter", "Arguments")}
                            </summary>
                            <small>{tool.id}</small>
                            <pre>{tool.arguments}</pre>
                            {tool.truncated && (
                              <small>
                                {t(
                                  "Parameter gekürzt.",
                                  "Arguments shortened.",
                                )}
                              </small>
                            )}
                          </details>
                        ))}
                        {entry.truncated && (
                          <small>
                            {t(
                              "Inhalt gekürzt. Die gespeicherten Originale bleiben erhalten.",
                              "Content shortened. Saved originals are preserved.",
                            )}
                          </small>
                        )}
                      </article>
                    ))}
                  </section>
                  <section className="agent-inspect-box">
                    <h2>
                      {t(
                        "Modellaufrufe dieser Aufgabe",
                        "Model calls for this task",
                      )}
                    </h2>
                    <p className="muted">
                      {t(
                        "Die letzten 20 Aufrufe; insgesamt",
                        "Latest 20 calls; total",
                      )}{" "}
                      {number(current.calls_total)}.{" "}
                      {t(
                        "Nicht gemeldeter Verbrauch wird nicht als 0 ausgegeben.",
                        "Unreported usage is not shown as zero.",
                      )}
                    </p>
                    <div className="agent-inspect-table">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("Modell / Zeitpunkt", "Model / time")}</th>
                            <th>Status</th>
                            <th>{t("Eingabe / Ausgabe", "Input / output")}</th>
                            <th>{t("Abrechnung", "Billing")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {current.calls.map((call) => (
                            <tr key={call.id}>
                              <td>
                                <b>
                                  {call.model_name ??
                                    t(
                                      "Modellname nicht gespeichert",
                                      "Model name not saved",
                                    )}
                                </b>
                                <small>
                                  {call.provider_name} · {date(call.created_at)}
                                </small>
                              </td>
                              <td>
                                {status(call.status)}
                                <small>
                                  {call.duration_ms == null
                                    ? "—"
                                    : number(call.duration_ms) + " ms"}
                                </small>
                              </td>
                              <td>
                                {call.usage_known
                                  ? `${number(call.input_tokens)} / ${number(call.output_tokens)}`
                                  : t("Nicht bestätigt", "Unconfirmed")}
                                {!call.usage_known && (
                                  <small>
                                    {number(call.budget_tokens)}{" "}
                                    {t("Tokens gebunden", "tokens accounted")}
                                  </small>
                                )}
                              </td>
                              <td>
                                {call.managed
                                  ? number(
                                      ["reserved", "uncertain"].includes(
                                        call.status,
                                      )
                                        ? call.reserved
                                        : call.charged_credits,
                                    ) + " Credits"
                                  : "BYOK"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!current.calls.length && (
                      <p>
                        {t("Noch kein Modellaufruf.", "No model calls yet.")}
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
