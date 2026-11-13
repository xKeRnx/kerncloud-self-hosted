"use client";
import { starterTeams } from "@/src/core/starter-teams";
import { ProjectManager } from "./project-manager";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ProjectOverview } from "./project-overview";
import { InteractiveTimeline, type TimelineItem } from "./interactive-timeline";
import { useRouter, usePathname } from "next/navigation";
import { projectPath } from "../src/core/navigation";
import { api, selectProject } from "./api-client";
import { useLanguage } from "./language";
import type { Snapshot } from "../src/core/types";
function phase(value: string, t: (de: string, en: string) => string) {
  const labels: Record<string, [string, string]> = {
    planned: ["Geplant", "Planned"],
    active: ["Aktiv", "Active"],
    paused: ["Pausiert", "Paused"],
    completed: ["Abgeschlossen", "Completed"],
    archived: ["Archiviert", "Archived"],
    ready: ["Bereit", "Ready"],
    in_progress: ["In Arbeit", "In progress"],
    blocked: ["Blockiert", "Blocked"],
    done: ["Erledigt", "Done"],
    canceled: ["Abgebrochen", "Canceled"],
    running: ["Läuft", "Running"],
    queued: ["Wartet", "Queued"],
    failed: ["Fehlgeschlagen", "Failed"],
    input_required: ["Rückmeldung nötig", "Input required"],
    waiting: ["Wartet auf Team", "Waiting for team"],
    booked: ["Gebucht", "Booked"],
    stopped: ["Gestoppt", "Stopped"],
    low: ["Niedrig", "Low"],
    medium: ["Mittel", "Medium"],
    high: ["Hoch", "High"],
  };
  return labels[value] ? t(...labels[value]) : value;
}
const iso = (v: FormDataEntryValue | null) =>
  v ? new Date(String(v)).toISOString() : null;
const local = (v?: string | null) =>
  v
    ? new Date(Date.parse(v) - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
function useOrganisation(project?: string, section = "projects") {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api("suite/organisation?section=" + section));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project, section]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, body);
      await load();
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { data, error, busy, act, load };
}
export function ProjectContext({ state }: { state: Snapshot }) {
  const { t } = useLanguage(),
    pathname = usePathname(),
    router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = state.workspace.project_id!;
  const section = pathname.startsWith("/projects/")
    ? (pathname.split("/")[3] ?? "projects")
    : pathname.slice(1).split("/")[0];
  const current = ["routines"].includes(section)
    ? "timeline"
    : ["knowledge"].includes(section)
      ? "memory"
      : ["environments", "project-settings", "settings"].includes(section)
        ? "projectSettings"
        : section;
  return (
    <section
      className="project-context project-context-v2"
      aria-label={t("Projektbereich", "Project area")}
    >
      <div className="project-context-top">
        <Link href="/projects" className="project-back">
          ← {t("Alle Projekte", "All projects")}
        </Link>
        <label>
          <span>{t("Projekt", "Project")}</span>
          <select
            aria-label={t("Aktives Projekt", "Active project")}
            value={id}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true);
              setError("");
              try {
                await selectProject(e.target.value);
                router.push(projectPath(e.target.value));
              } catch {
                setError(
                  t(
                    "Projektauswahl konnte nicht gespeichert werden.",
                    "Could not save project selection.",
                  ),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {((state as any).projects ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="project-context-tools">
          <Link
            href={projectPath(id, "chat")}
            aria-current={section === "chat" ? "page" : undefined}
          >
            {t("Teamchat", "Team chat")}
          </Link>
          <Link href={projectPath(id, "knowledge")}>
            {t("Suchen", "Search")}
          </Link>
          <Link
            href={projectPath(id, "projectSettings")}
            aria-current={current === "projectSettings" ? "page" : undefined}
          >
            {t("Einstellungen", "Settings")}
          </Link>
        </div>
      </div>
      <nav
        className="project-work-tabs"
        aria-label={t("Projektnavigation", "Project navigation")}
      >
        {[
          ["projects", t("Übersicht", "Overview")],
          ["tasks", t("Aufträge", "Tasks")],
          ["files", t("Ergebnisse & Dateien", "Results & files")],
          ["studio", t("Content-Studio", "Content Studio")],
          ["research", t("Recherche", "Research")],
          ["memory", t("Wissen", "Knowledge")],
          ["timeline", t("Planung", "Planning")],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={projectPath(id, key as any)}
            aria-current={current === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {["timeline", "routines"].includes(section) && (
        <nav
          className="project-subnav"
          aria-label={t("Planungsbereiche", "Planning sections")}
        >
          <Link
            href={projectPath(id, "timeline")}
            aria-current={section === "timeline" ? "page" : undefined}
          >
            Timeline
          </Link>
          <Link
            href={projectPath(id, "routines")}
            aria-current={section === "routines" ? "page" : undefined}
          >
            {t("Routinen", "Routines")}
          </Link>
        </nav>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function WorkspaceProjects({
  state,
  newTask,
}: {
  state: Snapshot;
  newTask?: () => void;
}) {
  const { t, number } = useLanguage(),
    router = useRouter(),
    { data, error, busy, act } = useOrganisation(state.workspace.project_id),
    [edit, setEdit] = useState<any>(undefined);
  const pathname = usePathname();
  const isManagement = pathname === "/projects";
  const isSettings =
    pathname.endsWith("/settings") || pathname === "/project-settings";
  useEffect(() => {
    if (edit !== undefined)
      document
        .getElementById("project-editor")
        ?.scrollIntoView({ block: "start" });
  }, [edit]);
  const manage = ["owner", "admin"].includes(
    state.workspace.membership_role ?? "owner",
  );
  if (!data)
    return (
      <p role="status">
        {error || t("Projekte werden geladen …", "Loading projects …")}
      </p>
    );
  const p = data.project;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const result = await act("suite/work-projects", {
      ...(edit?.id ? { id: edit.id, revision: edit.revision } : {}),
      name: f.get("name"),
      description: f.get("description"),
      status: f.get("status"),
      all_agents: f.get("all_agents") === "on",
      agent_ids: f.getAll("agent_ids"),
      credit_limit: Number(f.get("credits")),
      token_limit: Number(f.get("tokens")),
      target_at: iso(f.get("target")),
    });
    if (result) {
      setEdit(undefined);
      if (!isManagement) {
        await selectProject(result.id);
        router.push("/projects/" + result.id);
      }
    }
  };
  return (
    <section className="organisation-suite">
      <div className="section-title">
        <div>
          <h1>
            {isManagement
              ? t("Projekte verwalten", "Manage projects")
              : isSettings
                ? t("Projekteinstellungen", "Project settings")
                : t("Projektübersicht", "Project overview")}
          </h1>
          <p>
            {t(
              "Ein Projekt verbindet Ziele, Agenten, Aufträge, Wissen und Ergebnisse. Ein Repository oder Container ist optional.",
              "A project connects goals, agents, tasks, knowledge and results. A repository or container is optional.",
            )}
          </p>
        </div>
        {manage && (isManagement || isSettings) && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => setEdit(isSettings ? p : null)}
          >
            {isSettings
              ? t("Projekt bearbeiten", "Edit project")
              : t("Projekt anlegen", "Create project")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {isManagement ? (
        <ProjectManager
          data={data}
          manage={manage}
          busy={busy}
          onEdit={setEdit}
          selectedId={state.workspace.project_id ?? ""}
          statusLabel={(status) => phase(status, t)}
        />
      ) : !isSettings ? (
        <ProjectOverview
          data={data}
          manage={manage}
          newTask={newTask}
          onEdit={() => router.push(projectPath(p.id, "projectSettings"))}
          statusLabel={(status) => phase(status, t)}
        />
      ) : null}
      {edit !== undefined && (
        <form
          className="panel settings-panel"
          onSubmit={submit}
          id="project-editor"
          key={edit?.id ?? "new"}
        >
          <h2>
            {edit
              ? t("Projekt bearbeiten", "Edit project")
              : t("Neues Projekt", "New project")}
          </h2>
          <div className="form-grid">
            <label className="field">
              <span>{t("Name", "Name")}</span>
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={edit?.name}
              />
            </label>
            <label className="field">
              <span>Status</span>
              <select name="status" defaultValue={edit?.status ?? "active"}>
                {["planned", "active", "paused", "completed", "archived"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {phase(s, t)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span>{t("Gesamtes Creditlimit", "Total credit limit")}</span>
              <input
                name="credits"
                type="number"
                min={0}
                max={2147483647}
                defaultValue={edit?.credit_limit ?? 10000}
                required
              />
            </label>
            <label className="field">
              <span>{t("Gesamtes Tokenlimit", "Total token limit")}</span>
              <input
                name="tokens"
                type="number"
                min={0}
                max={1000000000000}
                defaultValue={edit?.token_limit ?? 100000}
                required
              />
            </label>
            <label className="field">
              <span>
                {t("Zieltermin (freiwillig)", "Target date (optional)")}
              </span>
              <input
                name="target"
                type="datetime-local"
                defaultValue={local(edit?.target_at)}
              />
            </label>
          </div>
          <label className="field">
            <span>{t("Ziel und Umfang", "Goal and scope")}</span>
            <textarea
              name="description"
              maxLength={8000}
              defaultValue={edit?.description}
              rows={3}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="all_agents"
              defaultChecked={edit?.all_agents ?? false}
            />
            {t(
              "Alle Workspace-Agenten zulassen, einschließlich zukünftiger Agenten",
              "Allow all workspace agents, including future agents",
            )}
          </label>
          <fieldset>
            <legend>
              {t("Oder nur diese Agenten", "Or only these agents")}
            </legend>
            <div className="organisation-choices">
              {data.agents.map((a: any) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    name="agent_ids"
                    value={a.id}
                    defaultChecked={edit ? edit.agent_ids.includes(a.id) : true}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="form-note">
            {t(
              "Projektlimits gelten gemeinsam für alle Aufträge und Reservierungen. Vorhandenes Kontoguthaben und Auftragslimits gelten zusätzlich. „Allgemein / Bestand“ bewahrt deine bisherigen Daten.",
              "Project limits cover all tasks and reservations together. Account balance and task limits also apply. “Allgemein / Bestand” preserves your existing data.",
            )}
          </p>
          <div className="organisation-actions">
            <button disabled={busy} className="primary">
              {t("Projekt speichern", "Save project")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEdit(undefined)}
            >
              {t("Abbrechen", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {isSettings && (
        <>
          <div className="button-row">
            <Link
              className="button secondary"
              href={projectPath(p.id, "environments")}
            >
              {t("Projektumgebungen öffnen", "Open project environments")} →
            </Link>
          </div>
          {manage && (
            <section className="panel settings-panel">
              <h2>
                {t(
                  "Umgebung diesem Projekt zuordnen",
                  "Assign an environment to this project",
                )}
              </h2>
              <p>
                {t(
                  "Eine Umgebung gehört genau zu einem Projekt. Alle Dateien darin sind für dessen berechtigte Agenten erreichbar. Für getrennte Daten getrennte Umgebungen buchen. Ein Wechsel ist nur gestoppt und ohne offene Aktionen möglich; gespeicherte Dateien bleiben erhalten.",
                  "An environment belongs to exactly one project. Its files are reachable by that project’s authorised agents. Book separate environments for separate data. Reassignment requires a stopped environment with no pending actions; existing files remain.",
                )}
              </p>
              <div className="organisation-actions">
                {data.environments
                  .filter((e: any) => e.project_id === p.id)
                  .map((e: any) => (
                    <span className="badge" key={e.id}>
                      {e.name} · {phase(e.status, t)}
                    </span>
                  ))}
              </div>
              <form
                className="organisation-actions"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await act("suite/environment-project", {
                    id: f.get("environment"),
                    project_id: p.id,
                  });
                }}
              >
                <label className="field">
                  <span>
                    {t(
                      "Gestoppte Umgebung auswählen",
                      "Choose stopped environment",
                    )}
                  </span>
                  <select name="environment" required>
                    <option value="">{t("Auswählen …", "Choose …")}</option>
                    {data.environments
                      .filter(
                        (e: any) =>
                          e.project_id !== p.id &&
                          ["booked", "stopped"].includes(e.status),
                      )
                      .map((e: any) => (
                        <option key={e.id} value={e.id}>
                          {e.name} · {phase(e.status, t)}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  disabled={
                    busy ||
                    !data.environments.some(
                      (e: any) =>
                        e.project_id !== p.id &&
                        ["booked", "stopped"].includes(e.status),
                    )
                  }
                  className="secondary"
                >
                  {t("Zuordnen", "Assign")}
                </button>
              </form>
            </section>
          )}
          <MaterialSharing project={p.id} manage={manage} />
          <TeamPackage state={state} />
        </>
      )}
    </section>
  );
}
function MaterialSharing({
  project,
  manage,
}: {
  project: string;
  manage: boolean;
}) {
  const { t } = useLanguage(),
    [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  const load = useCallback(
    () => api("suite/material-sharing").then((d) => setRows(d.items)),
    [project],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  return (
    <section className="panel settings-panel">
      <h2>{t("Gemeinsame Materialien", "Shared materials")}</h2>
      <p>
        {t(
          "Standardmäßig bleiben Dateien, Gedächtnis und Skills im Projekt. Eine Freigabe macht den Inhalt für die anderen Projekte dieses Workspace lesbar.",
          "Files, memory and skills stay inside their project by default. Sharing makes the content readable in other projects of this workspace.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {rows.length ? (
        <div className="organisation-materials">
          {rows.map((r) => (
            <label key={r.kind + r.id}>
              <span>
                {r.name} <small>{r.kind}</small>
              </span>
              <input
                type="checkbox"
                aria-label={
                  t("Workspace-weit freigeben: ", "Share across workspace: ") +
                  r.name
                }
                checked={r.workspace_shared}
                disabled={!manage}
                onChange={async (e) => {
                  try {
                    await api("suite/material-sharing", {
                      kind: r.kind,
                      id: r.id,
                      workspace_shared: e.target.checked,
                    });
                    await load();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <p>
          {t(
            "Noch keine Materialien in diesem Projekt.",
            "No materials in this project yet.",
          )}
        </p>
      )}
    </section>
  );
}
export function WorkTimeline({ state }: { state: Snapshot }) {
  const { t } = useLanguage(),
    router = useRouter(),
    { data, error, busy, act } = useOrganisation(
      state.workspace.project_id,
      "timeline",
    ),
    [editing, setEditing] = useState<any>(undefined);
  if (!data)
    return (
      <p role="status">{error || t("Plan wird geladen …", "Loading plan …")}</p>
    );
  const canEdit = (state.workspace.membership_role ?? "owner") !== "viewer",
    p = data.project;
  const agents = data.agents.filter(
    (a: any) => p.all_agents || p.agent_ids.includes(a.id),
  );
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const saved = await act("suite/plan", {
      ...(editing?.id ? { id: editing.id, revision: editing.revision } : {}),
      project_id: p.id,
      title: f.get("title"),
      agent_id: f.get("agent") || null,
      status: f.get("status"),
      planned_start: iso(f.get("start")),
      target_at: iso(f.get("end")),
      estimate_min: f.get("min") ? Number(f.get("min")) : null,
      estimate_max: f.get("max") ? Number(f.get("max")) : null,
      confidence: f.get("confidence"),
      dependencies: f.getAll("dependencies"),
      locked: f.get("locked") === "on",
    });
    if (saved) setEditing(undefined);
  };
  const periodEnd = Date.now();
  const periods: TimelineItem[] = data.periods
    .filter((r: any) => r.started_at)
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      agentId: r.agent_id,
      agentName: data.agents.find((a: any) => a.id === r.agent_id)?.name ?? "—",
      status: r.status,
      statusLabel: phase(r.status, t),
      start: Date.parse(r.started_at),
      end: Math.max(
        Date.parse(r.started_at),
        r.ended_at
          ? Date.parse(r.ended_at)
          : r.status === "running"
            ? periodEnd
            : Date.parse(r.updated_at),
      ),
      href: "/tasks/" + r.run_id,
      details: [
        {
          label: t("Tokens des Auftrags", "Task-run tokens"),
          value: Number(r.tokens_used ?? 0).toLocaleString(),
        },
      ],
    }));
  return (
    <section className="organisation-suite">
      <div className="section-title">
        <div>
          <h1>{t("Plan & Timeline", "Plan & timeline")}</h1>
          <p>
            {p.name} ·{" "}
            {t(
              "Geplante Schritte und tatsächlich ausgeführte Arbeit.",
              "Planned steps and actual execution.",
            )}
          </p>
        </div>
        {canEdit && (
          <button className="primary" onClick={() => setEditing(null)}>
            {t("Schritt planen", "Plan a step")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <p className="form-note">
        {t(
          "Zeitangaben sind Schätzungen, keine Zusagen. Abhängigkeiten und geplante Startzeiten werden beim Start serverseitig berücksichtigt. Ein Schritt wird nicht automatisch zu einem kostenpflichtigen Auftrag; „Auftrag starten“ erstellt ihn innerhalb aller Budgets.",
          "Times are estimates, not promises. Dependencies and planned start times are enforced when execution begins. A plan step does not automatically become a paid task; “Start task” creates it within all budgets.",
        )}
      </p>
      <PlannedTimeline items={data.items} agents={data.agents} />
      <div className="panel settings-panel">
        <h2>{t("Geplante Arbeit", "Planned work")}</h2>
        {data.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    t("Schritt / Abhängigkeiten", "Step / dependencies"),
                    "Agent",
                    t("Zeit / Schätzung", "Time / estimate"),
                    "Status",
                    t("Aktionen", "Actions"),
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((i: any) => (
                  <tr key={i.id} id={"plan-step-" + i.id}>
                    <td>
                      <strong>{i.title}</strong>
                      {i.locked && " 🔒"}
                      <small>
                        {i.dependencies
                          .map(
                            (d: string) =>
                              data.items.find((x: any) => x.id === d)?.title ??
                              d,
                          )
                          .join(" → ")}
                      </small>
                    </td>
                    <td>
                      {data.agents.find((a: any) => a.id === i.agent_id)
                        ?.name ?? "—"}
                    </td>
                    <td>
                      {i.planned_start
                        ? new Date(i.planned_start).toLocaleString()
                        : "—"}
                      <br />
                      {i.target_at
                        ? new Date(i.target_at).toLocaleString()
                        : "—"}
                      <small>
                        {i.estimate_min ?? "?"}–{i.estimate_max ?? "?"} min ·{" "}
                        {phase(i.confidence, t)}
                      </small>
                      {i.target_at &&
                        Date.parse(i.target_at) < Date.now() &&
                        !["done", "completed", "canceled"].includes(
                          i.run_status ?? i.status,
                        ) && (
                          <span className="badge">
                            {t("Zieltermin überschritten", "Target overdue")}
                          </span>
                        )}
                    </td>
                    <td>{phase(i.run_status ?? i.status, t)}</td>
                    <td>
                      <div className="organisation-actions">
                        {i.run_id ? (
                          <Link href={"/tasks/" + i.run_id}>
                            {t("Auftrag öffnen", "Open task")}
                          </Link>
                        ) : (
                          canEdit &&
                          i.agent_id &&
                          ["planned", "ready"].includes(i.status) && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={async () => {
                                const r = await act("runs", {
                                  goal: i.title,
                                  agentId: i.agent_id,
                                  projectId: p.id,
                                  planItemId: i.id,
                                });
                                if (r) router.push("/tasks/" + r.id);
                              }}
                            >
                              {t("Auftrag starten", "Start task")}
                            </button>
                          )
                        )}
                        {canEdit && (
                          <button
                            className="secondary"
                            onClick={() => setEditing(i)}
                          >
                            {t("Bearbeiten", "Edit")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            {t(
              "Noch kein Plan. Du und die Agenten können Schritte mit Zuständigkeit, Zeitfenster und Abhängigkeiten ergänzen.",
              "No plan yet. You and the agents can add steps with owners, time windows and dependencies.",
            )}
          </p>
        )}
      </div>
      {editing !== undefined && (
        <form
          className="panel settings-panel"
          onSubmit={submit}
          key={editing?.id ?? "new"}
        >
          <h2>{t("Planschritt", "Plan step")}</h2>
          <label className="field">
            <span>{t("Arbeitsschritt", "Work step")}</span>
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={editing?.title}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Agent</span>
              <select name="agent" defaultValue={editing?.agent_id ?? ""}>
                <option value="">{t("Noch offen", "Unassigned")}</option>
                {agents.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select name="status" defaultValue={editing?.status ?? "planned"}>
                {[
                  "planned",
                  "ready",
                  "in_progress",
                  "blocked",
                  "done",
                  "canceled",
                ].map((s) => (
                  <option key={s} value={s}>
                    {phase(s, t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Geplanter Start", "Planned start")}</span>
              <input
                type="datetime-local"
                name="start"
                defaultValue={local(editing?.planned_start)}
              />
            </label>
            <label className="field">
              <span>{t("Zieltermin", "Target date")}</span>
              <input
                type="datetime-local"
                name="end"
                defaultValue={local(editing?.target_at)}
              />
            </label>
            <label className="field">
              <span>
                {t("Schätzung von (Minuten)", "Estimate from (minutes)")}
              </span>
              <input
                type="number"
                min={1}
                max={525600}
                name="min"
                defaultValue={editing?.estimate_min ?? ""}
              />
            </label>
            <label className="field">
              <span>
                {t("Schätzung bis (Minuten)", "Estimate to (minutes)")}
              </span>
              <input
                type="number"
                min={1}
                max={525600}
                name="max"
                defaultValue={editing?.estimate_max ?? ""}
              />
            </label>
            <label className="field">
              <span>
                {t("Sicherheit der Schätzung", "Estimate confidence")}
              </span>
              <select
                name="confidence"
                defaultValue={editing?.confidence ?? "low"}
              >
                <option value="low">{t("Niedrig", "Low")}</option>
                <option value="medium">{t("Mittel", "Medium")}</option>
                <option value="high">{t("Hoch", "High")}</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>{t("Vorher abschließen", "Complete first")}</legend>
            <div className="organisation-choices">
              {data.items
                .filter((i: any) => i.id !== editing?.id)
                .map((i: any) => (
                  <label key={i.id}>
                    <input
                      name="dependencies"
                      type="checkbox"
                      value={i.id}
                      defaultChecked={editing?.dependencies.includes(i.id)}
                    />
                    {i.title}
                  </label>
                ))}
            </div>
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              name="locked"
              defaultChecked={editing?.locked ?? false}
            />
            {t(
              "Vor Änderungen durch Agenten schützen",
              "Protect from agent edits",
            )}
          </label>
          <div className="organisation-actions">
            <button className="primary" disabled={busy}>
              {t("Plan speichern", "Save plan")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(undefined)}
            >
              {t("Schließen", "Close")}
            </button>
          </div>
        </form>
      )}
      <section className="panel settings-panel timeline-panel">
        <h2>{t("Tatsächliche Ausführung", "Actual execution")}</h2>
        <InteractiveTimeline
          label={t(
            "Zeitachse der tatsächlichen Agentenarbeit",
            "Timeline of actual agent work",
          )}
          items={periods}
          agents={data.agents}
          domain={{ start: periodEnd - 31 * 86400000, end: periodEnd }}
          initial={{ start: periodEnd - 7 * 86400000, end: periodEnd }}
          history
        />
        <small>
          {t(
            "Neue Aufgaben haben genaue Start- und Endzeitpunkte. Bei älteren Aufgaben werden vorhandene Ereignisse je Agent und Auftrag verwendet. Delegationen sind im Auftrag nachvollziehbar.",
            "New tasks have exact start and end timestamps. Older tasks use available agent/run events. Delegation details are available in each task.",
          )}
        </small>
      </section>
    </section>
  );
}
export function OrganisationChart({ state }: { state: Snapshot }) {
  const { t } = useLanguage(),
    { data, error, busy, act } = useOrganisation(
      state.workspace.project_id,
      "organisation",
    ),
    [agents, setAgents] = useState<any[]>([]);
  useEffect(() => {
    if (data) setAgents(data.agents);
  }, [data]);
  if (!data)
    return (
      <p role="status">
        {error || t("Organisation wird geladen …", "Loading organisation …")}
      </p>
    );
  const manage = ["owner", "admin"].includes(
      state.workspace.membership_role ?? "owner",
    ),
    policy = data.policy;
  const update = (id: string, values: any) =>
    setAgents((old) => old.map((a) => (a.id === id ? { ...a, ...values } : a)));
  const node = (a: any, depth = 0): any => (
    <li key={a.id}>
      <article className="org-agent">
        <strong>
          {a.name}
          {a.structure_locked ? " 🔒" : ""}
        </strong>
        <span>{a.role}</span>
        <small>
          {a.execution_paused ? t("Pausiert", "Paused") : t("Aktiv", "Active")}{" "}
          ·{" "}
          {a.can_manage
            ? t("Manager", "Manager")
            : t("Teammitglied", "Team member")}
        </small>
        <small>
          {a.monthly_credit_limit
            ? t("Monatslimit: ", "Monthly limit: ") +
              a.monthly_credit_limit +
              " Credits"
            : t(
                "Projekt- und Auftragslimits gelten",
                "Project and task limits apply",
              )}
        </small>
      </article>
      {depth < 50 && agents.some((x) => x.manager_id === a.id) && (
        <ul>
          {agents
            .filter((x) => x.manager_id === a.id)
            .map((x) => node(x, depth + 1))}
        </ul>
      )}
    </li>
  );
  return (
    <section className="organisation-suite">
      <h1>{t("Agentenorganisation", "Agent organisation")}</h1>
      <p>
        {t(
          "Berichtswege steuern Zuständigkeiten und Eskalationen. Sie verleihen keine zusätzlichen Datei-, Container- oder MCP-Rechte.",
          "Reporting lines define responsibilities and escalations. They do not grant extra file, container or MCP permissions.",
        )}
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <section className="panel settings-panel">
        <h2>
          {t("Organigramm", "Organisation chart")}
          {policy.locked ? " 🔒" : ""}
        </h2>
        <div className="org-chart">
          <ul>
            {agents
              .filter(
                (a) =>
                  !a.manager_id || !agents.some((x) => x.id === a.manager_id),
              )
              .map((a) => node(a))}
          </ul>
        </div>
      </section>
      {manage && (
        <>
          <form
            className="panel settings-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              await act("suite/organisation", {
                action: "structure",
                revision: policy.revision,
                agents: agents.map(
                  ({
                    id,
                    manager_id,
                    structure_locked,
                    can_manage,
                    monthly_credit_limit,
                  }) => ({
                    id,
                    manager_id,
                    structure_locked,
                    can_manage,
                    monthly_credit_limit,
                  }),
                ),
              });
            }}
          >
            <h2>{t("Struktur bearbeiten", "Edit structure")}</h2>
            <p>
              {t(
                "Als Nutzer kannst du auch gesperrte Beziehungen ändern. Agenten müssen die Sperren einhalten.",
                "You can edit locked relationships. Agents must respect the locks.",
              )}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>{t("Berichtet an", "Reports to")}</th>
                    <th>{t("Geschützt", "Locked")}</th>
                    <th>Manager</th>
                    <th>
                      {t(
                        "Monatslimit Credits (0 = Projektlimit)",
                        "Monthly credit cap (0 = project limit)",
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>
                        <select
                          aria-label={
                            t("Vorgesetzter für ", "Manager for ") + a.name
                          }
                          value={a.manager_id ?? ""}
                          onChange={(e) =>
                            update(a.id, { manager_id: e.target.value || null })
                          }
                        >
                          <option value="">
                            {t("Direkt an dich", "Reports to you")}
                          </option>
                          {agents
                            .filter((m) => m.id !== a.id)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={
                            t("Beziehung sperren: ", "Lock relationship: ") +
                            a.name
                          }
                          checked={a.structure_locked}
                          onChange={(e) =>
                            update(a.id, { structure_locked: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={
                            t("Managerrechte: ", "Manager role: ") + a.name
                          }
                          checked={a.can_manage}
                          onChange={(e) =>
                            update(a.id, { can_manage: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={
                            t("Monatslimit für ", "Monthly cap for ") + a.name
                          }
                          type="number"
                          min={0}
                          max={10000000}
                          value={a.monthly_credit_limit}
                          onChange={(e) =>
                            update(a.id, {
                              monthly_credit_limit: Number(e.target.value),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="primary" disabled={busy}>
              {t("Organigramm speichern", "Save organisation chart")}
            </button>
          </form>
          <form
            className="panel settings-panel"
            key={policy.revision}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await act("suite/organisation", {
                action: "policy",
                revision: policy.revision,
                locked: f.get("locked") === "on",
                hiring: f.get("hiring"),
                allowed_roles: String(f.get("roles"))
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                allowed_models: f.getAll("models"),
                max_hires: Number(f.get("max")),
                max_depth: Number(f.get("depth")),
                hire_credit_limit: Number(f.get("credits")),
              });
            }}
          >
            <h2>
              {t(
                "Selbstorganisation & neue Agenten",
                "Self-organisation & new agents",
              )}
            </h2>
            <label className="check">
              <input
                name="locked"
                type="checkbox"
                defaultChecked={policy.locked}
              />
              {t(
                "Gesamte Struktur für Agenten sperren",
                "Lock entire structure for agents",
              )}
            </label>
            <div className="form-grid">
              <label className="field">
                <span>{t("Neue Agenten", "New agents")}</span>
                <select name="hiring" defaultValue={policy.hiring}>
                  <option value="off">{t("Gesperrt", "Disabled")}</option>
                  <option value="approval">
                    {t(
                      "Immer im Entscheidungs-Postfach freigeben",
                      "Always require inbox approval",
                    )}
                  </option>
                  <option value="automatic">
                    {t(
                      "Automatisch innerhalb der folgenden Grenzen",
                      "Automatic within the limits below",
                    )}
                  </option>
                </select>
              </label>
              <label className="field">
                <span>
                  {t(
                    "Automatisch erlaubte Rollen (Komma)",
                    "Automatically allowed roles (comma-separated)",
                  )}
                </span>
                <input
                  name="roles"
                  defaultValue={policy.allowed_roles.join(", ")}
                />
              </label>
              <label className="field">
                <span>
                  {t(
                    "Maximal automatisch angelegte Agenten",
                    "Maximum automatically created agents",
                  )}
                </span>
                <input
                  name="max"
                  type="number"
                  min={0}
                  max={50}
                  defaultValue={policy.max_hires}
                />
              </label>
              <label className="field">
                <span>
                  {t("Maximale Hierarchietiefe", "Maximum hierarchy depth")}
                </span>
                <input
                  name="depth"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={policy.max_depth}
                />
              </label>
              <label className="field">
                <span>
                  {t(
                    "Maximales Monatsbudget je automatisch angelegtem Agenten",
                    "Maximum monthly credits per automatically created agent",
                  )}
                </span>
                <input
                  name="credits"
                  type="number"
                  min={0}
                  max={10000000}
                  defaultValue={policy.hire_credit_limit}
                />
              </label>
            </div>
            <fieldset>
              <legend>
                {t(
                  "Automatisch erlaubte Modelle",
                  "Automatically allowed models",
                )}
              </legend>
              <div className="organisation-choices">
                {state.models.map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      name="models"
                      value={m.id}
                      defaultChecked={policy.allowed_models.includes(m.id)}
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="form-note">
              {t(
                "Das Planlimit und gemeinsame Projektbudgets gelten immer. Neue Agenten erhalten keine MCP-Verbindungen, Skills oder Containerrechte automatisch. Strukturänderungen durch Agenten benötigen weiterhin eine konkrete Freigabe.",
                "Plan limits and shared project budgets always apply. New agents receive no MCP connections, skills or container permissions automatically. Agent-proposed reporting-line changes still need explicit approval.",
              )}
            </p>
            <button className="primary" disabled={busy}>
              {t("Regeln speichern", "Save rules")}
            </button>
          </form>
        </>
      )}
      <details className="panel settings-panel">
        <summary>{t("Änderungsverlauf", "Change history")}</summary>
        {data.history.map((h: any, i: number) => (
          <p key={i}>
            <time>{new Date(h.created_at).toLocaleString()}</time> · {h.kind}
          </p>
        ))}
      </details>
    </section>
  );
}
function TeamPackage({ state }: { state: Snapshot }) {
  const { t } = useLanguage(),
    [text, setText] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!["owner", "admin"].includes(state.workspace.membership_role ?? "owner"))
    return null;
  async function action(body: any) {
    setBusy(true);
    setError("");
    try {
      return await api("suite/templates", body);
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel settings-panel">
      <summary>
        {t("Starterteams, Export & Import", "Starter teams, export & import")}
      </summary>
      <p>
        {t(
          "Enthält Rollen, Berichtswege, Skills und Routinen dieses Projekts. Keine Schlüssel, Container oder Auftragsdateien. Freitext vor Weitergabe trotzdem vollständig prüfen.",
          "Includes this project’s roles, reporting lines, skills and routines. No keys, containers or task files. Still review all free text before sharing.",
        )}
      </p>
      <div className="starter-team-gallery">
        {starterTeams.map((team) => (
          <article className="panel" key={team.id}>
            <h3>{team.name}</h3>
            <p>{team.description}</p>
            <ul>
              {team.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
            <small>
              {t(
                "Budgetvorschlag, kein zusätzliches Guthaben:",
                "Suggested token budget, no additional balance:",
              )}{" "}
              {team.suggestedTokens.toLocaleString()}
            </small>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setText(JSON.stringify(team.package, null, 2));
                setPreview(null);
                setReviewed(false);
              }}
            >
              {t("Vorlage prüfen", "Review template")}
            </button>
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          const r = await action({ action: "export" });
          if (r) {
            setText(JSON.stringify(r.package, null, 2));
            setPreview(null);
            setReviewed(false);
          }
        }}
      >
        {t("Export zur Prüfung anzeigen", "Show export for review")}
      </button>
      <label className="field">
        <span>
          {t(
            "Vorlagenpaket (JSON, maximal 500 KB)",
            "Template package (JSON, maximum 500 KB)",
          )}
        </span>
        <textarea
          rows={10}
          value={text}
          maxLength={500000}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setReviewed(false);
          }}
        />
      </label>
      <div className="organisation-actions">
        <button
          className="secondary"
          disabled={busy || !text}
          onClick={() => {
            const blob = new Blob([text], { type: "application/json" }),
              url = URL.createObjectURL(blob),
              a = document.createElement("a");
            a.href = url;
            a.download = "kerncloud-team.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          {t("Angezeigten Inhalt herunterladen", "Download displayed content")}
        </button>
        <button
          className="secondary"
          disabled={busy || !text}
          onClick={async () => {
            try {
              setPreview(
                await action({ action: "preview", package: JSON.parse(text) }),
              );
            } catch {
              setError(t("Ungültiges JSON", "Invalid JSON"));
            }
          }}
        >
          {t("Importvorschau prüfen", "Review import preview")}
        </button>
      </div>
      {preview && (
        <div className="form-note" style={{ display: "block" }}>
          <p>{preview.warning}</p>
          <p>
            {preview.counts.agents} {t("Agenten", "agents")} ·{" "}
            {preview.counts.skills} Skills · {preview.counts.routines}{" "}
            {t("Routinen", "routines")}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {t(
              "Inhalt und Verhalten geprüft; pausiert importieren",
              "Content and behaviour reviewed; import paused",
            )}
          </label>
          <button
            className="primary"
            disabled={busy || !reviewed}
            onClick={async () => {
              const r = await action({
                action: "import",
                package: preview.package,
                preview_hash: preview.digest,
                reviewed: true,
              });
              if (r) {
                await selectProject(r.project_id);
                window.location.assign("/projects/" + r.project_id);
              }
            }}
          >
            {t("Als neues Projekt importieren", "Import as new project")}
          </button>
        </div>
      )}
    </details>
  );
}

function PlannedTimeline({ items, agents }: { items: any[]; agents: any[] }) {
  const { t } = useLanguage();
  const dated: TimelineItem[] = items
    .filter((i) => i.planned_start && i.status !== "canceled")
    .map((i) => ({
      id: i.id,
      title: i.title,
      agentId: i.agent_id ?? "unassigned",
      agentName:
        agents.find((a) => a.id === i.agent_id)?.name ??
        t("Noch offen", "Unassigned"),
      status: "planned",
      statusLabel: phase(i.run_status ?? i.status, t),
      start: Date.parse(i.planned_start),
      end: i.target_at
        ? Date.parse(i.target_at)
        : Date.parse(i.planned_start) +
          (i.estimate_max ?? i.estimate_min ?? 5) * 60000,
      href: i.run_id ? "/tasks/" + i.run_id : "#plan-step-" + i.id,
      linkLabel: i.run_id
        ? t("Auftrag öffnen", "Open task")
        : t("Planschritt ansehen", "View plan step"),
      details: [
        {
          label: t("Schätzung", "Estimate"),
          value:
            (i.estimate_min ?? "?") + "–" + (i.estimate_max ?? "?") + " min",
        },
        { label: t("Sicherheit", "Confidence"), value: phase(i.confidence, t) },
        {
          label: t("Abhängigkeiten", "Prerequisites"),
          value: String(i.dependencies.length),
        },
      ],
    }));
  if (!dated.length) return null;
  const start = Math.min(...dated.map((i) => i.start)),
    end = Math.max(start + 60000, ...dated.map((i) => i.end)),
    pad = Math.max(60000, (end - start) * 0.05);
  const domain = { start: start - pad, end: end + pad };
  const team = agents.filter((a) => dated.some((i) => i.agentId === a.id));
  if (dated.some((i) => i.agentId === "unassigned"))
    team.push({ id: "unassigned", name: t("Noch offen", "Unassigned") });
  return (
    <section className="panel settings-panel timeline-panel">
      <h2>{t("Geplante Zeitfenster", "Planned time windows")}</h2>
      <InteractiveTimeline
        items={dated}
        agents={team}
        domain={domain}
        initial={domain}
        label={t(
          "Zeitachse des geplanten Projektablaufs",
          "Timeline of planned project work",
        )}
      />
      <small>
        {t(
          "Lila Balken sind Planangaben. Abhängigkeiten und tatsächlicher Fortschritt stehen in der Tabelle darunter.",
          "Purple bars are plans. Dependencies and actual progress are shown in the table below.",
        )}
      </small>
    </section>
  );
}
