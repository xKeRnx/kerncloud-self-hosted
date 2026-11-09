"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Inbox,
  Plus,
  RefreshCw,
  Sparkles,
  FolderKanban,
  CircleCheck,
  ListTodo,
} from "lucide-react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import { projectPath } from "../src/core/navigation";
export function useWorkspaceResource(path: string, signal: unknown) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const last = useRef(0),
    sequence = useRef(0);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    last.current = Date.now();
    setBusy(true);
    try {
      const d = await api(path, undefined, "GET", { projectScope: false });
      if (seq === sequence.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      clearInterval(id);
      ++sequence.current;
    };
  }, [load]);
  useEffect(() => {
    const id = setTimeout(
      () => void load(),
      Math.max(0, 3000 - (Date.now() - last.current)),
    );
    return () => clearTimeout(id);
  }, [signal, load]);
  return { data, error, busy, load };
}
export function RunRow({ run }: { run: any }) {
  const { t, number, date } = useLanguage();
  const labels: Record<string, string> = {
    running: t("In Arbeit", "Running"),
    paused: t("Pausiert", "Paused"),
    input_required: t("Rückmeldung nötig", "Needs input"),
    completed: t("Abgeschlossen", "Completed"),
    failed: t("Fehlgeschlagen", "Failed"),
    canceled: t("Abgebrochen", "Canceled"),
  };
  return (
    <Link className="work-run-row" href={"/tasks/" + run.id}>
      <div className="work-run-copy">
        <span className="work-project-name">{run.project_name}</span>
        <strong>{run.title}</strong>
        {run.current_step && (
          <small>
            {t("Arbeitsschritt: ", "Current step: ")}
            {run.current_step}
          </small>
        )}
        <small>
          {run.last_activity
            ? t("Letzte Aktivität: ", "Last activity: ") +
              date(run.last_activity)
            : date(run.created_at)}{" "}
          · {number(run.tokens_used)} Tokens · {run.steps_used}/{run.max_steps}{" "}
          {t("Modellaufrufe", "model calls")}
        </small>
      </div>
      <span className={"badge status-" + run.status}>
        {run.blockers > 0
          ? t("Rückmeldung nötig", "Needs input")
          : (labels[run.status] ?? run.status)}
      </span>
      <ArrowRight size={16} />
    </Link>
  );
}
export function WorkspaceHome({
  state,
  newTask,
}: {
  state: any;
  newTask: () => void;
}) {
  const { t, number } = useLanguage(),
    { data, error, busy, load } = useWorkspaceResource("workspace/home", state);
  return (
    <div className="workspace-home">
      <header className="workspace-page-heading workspace-home-hero">
        <div className="workspace-hero-orbit" aria-hidden="true"><i/><i/><Sparkles size={68}/></div>
        <div>
          <span className="scope-label">
            {t("GESAMTER WORKSPACE", "ENTIRE WORKSPACE")}
          </span>
          <h1>{t("Deine Arbeit.", "Your work.")} <em>{t("Klar im Blick.", "Clearly in view.")}</em></h1>
          <p>
            {state.workspace.name} ·{" "}
            {t(
              "Alle Projekte, Aufträge und Ergebnisse an einem Ort.",
              "All projects, tasks and results in one place.",
            )}
          </p>
        </div>
        <button className="primary" onClick={newTask}>
          <Plus size={17} />
          {t("Neuer Auftrag", "New task")}
        </button>
      </header>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <section className="panel workspace-loading" role="status">
          {t("Workspace wird geladen …", "Loading workspace …")}
        </section>
      ) : (
        <>
          <section
            className="workspace-metrics"
            aria-label={t("Workspace-Überblick", "Workspace overview")}
          >
            {[
              [t("Offene Aufträge", "Open tasks"), data.stats.open, ListTodo],
              [t("Braucht dich", "Needs you"), data.stats.attention, Inbox],
              [t("Abgeschlossen", "Completed"), data.stats.completed, CircleCheck],
              [t("Projekte", "Projects"), data.stats.projects, FolderKanban],
            ].map(([label, value, Icon]: any) => (
              <div key={label}>
                <span><Icon size={20}/>{label}</span>
                <strong>{number(value)}</strong>
              </div>
            ))}
          </section>
          <section
            className={
              "panel workspace-attention" +
              (data.attention.length ? " has-attention" : "")
            }
          >
            <div className="workspace-section-heading">
              <h2>
                <Inbox size={18} />
                {t("Braucht deine Aufmerksamkeit", "Needs your attention")}
              </h2>
              <Link href="/decisions">{t("Zum Postfach", "Open inbox")} →</Link>
            </div>
            {data.attention.length ? (
              <div className="workspace-attention-list">
                {data.attention.map((r: any) => (
                  <Link key={r.id} href="/decisions">
                    <span className="work-project-name">
                      {r.project_name} · {r.agent_name}
                    </span>
                    <strong>{r.question}</strong>
                    <span>{t("Entscheidung öffnen", "Open decision")} →</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="workspace-empty-inline">
                <CheckCircle2 size={18} />
                {t(
                  "Keine offenen Rückfragen oder Freigaben.",
                  "No questions or approvals waiting.",
                )}
              </p>
            )}
          </section>
          <section className="panel">
            <div className="workspace-section-heading">
              <h2>
                <Clock3 size={18} />
                {t("Laufende Arbeit", "Work in progress")}
              </h2>
              <Link href="/tasks/all">{t("Alle Aufträge", "All tasks")} →</Link>
            </div>
            {data.running.length ? (
              data.running.map((r: any) => <RunRow key={r.id} run={r} />)
            ) : (
              <div className="workspace-empty">
                <p>
                  {t("Gerade läuft kein Auftrag.", "No tasks are running.")}
                </p>
                <button className="secondary" onClick={newTask}>
                  {t("Ersten Auftrag erstellen", "Create a task")}
                </button>
              </div>
            )}
          </section>
          <div className="workspace-home-columns">
            <section className="panel">
              <div className="workspace-section-heading">
                <h2>{t("Neue Ergebnisse", "New results")}</h2>
                <Link href="/tasks/all?status=completed">
                  {t("Abgeschlossene Aufträge", "Completed tasks")} →
                </Link>
              </div>
              {data.results.length ? (
                data.results.map((r: any) => (
                  <Link
                    className="workspace-result-link"
                    href={"/tasks/" + r.run_id}
                    key={r.id}
                  >
                    <span className="work-project-name">
                      {r.project_name} ·{" "}
                      {r.status === "completed"
                        ? t("Abgeschlossen", "Completed")
                        : t("Zwischenergebnis", "Partial result")}
                    </span>
                    <strong>{r.title}</strong>
                    <small>
                      {r.name} ·{" "}
                      {t(
                        "Vorschau und Download öffnen",
                        "Open preview and download",
                      )}
                    </small>
                  </Link>
                ))
              ) : (
                <p className="workspace-empty">
                  {t(
                    "Ergebnisse erscheinen hier, sobald Dateien gespeichert wurden.",
                    "Results appear here when files are saved.",
                  )}
                </p>
              )}
            </section>
            <section className="panel">
              <div className="workspace-section-heading">
                <h2>{t("Deine Projekte", "Your projects")}</h2>
                <Link href="/projects">
                  {t("Alle Projekte", "All projects")} →
                </Link>
              </div>
              {data.projects.map((p: any) => (
                <Link
                  className="workspace-result-link"
                  href={projectPath(p.id)}
                  key={p.id}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {number(p.open)} {t("offene Aufträge", "open tasks")}
                  </small>
                </Link>
              ))}
            </section>
          </div>
          <section className="panel workspace-team-summary">
            <div className="workspace-section-heading">
              <h2>{t("Agententeam", "Agent team")}</h2>
              <Link href="/agents">{t("Team öffnen", "Open team")} →</Link>
            </div>
            <div className="workspace-agent-chips">
              {data.agents.map((a: any) => (
                <Link href={"/agents/" + a.id} key={a.id}>
                  <span className={"live-dot" + (!a.running ? " idle" : "")} />
                  <b>{a.name}</b>
                  <span>
                    {a.execution_paused
                      ? t("Pausiert", "Paused")
                      : a.running
                        ? t("Arbeitet", "Working")
                        : t("Bereit", "Ready")}
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <div className="workspace-home-bottom">
            <span>
              {t("KI-Abrechnung: ", "AI billing: ")}
              {state.workspace.ai_mode === "byok"
                ? t(
                    "Eigener Anbieter · separat abgerechnet",
                    "Your provider · billed separately",
                  )
                : t("KeRnCloud-Credits", "KeRnCloud credits")}{" "}
              ·{" "}
              <Link href="/activity">
                {t("Verbrauch ansehen", "View usage")}
              </Link>
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
              {t("Aktualisieren", "Refresh")}
            </button>
            <Link href="/worklog">{t("Arbeitsverlauf", "Work history")} →</Link>
          </div>
        </>
      )}
    </div>
  );
}
export function WorkspaceWork({
  state,
  newTask,
}: {
  state: any;
  newTask: () => void;
}) {
  const { t } = useLanguage();
  const [project, setProject] = useState(""),
    [status, setStatus] = useState("all"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [before, setBefore] = useState<string | undefined>(),
    [history, setHistory] = useState<(string | undefined)[]>([]);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("status");
    if (
      v &&
      [
        "running",
        "paused",
        "input_required",
        "completed",
        "failed",
        "canceled",
      ].includes(v)
    )
      setStatus(v);
  }, []);
  const params = new URLSearchParams({
    status,
    q: query,
    ...(project ? { project } : {}),
    ...(before ? { before } : {}),
  });
  const { data, error, busy } = useWorkspaceResource(
    "workspace/tasks?" + params,
    state,
  );
  const reset = () => {
    setBefore(undefined);
    setHistory([]);
  };
  return (
    <section className="workspace-work">
      <header className="workspace-page-heading">
        <div>
          <span className="scope-label">
            {t("GESAMTER WORKSPACE", "ENTIRE WORKSPACE")}
          </span>
          <h1>{t("Alle Aufträge", "All tasks")}</h1>
          <p>
            {t(
              "Projektübergreifend suchen und verfolgen. Der Filter verändert deine Projektauswahl nicht.",
              "Search and track work across projects. Filters do not change your selected project.",
            )}
          </p>
        </div>
        <button className="primary" onClick={newTask}>
          <Plus size={17} />
          {t("Neuer Auftrag", "New task")}
        </button>
      </header>
      <form
        className="panel workspace-work-filters"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          setQuery(search);
        }}
      >
        <label className="field">
          <span>{t("Projekt", "Project")}</span>
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              reset();
            }}
          >
            <option value="">{t("Alle Projekte", "All projects")}</option>
            {state.projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              reset();
            }}
          >
            {[
              ["all", t("Alle Status", "All statuses")],
              ["running", t("In Arbeit", "Running")],
              ["input_required", t("Rückmeldung nötig", "Needs input")],
              ["paused", t("Pausiert", "Paused")],
              ["completed", t("Abgeschlossen", "Completed")],
              ["failed", t("Fehlgeschlagen", "Failed")],
              ["canceled", t("Abgebrochen", "Canceled")],
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("Aufträge durchsuchen", "Search tasks")}</span>
          <input
            type="search"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="secondary">{t("Suchen", "Search")}</button>
      </form>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        {!data ? (
          <p className="workspace-empty" role="status">
            {t("Aufträge werden geladen …", "Loading tasks …")}
          </p>
        ) : data.items.length ? (
          data.items.map((r: any) => <RunRow key={r.id} run={r} />)
        ) : (
          <p className="workspace-empty">
            {t(
              "Keine Aufträge für diese Filter.",
              "No tasks match these filters.",
            )}
          </p>
        )}
      </section>
      <div className="workspace-pagination">
        <button
          className="secondary"
          disabled={busy || !history.length}
          onClick={() => {
            setBefore(history.at(-1));
            setHistory(history.slice(0, -1));
          }}
        >
          {t("Zurück", "Previous")}
        </button>
        <span>
          {t("Seite", "Page")} {history.length + 1}
        </span>
        <button
          className="secondary"
          disabled={busy || !data?.next}
          onClick={() => {
            setHistory([...history, before]);
            setBefore(data.next);
          }}
        >
          {t("Weiter", "Next")}
        </button>
      </div>
    </section>
  );
}
