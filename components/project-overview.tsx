"use client";
import Link from "next/link";
import { projectPath } from "../src/core/navigation";
import {
  FolderKanban,
  Activity,
  Coins,
  FileText,
  Server,
  Users,
  ArrowUpRight,
} from "lucide-react";
import { useLanguage } from "./language";
export function ProjectOverview({
  data,
  manage,
  onEdit,
  statusLabel,
  newTask,
}: {
  data: any;
  manage: boolean;
  onEdit: (project: any) => void;
  statusLabel: (status: string) => string;
  newTask?: () => void;
}) {
  const { t, number, localeTag } = useLanguage(),
    p = data.project,
    s = data.stats ?? {},
    percentage = s.runs ? Math.round((s.completed / s.runs) * 100) : 0;
  const title = (goal: string) => {
    const first = goal.split(/\r?\n/, 1)[0];
    return first.length > 110 ? first.slice(0, 107) + "…" : first;
  };
  return (
    <>
      <section className="panel project-overview">
        <div className="project-overview-heading">
          <div>
            <span className="project-status-pill">
              {statusLabel(p.status)} ·{" "}
              {t("Ausgewähltes Projekt", "Selected project")}
            </span>
            <h2>{p.name}</h2>
            <p>
              {p.description ||
                t(
                  "Beschreibe Ziel und Umfang, damit dein Team weiß, worauf es hinarbeitet.",
                  "Describe the goal and scope so your team knows what to work towards.",
                )}
            </p>
          </div>
          <div className="organisation-actions">
            {newTask && (
              <button className="primary" onClick={newTask}>
                {t("Neuer Auftrag", "New task")}
              </button>
            )}
            {manage && (
              <button className="secondary" onClick={() => onEdit(p)}>
                {t("Projekt bearbeiten", "Edit project")}
              </button>
            )}
            <Link
              className="button secondary"
              href={projectPath(p.id, "timeline")}
            >
              {t("Timeline öffnen", "Open timeline")}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
        <div className="project-kpi-grid">
          {[
            [
              FolderKanban,
              t("Aufträge", "Tasks"),
              number(s.runs ?? 0),
              (s.completed ?? 0) + " " + t("abgeschlossen", "completed"),
            ],
            [
              Activity,
              t("Laufende Aufträge", "Running tasks"),
              number(s.running ?? 0),
              (s.waiting ?? 0) +
                " " +
                t("pausiert / warten auf Infos", "paused / awaiting input"),
            ],
            [
              Coins,
              t("KI-Credits verbraucht", "AI credits used"),
              number(s.credit_charged ?? 0),
              number(s.credit_reserved ?? 0) +
                " " +
                t("noch reserviert", "still reserved"),
            ],
            [
              Activity,
              t("Gemessene Tokens", "Measured tokens"),
              number(s.tokens_measured ?? 0),
              number(s.calls ?? 0) + " " + t("Modellaufrufe", "model calls"),
            ],
            [
              FileText,
              t("Dateien & Ergebnisse", "Files & results"),
              number((s.files ?? 0) + (s.artifacts ?? 0)),
              (s.files ?? 0) +
                " " +
                t("Uploads", "uploads") +
                " · " +
                (s.artifacts ?? 0) +
                " " +
                t("Ergebnisse", "results"),
            ],
            [
              Server,
              t("Umgebungen", "Environments"),
              number(s.environments ?? 0),
              (s.running_environments ?? 0) + " " + t("laufen", "running"),
            ],
          ].map(([Icon, label, value, hint]: any) => (
            <article className="project-kpi" key={label}>
              <div>
                <span>{label}</span>
                <Icon size={17} />
              </div>
              <strong>{value}</strong>
              <small>{hint}</small>
            </article>
          ))}
        </div>
        <div className="project-overview-bottom">
          <div>
            <div className="project-progress-label">
              <strong>{t("Auftragsstatus", "Task status")}</strong>
              <span>
                {s.completed ?? 0}/{s.runs ?? 0}{" "}
                {t("abgeschlossen", "completed")}
              </span>
            </div>
            <div
              className="project-progress-track"
              role="progressbar"
              aria-label={t("Abgeschlossene Aufträge", "Completed tasks")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <span style={{ width: percentage + "%" }} />
            </div>
            <small>
              {s.failed ?? 0} {t("fehlgeschlagen", "failed")} ·{" "}
              {s.canceled ?? 0} {t("abgebrochen", "canceled")} · {s.agents ?? 0}{" "}
              {t("Agenten zugeordnet", "assigned agents")} · {s.memories ?? 0}{" "}
              {t("Wissenseinträge", "memory entries")}
            </small>
          </div>
          <div>
            <strong>{t("Projektgrenzen", "Project limits")}</strong>
            <small>
              {t("Credits", "Credits")}:{" "}
              {p.is_default && Number(p.credit_limit) === 2147483647
                ? t("Kontolimits gelten", "Account limits apply")
                : number(p.credit_limit)}{" "}
              · {t("Tokens", "Tokens")}:{" "}
              {p.is_default && Number(p.token_limit) === 1000000000000
                ? t("Kontolimits gelten", "Account limits apply")
                : number(p.token_limit)}
            </small>
            <small>
              {t("Zieltermin", "Target date")}:{" "}
              {p.target_at
                ? new Date(p.target_at).toLocaleString(localeTag)
                : t("Nicht festgelegt", "Not set")}
            </small>
          </div>
        </div>
        <p className="project-metric-note">
          {number(s.byok_calls ?? 0)} BYOK ·{" "}
          {t(
            "Eigene Anbieter rechnen separat ab. Reservierungen sind keine bereits verbrauchten Credits.",
            "Your providers bill separately. Reservations are not credits already spent.",
          )}{" "}
          {(s.unmeasured_calls ?? 0) > 0 &&
            t(
              "Bei einigen Aufrufen fehlt die bestätigte Tokenmenge.",
              "Some calls have no confirmed token count.",
            )}
        </p>
      </section>
      <section className="panel project-recent">
        <div className="section-title">
          <h2>{t("Letzte Aufträge", "Recent tasks")}</h2>
          <Link href={projectPath(p.id, "tasks")}>
            {t("Alle Aufträge", "All tasks")} →
          </Link>
        </div>
        {data.recent_runs?.length ? (
          <div className="project-recent-list">
            {data.recent_runs.map((run: any) => (
              <Link key={run.id} href={"/tasks/" + run.id}>
                <div>
                  <strong>{title(run.goal)}</strong>
                  <small>
                    {new Date(run.updated_at).toLocaleString(localeTag)}
                  </small>
                </div>
                <span className={"badge status-" + run.status}>
                  {statusLabel(run.status)}
                </span>
                <ArrowUpRight size={15} />
              </Link>
            ))}
          </div>
        ) : (
          <p>
            {t(
              "Noch keine Aufträge in diesem Projekt. Starte unter „Aufträge“ mit einem klaren Ziel.",
              "No tasks in this project yet. Start with a clear goal under “Tasks”.",
            )}
          </p>
        )}
      </section>
    </>
  );
}
