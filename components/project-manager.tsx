"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  FolderKanban,
  Search,
  ArrowUpRight,
  Pencil,
  CheckCircle2,
} from "lucide-react";
import { useLanguage } from "./language";
export function ProjectManager({
  data,
  manage,
  busy,
  onEdit,
  selectedId,
  statusLabel,
}: {
  data: any;
  manage: boolean;
  busy: boolean;
  onEdit: (p: any) => void;
  selectedId: string;
  statusLabel: (s: string) => string;
}) {
  const { t, number, date } = useLanguage();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const all = data.projects ?? [];
  const shown = useMemo(
    () =>
      all.filter(
        (p: any) =>
          (status === "all" || p.status === status) &&
          [p.name, p.description]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    [all, status, query],
  );
  return (
    <section
      className="project-manager"
      aria-label={t("Alle Workspace-Projekte", "All workspace projects")}
    >
      <div className="project-manager-summary">
        {[
          [t("Projekte insgesamt", "Total projects"), all.length],
          [
            t("Aktiv", "Active"),
            all.filter((p: any) => p.status === "active").length,
          ],
          [
            t("Pausiert", "Paused"),
            all.filter((p: any) => p.status === "paused").length,
          ],
          [
            t("Archiviert", "Archived"),
            all.filter((p: any) => p.status === "archived").length,
          ],
        ].map(([label, value]) => (
          <div className="panel" key={label}>
            <span>{label}</span>
            <strong>{number(Number(value))}</strong>
          </div>
        ))}
      </div>
      <div className="panel project-manager-filters">
        <label className="field">
          <span>
            <Search size={14} />
            {t("Projekte durchsuchen", "Search projects")}
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Name oder Beschreibung", "Name or description")}
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{t("Alle Status", "All statuses")}</option>
            {["planned", "active", "paused", "completed", "archived"].map(
              (s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <p className="project-manager-hint">
        {shown.length}/{all.length}{" "}
        {t(
          "Projekte · Bearbeiten ändert das Projekt, ohne deine aktuelle Auswahl zu wechseln. Öffnen wählt es aus und speichert die Auswahl in deinem Konto.",
          "projects · Editing updates a project without switching your current selection. Opening selects it and saves your choice to your account.",
        )}
      </p>
      <div className="project-manager-grid">
        {shown.map((p: any) => (
          <article
            className={
              "panel project-management-card" +
              (p.id === selectedId ? " selected" : "")
            }
            key={p.id}
          >
            <div className="project-management-card-top">
              <FolderKanban size={22} />
              <span className={"badge status-" + p.status}>
                {statusLabel(p.status)}
              </span>
              {p.id === selectedId && (
                <span className="project-selection-label">
                  <CheckCircle2 size={13} />
                  {t("Ausgewählt", "Selected")}
                </span>
              )}
            </div>
            <h2>{p.name}</h2>
            <p className="project-description">
              {p.description ||
                t("Noch keine Beschreibung.", "No description yet.")}
            </p>
            <dl>
              <div>
                <dt>{t("Aufträge", "Tasks")}</dt>
                <dd>
                  {number(p.completed ?? 0)}/{number(p.runs ?? 0)}{" "}
                  {t("abgeschlossen", "completed")}
                </dd>
              </div>
              <div>
                <dt>
                  {t(
                    "Credits verbraucht / reserviert",
                    "Credits used / reserved",
                  )}
                </dt>
                <dd>{number(Number(p.credit_used ?? 0))}</dd>
              </div>
              <div>
                <dt>{t("Zieltermin", "Target date")}</dt>
                <dd>
                  {p.target_at
                    ? date(p.target_at)
                    : t("Nicht festgelegt", "Not set")}
                </dd>
              </div>
            </dl>
            <div className="organisation-actions">
              <Link className="button secondary" href={"/projects/" + p.id}>
                {t("Projekt öffnen", "Open project")}
                <ArrowUpRight size={14} />
              </Link>
              {manage && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onEdit(p)}
                >
                  <Pencil size={14} />
                  {t("Bearbeiten", "Edit")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!shown.length && (
        <p className="panel project-manager-empty">
          {t(
            "Keine Projekte für diese Suche. Passe die Filter an oder lege ein Projekt an.",
            "No projects match this search. Adjust the filters or create a project.",
          )}
        </p>
      )}
    </section>
  );
}
