"use client";
import { useEffect, useState } from "react";
import { Download, Eye, FileText, Code2, RotateCcw } from "lucide-react";
import type { Artifact, Run, Task } from "@/src/core/types";
import { useLanguage } from "./language";
import { previewKind } from "@/src/core/artifacts";

export function RunResults({
  run,
  tasks,
  files,
  workspaceId,
  retry,
}: {
  run: Run;
  tasks: Task[];
  files: Artifact[];
  workspaceId: string;
  retry: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [chosen, setChosen] = useState<string>(""),
    [mode, setMode] = useState<"preview" | "source">("preview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const file =
    files.find((f) => f.id === chosen) ??
    files.find((f) => previewKind(f.name) === "html") ??
    files[0];
  const url = (path: string) =>
    `/api/${path}?workspaceId=${encodeURIComponent(workspaceId)}`;
  const [source, setSource] = useState<{ id: string; content: string } | null>(
      null,
    ),
    [sourceError, setSourceError] = useState("");
  useEffect(() => {
    if (mode !== "source" || !file) return;
    let live = true;
    setSourceError("");
    fetch(url("artifacts/" + file.id + "/source"), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            t(
              "Quelltext konnte nicht geladen werden.",
              "Could not load source.",
            ),
          );
        return r.json();
      })
      .then((data) => {
        if (live) setSource({ id: file.id, content: data.content });
      })
      .catch((e) => {
        if (live) setSourceError(e.message);
      });
    return () => {
      live = false;
    };
  }, [mode, file?.id, workspaceId]);
  const finished = ["completed", "failed", "canceled"].includes(run.status);
  const missing =
    finished &&
    !files.length &&
    !tasks.some(
      (t) =>
        t.status === "completed" &&
        t.result?.trim() &&
        t.result !== "Keine Antwort.",
    );
  return (
    <section
      className="panel run-results"
      aria-label={t("Arbeitsergebnisse", "Deliverables")}
    >
      <div className="panel-heading">
        <div>
          <h2>
            <FileText size={19} />
            {t("Arbeitsergebnisse", "Deliverables")}
          </h2>
          <p>
            {t(
              "Dateien ansehen, Vorschau öffnen und Ergebnisse mitnehmen.",
              "Inspect files, open previews and download your results.",
            )}
          </p>
        </div>
        <a className="secondary" href={url(`runs/${run.id}/download`)} download>
          <Download size={16} />
          {t("Alles als ZIP", "Download ZIP")}
        </a>
      </div>
      {run.usage_uncertain && (
        <p className="form-note warning-text" role="status">
          {t(
            "Tokenverbrauch teilweise unbekannt: Unbestätigte Schätzungen werden nicht als gemessener Verbrauch angezeigt.",
            "Some token usage is unknown: unconfirmed estimates are not displayed as measured usage.",
          )}
        </p>
      )}
      {missing && (
        <div className="form-note warning-text" role="status">
          {t(
            "Für diesen Auftrag wurde kein verwertbares Ergebnis geliefert. „Keine Antwort“ ist kein erfolgreicher Abschluss. Prüfe die Fehlermeldung und die Modelleinstellungen.",
            "This task did not produce a usable result. “No answer” is not a successful completion. Check the error and model settings.",
          )}
        </div>
      )}
      {tasks
        .filter(
          (task) => task.status === "failed" && (task.error || task.result),
        )
        .map((task) => (
          <p key={task.id} role="alert" className="result-error">
            {task.error || task.result}
          </p>
        ))}
      {files.length > 0 ? (
        <>
          <div className="result-toolbar">
            <label className="field">
              <span>{t("Ergebnisdatei", "Result file")}</span>
              <select
                value={file.id}
                onChange={(e) => setChosen(e.target.value)}
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <a
              className="secondary"
              href={url(`artifacts/${file.id}/download`)}
              download
            >
              <Download size={16} />
              {t("Datei herunterladen", "Download file")}
            </a>
          </div>
          <div
            className="result-tabs"
            role="group"
            aria-label={t("Ergebnisansicht", "Result view")}
          >
            <button
              className={mode === "preview" ? "active" : ""}
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              <Eye size={16} />
              {t("Vorschau", "Preview")}
            </button>
            <button
              className={mode === "source" ? "active" : ""}
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              <Code2 size={16} />
              {t("Quelltext", "Source")}
            </button>
          </div>
          {mode === "preview" ? (
            <>
              <p className="muted result-preview-note">
                {t(
                  "Isolierte Vorschau: HTML/CSS/JavaScript einschließlich Animationen und mitgelieferter lokaler Dateien. Externe Anfragen, Formulare und Serverfunktionen sind gesperrt. React-/Backend-Projekte benötigen ihre Entwicklungsumgebung.",
                  "Isolated preview: HTML/CSS/JavaScript, including animations and bundled local files. External requests, forms and server functions are blocked. React/backend projects require their development environment.",
                )}
              </p>
              <iframe
                key={file.id}
                className="result-preview"
                title={t("Vorschau: ", "Preview: ") + file.name}
                src={url(`artifacts/${file.id}/preview`)}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            </>
          ) : (
            <pre className="result-source">
              {sourceError ||
                (source?.id === file.id
                  ? source.content
                  : t("Quelltext wird geladen …", "Loading source …"))}
            </pre>
          )}
          <details className="result-file-list">
            <summary>
              {t("Alle Dateien", "All files")} ({files.length})
            </summary>
            {files.map((f) => (
              <div key={f.id}>
                <button className="text-button" onClick={() => setChosen(f.id)}>
                  <FileText size={14} />
                  {f.name}
                </button>
                <a
                  href={url(`artifacts/${f.id}/download`)}
                  download
                  aria-label={t("Herunterladen: ", "Download: ") + f.name}
                >
                  <Download size={15} />
                </a>
              </div>
            ))}
          </details>
        </>
      ) : (
        <p className="result-empty">
          {t(
            "Noch keine gespeicherten Dateien. Hier erscheinen die von deinem Team erstellten Dateien. Textantworten und der Auftragsstatus sind im ZIP enthalten.",
            "No saved files yet. Files created by your team appear here. Text answers and task status are included in the ZIP.",
          )}
        </p>
      )}
      {finished && (
        <div className="result-retry">
          <div>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await retry();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RotateCcw size={15} />
              {busy
                ? t("Wird gestartet …", "Starting …")
                : t("Neuen Versuch starten", "Start a new attempt")}
            </button>
            <small>
              {t(
                "Erstellt einen neuen Auftrag mit demselben Ziel, denselben Agenten und Anhängen sowie aktueller Modellauswahl. Bisherige externe Aktionen vorher prüfen; der neue Versuch kann API-Verbrauch verursachen.",
                "Creates a new task with the same goal, agents and attachments, using their current model selection. Check previous external actions first; the new attempt may incur API usage.",
              )}
            </small>
          </div>
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
