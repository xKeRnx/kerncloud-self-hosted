"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "./api-client";
import { useLanguage } from "./language";
import { useWorkspaceResource } from "./workspace-home";
export function ProjectResults({ state }: { state: any }) {
  const { t, date } = useLanguage(),
    [before, setBefore] = useState<string | undefined>(),
    [history, setHistory] = useState<(string | undefined)[]>([]);
  const { data, error, busy } = useWorkspaceResource(
    "project/results?projectId=" +
      encodeURIComponent(state.workspace.project_id) +
      (before ? "&before=" + encodeURIComponent(before) : ""),
    state,
  );
  return (
    <section>
      <header className="workspace-page-heading">
        <div>
          <h1>{t("Ergebnisse & Dateien", "Results & files")}</h1>
          <p>
            {t(
              "Erstellte Dateien dieses Projekts. Jeder Eintrag führt zum Auftrag mit Vorschau und Download.",
              "Files created in this project. Each entry links to its task with preview and downloads.",
            )}
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <section className="panel">
        {!data ? (
          <p className="workspace-empty" role="status">
            {t("Ergebnisse werden geladen …", "Loading results …")}
          </p>
        ) : data.items.length ? (
          data.items.map((f: any) => (
            <article className="project-result-row" key={f.id}>
              <div>
                <strong>{f.name}</strong>
                <small>
                  {f.title} · {date(f.created_at)}
                </small>
              </div>
              <div className="button-row">
                <Link className="button secondary" href={"/tasks/" + f.run_id}>
                  {t("Auftrag & Vorschau", "Task & preview")}
                </Link>
                <a
                  className="button secondary"
                  download
                  href={
                    "/api/artifacts/" +
                    f.id +
                    "/download?workspaceId=" +
                    encodeURIComponent(state.workspace.id)
                  }
                >
                  {t("Herunterladen", "Download")}
                </a>
              </div>
            </article>
          ))
        ) : (
          <p className="workspace-empty">
            {t(
              "Noch keine Ergebnisdateien in diesem Projekt.",
              "No result files in this project yet.",
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
