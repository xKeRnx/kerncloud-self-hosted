"use client";
import { useLanguage } from "./language";
import { useEffect, useState } from "react";
import {
  Brain,
  Plus,
  Download,
  Search,
  Pin,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import type { MemoryEntry, Snapshot } from "@/src/core/types";
import { api } from "./api-client";
import type { Save } from "./materials-panel";
import { MemorySource, MemoryExclusions } from "./memory-source";
const kinds = {
  knowledge: "Wissen",
  decision: "Entscheidung",
  work: "Arbeitspaket",
  history: "Arbeitsverlauf",
};
const statuses = {
  open: "Offen",
  in_progress: "In Arbeit",
  blocked: "Blockiert",
  done: "Erledigt",
};
function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { ui, localeTag } = useLanguage();

  return (
    <label className="field">
      <span>{title}</span>
      {children}
    </label>
  );
}
export function MemoryPanel({ state, save }: { state: Snapshot; save: Save }) {
  const { ui, localeTag, t } = useLanguage();

  const [entries, setEntries] = useState<MemoryEntry[]>([]),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<MemoryEntry | null | undefined>(undefined),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const revisions = state.memory.map((m) => `${m.id}:${m.revision}`).join(",");
  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(() => {
      void api<{ entries: MemoryEntry[] }>(
        `memory?q=${encodeURIComponent(query)}`,
      )
        .then((r) => {
          if (!canceled) setEntries(r.entries);
        })
        .catch((e) => {
          if (!canceled) setError(e.message);
        });
    }, 200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [query, revisions, refresh]);
  const edit = (entry?: MemoryEntry) => {
    setError("");
    setEditing(entry ?? null);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {ui("DAS GEMEINSAME GEDÄCHTNIS DEINES TEAMS")}
          </div>
          <h1>{ui("Projektgedächtnis")}</h1>
          <p>
            {ui(
              "Was ist bekannt, was wurde entschieden und welche Arbeit ist noch offen?",
            )}
          </p>
        </div>
        <button className="primary" onClick={() => edit()}>
          <Plus size={16} />
          {ui("Eintrag hinzufügen")}
        </button>
      </div>
      <div className="form-note">
        <Brain size={20} />
        <div>
          {ui(
            "Agenten können Einträge suchen, lesen und Arbeitsstände aktualisieren. Geschützte Einträge kannst nur du ändern. „Erledigt“ bezeichnet einen gespeicherten Arbeitsstand; „Von mir geprüft“ bestätigst du selbst nach Sichtung der Belege. Bei Code-Reviews muss weiterhin der aktuelle Quellstand geprüft werden.",
          )}
        </div>
      </div>
      <div className="memory-toolbar">
        <label className="memory-search">
          <Search size={17} />
          <span className="sr-only">{ui("Projektgedächtnis durchsuchen")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ui(
              "Wissen, Entscheidungen und Arbeiten durchsuchen …",
            )}
          />
        </label>
        <a className="secondary" href="/api/memory/export" download>
          <Download size={16} />
          {ui("knowledge.md herunterladen")}
        </a>
        <span className="subtle-chip">
          {state.memory.length}
          {ui(" / 100 Einträge")}
        </span>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {editing !== undefined && (
        <section className="panel settings-panel">
          <h2>{editing ? ui("Eintrag bearbeiten") : ui("Neuer Eintrag")}</h2>
          <form
            key={`${editing?.key ?? "new"}-${editing?.revision ?? 0}`}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await save("memory", {
                  key: f.get("key"),
                  title: f.get("title"),
                  content: f.get("content"),
                  kind: f.get("kind"),
                  status: f.get("status"),
                  evidence: f.get("evidence"),
                  expected_revision: editing?.revision ?? null,
                  pinned: f.get("pinned") === "on",
                  verified: f.get("verified") === "on",
                  assignee: f.get("assignee") || null,
                  expires_at: f.get("expires_at")
                    ? new Date(String(f.get("expires_at")) + "Z").toISOString()
                    : null,
                  ...(f.get("source_ref")
                    ? {
                        source_refs: [
                          {
                            kind: String(f.get("source_ref")).split(":")[0],
                            id: String(f.get("source_ref")).split(":")[1],
                          },
                        ],
                      }
                    : {}),
                });
                setEditing(undefined);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <Field title={ui("Schlüssel")}>
                <input
                  name="key"
                  defaultValue={editing?.key}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}"
                  placeholder={ui("z. B. support.wissensbasis")}
                  readOnly={Boolean(editing)}
                  required
                />
                <small>
                  {ui(
                    "Stabiler Name, unter dem alle Agenten den Eintrag finden.",
                  )}
                </small>
              </Field>
              <Field title={ui("Titel")}>
                <input
                  name="title"
                  defaultValue={editing?.title}
                  maxLength={150}
                  required
                />
              </Field>
              <Field title={ui("Art")}>
                <select name="kind" defaultValue={editing?.kind ?? "knowledge"}>
                  {Object.entries(kinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {ui(v)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title={ui("Arbeitsstand")}>
                <select name="status" defaultValue={editing?.status ?? "open"}>
                  {Object.entries(statuses).map(([k, v]) => (
                    <option key={k} value={k}>
                      {ui(v)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title={ui("Zuständiger Agent")}>
                <select name="assignee" defaultValue={editing?.assignee ?? ""}>
                  <option value="">{ui("Noch nicht zugewiesen")}</option>
                  {state.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              title={t(
                "Gültig bis (UTC, optional)",
                "Valid until (UTC, optional)",
              )}
            >
              <input
                type="datetime-local"
                name="expires_at"
                defaultValue={editing?.expires_at?.slice(0, 16) ?? ""}
              />
            </Field>
            <Field
              title={t("Originalquelle hinzufügen", "Add original source")}
            >
              <select name="source_ref" defaultValue="">
                <option value="">
                  {t("Keine zusätzliche Quelle", "No additional source")}
                </option>
                {state.runs.map((r) => (
                  <option key={r.id} value={"run:" + r.id}>
                    {r.goal.slice(0, 100)}
                  </option>
                ))}
              </select>
            </Field>
            <Field title={ui("Inhalt")}>
              <textarea
                name="content"
                defaultValue={editing?.content}
                rows={8}
                maxLength={8000}
                required
                placeholder={ui(
                  "Bestehende Funktionen, Entscheidungen, offene Schritte oder wichtige Projektdaten …",
                )}
              />
            </Field>
            <Field title={ui("Belege und Quellen")}>
              <textarea
                name="evidence"
                defaultValue={editing?.evidence}
                rows={2}
                maxLength={2000}
                placeholder={ui(
                  "Datei, Ergebnis, Testprotokoll oder Repository-Commit. Bei erledigter Arbeit erforderlich.",
                )}
              />
            </Field>
            <label className="check-row">
              <input
                name="pinned"
                type="checkbox"
                defaultChecked={editing?.pinned}
              />
              {ui("Vor Änderungen durch Agenten schützen")}
            </label>
            <label className="check-row">
              <input
                name="verified"
                type="checkbox"
                defaultChecked={editing?.verified}
              />
              {ui("Von mir anhand der Belege geprüft")}
            </label>
            <div className="button-row">
              <button className="primary" disabled={busy}>
                {busy ? ui("Wird gespeichert …") : ui("Eintrag speichern")}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(undefined)}
              >
                {ui("Abbrechen")}
              </button>
              {editing && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setEditing(
                      entries.find((e) => e.key === editing.key) ?? editing,
                    )
                  }
                >
                  {ui("Aktuelle Version laden")}
                </button>
              )}
            </div>
          </form>
        </section>
      )}
      <MemoryExclusions
        workspaceId={state.workspace.id}
        refresh={refresh}
        changed={() => setRefresh((v) => v + 1)}
      />
      <div className="memory-grid">
        {entries.map((entry) => (
          <article key={entry.id} className="panel memory-card">
            <div className="panel-heading">
              <span className="subtle-chip">{ui(kinds[entry.kind])}</span>
              <span
                className={`badge status-${entry.status === "done" ? "completed" : entry.status === "in_progress" ? "running" : entry.status === "blocked" ? "input_required" : "queued"}`}
              >
                {ui(statuses[entry.status])}
              </span>
            </div>
            <h3>{entry.title}</h3>
            <div className="memory-meta">
              <code>{entry.key}</code>
              <span>Version {entry.revision}</span>
              {entry.pinned && (
                <span>
                  <Pin size={12} />
                  {ui("Geschützt")}
                </span>
              )}
              {entry.verified ? (
                <span>
                  <CheckCircle2 size={12} />
                  {ui("Von dir geprüft")}
                </span>
              ) : (
                <span>{ui("Unbestätigt")}</span>
              )}
            </div>
            <div className="memory-copy">{entry.content}</div>
            <MemorySource
              entry={entry}
              changed={() => setRefresh((v) => v + 1)}
            />
            {entry.evidence && (
              <div className="memory-evidence">
                <b>{ui("Belege / Quellen")}</b>
                <p>{entry.evidence}</p>
              </div>
            )}
            <small className="muted">
              {entry.assignee
                ? ui("Zuständig: {0} · ", [
                    state.agents.find((a) => a.id === entry.assignee)?.name ??
                      "Agent",
                  ])
                : ""}
              {entry.automatic
                ? ui("Automatischer Arbeitsverlauf")
                : ui("Projektwissen")}{" "}
              · {new Date(entry.updated_at).toLocaleString(localeTag)}
            </small>
            <div className="button-row">
              <button className="secondary" onClick={() => edit(entry)}>
                {ui("Bearbeiten")}
              </button>
              <button
                className="icon-button"
                aria-label={ui("{0} löschen", [entry.title])}
                onClick={() => {
                  if (
                    window.confirm(
                      ui(
                        "„{0}“ und seine gespeicherten Versionen aus dem Projektgedächtnis löschen?",
                        [entry.title],
                      ),
                    )
                  )
                    void save("memory/delete", {
                      key: entry.key,
                      expected_revision: entry.revision,
                    }).catch((e) => setError(e.message));
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!entries.length && (
        <section className="panel empty">
          <Brain size={30} />
          <h3>
            {query
              ? ui("Keine passenden Einträge")
              : ui("Hier wächst dein Projektgedächtnis")}
          </h3>
          <p>
            {ui(
              "Halte wichtige Entscheidungen und offene Arbeit fest. Abgeschlossene Aufträge hinterlassen automatisch einen unbestätigten Arbeitsvermerk.",
            )}
          </p>
        </section>
      )}
      <p className="muted memory-retention">
        {ui(
          "Projektwissen und manuell bearbeitete Einträge bleiben bis zu ihrer Löschung erhalten. Automatische Arbeitsvermerke folgen der Workspace-Aufbewahrungsfrist, solange sie nicht geschützt sind. Keine API-Schlüssel oder Passwörter als Projektwissen speichern.",
        )}
      </p>
    </>
  );
}
