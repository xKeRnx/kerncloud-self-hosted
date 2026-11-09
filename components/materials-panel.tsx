"use client";
import { useLanguage } from "./language";
import { useRef, useState } from "react";
import {
  Paperclip,
  Upload,
  GitBranch,
  Trash2,
  FileText,
  X,
} from "lucide-react";
import type { Attachment, Snapshot } from "@/src/core/types";
import { api } from "./api-client";
export type Save = (
  path: string,
  body: unknown,
  method?: string,
  message?: string,
) => Promise<any>;
export function FileUpload({
  save,
  done,
  compact = false,
}: {
  save: Save;
  done?: (ids: string[]) => void;
  compact?: boolean;
}) {
  const { ui, localeTag, t } = useLanguage();

  const input = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const upload = async (files: FileList | File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    try {
      const result = await save(
        "attachments/upload",
        form,
        "POST",
        ui("Dateien hochgeladen."),
      );
      done?.(result.ids);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div
      className={compact ? "upload-inline" : "upload-zone"}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) void upload(e.dataTransfer.files);
      }}
    >
      <input
        hidden
        type="file"
        ref={input}
        multiple
        accept=".txt,.md,.mdx,.csv,.tsv,.json,.jsonl,.xml,.html,.css,.scss,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.c,.cpp,.h,.hpp,.cs,.php,.sh,.sql,.yaml,.yml,.toml,.ini,.log,.svg,.rst,.pdf,.docx"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
        }}
        aria-label={ui("Dateien auswählen")}
      />
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={16} />
        {busy
          ? ui("Dateien werden gelesen …")
          : compact
            ? ui("Dateien anhängen")
            : ui("Dateien hochladen")}
      </button>
      {!compact && (
        <p>
          {ui(
            "Dateien hier ablegen · Text, Code, PDF, DOCX · bis 5 MB je Datei, maximal 500 KB lesbarer Text",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function AttachmentPicker({
  files,
  ids,
  onChange,
}: {
  files: Attachment[];
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const { ui, localeTag, t } = useLanguage();

  return (
    <div className="attachment-picker">
      {files.map((f) => (
        <label key={f.id} className="check-row">
          <input
            type="checkbox"
            checked={ids.includes(f.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...ids, f.id]
                  : ids.filter((id) => id !== f.id),
              )
            }
          />
          <FileText size={14} />
          {f.name}
        </label>
      ))}
      {!files.length && (
        <p>
          {t(
            "Noch keine Dateien in diesem Projekt.",
            "No files in this project yet.",
          )}
        </p>
      )}
    </div>
  );
}
export function RunAttachments({
  initial,
  save,
}: {
  initial: Attachment[];
  save: Save;
}) {
  const { ui, localeTag, t } = useLanguage();

  const [files, setFiles] = useState(initial),
    [ids, setIds] = useState<string[]>([]);
  return (
    <div className="field">
      <span>{ui("Dateien & Repository-Snapshots für diesen Auftrag")}</span>
      <FileUpload
        compact
        save={save}
        done={(more) => {
          setIds((old) => [...new Set([...old, ...more])]);
          void api<Snapshot>("state").then((s) => setFiles(s.attachments));
        }}
      />
      <AttachmentPicker files={files} ids={ids} onChange={setIds} />
      {ids.map((id) => (
        <input key={id} type="hidden" name="attachments" value={id} />
      ))}
    </div>
  );
}
export function MaterialsPanel({
  files,
  save,
}: {
  files: Attachment[];
  save: Save;
}) {
  const { ui, localeTag, t } = useLanguage();

  const [preview, setPreview] = useState<{
      name: string;
      content: string;
      source: string;
    } | null>(null),
    [error, setError] = useState(""),
    [importing, setImporting] = useState(false),
    [notice, setNotice] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("WISSEN FÜR DEIN TEAM")}</div>
          <h1>{ui("Dateien & Repositories")}</h1>
          <p>
            {ui(
              "Ordne Dateien beim Start eines Auftrags oder direkt im Teamchat zu.",
            )}
          </p>
        </div>
        <span className="subtle-chip">
          {files.length}
          {ui(" / 100 Dateien")}
        </span>
      </div>
      <section className="panel settings-panel">
        <FileUpload save={save} />
      </section>
      <section className="panel settings-panel">
        <h2>
          <GitBranch size={18} />
          {ui(" GitHub-Repository importieren")}
        </h2>
        <p>
          {ui(
            "Importiert einen begrenzten Text-Snapshot mit Commit-ID. Kein Klonen, Ausführen oder Pushen. Bei größeren Repositories werden bis zu zwölf Textdateien und ein Dateibaum übernommen.",
          )}
        </p>
        <form
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setImporting(true);
            setError("");
            try {
              const r = await save("attachments/github", {
                url: f.get("github_repository_url"),
                branch: f.get("github_ref") || undefined,
                token: f.get("github_access_token") || undefined,
              });
              setNotice(
                ui("{0} von {1} geeigneten Dateien importiert. Commit {2}.", [
                  r.imported,
                  r.available,
                  r.commit.slice(0, 8),
                ]),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setImporting(false);
            }
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{ui("GitHub-Repository-URL")}</span>
              <input
                name="github_repository_url"
                autoComplete="off"
                type="url"
                placeholder="https://github.com/owner/repository"
                required
              />
            </label>
            <label className="field">
              <span>{ui("Branch oder Commit (optional)")}</span>
              <input
                name="github_ref"
                autoComplete="off"
                placeholder={ui("Standardbranch")}
                maxLength={150}
              />
            </label>
            <label className="field">
              <span>{ui("GitHub-Token (nur bei Bedarf)")}</span>
              <input
                name="github_access_token"
                type="password"
                autoComplete="new-password"
                placeholder={ui("Privates Repo oder höheres API-Limit")}
                maxLength={2000}
              />
              <small>
                {ui(
                  "Nur für diesen Import verwendet, nicht gespeichert. Benötigt Lesezugriff auf das Repository.",
                )}
              </small>
            </label>
          </div>
          <button className="secondary" disabled={importing}>
            <GitBranch size={16} />
            {importing
              ? ui("Repository wird importiert …")
              : ui("Snapshot importieren")}
          </button>
        </form>
        {notice && <p role="status">{notice}</p>}
      </section>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>{ui("Dateibibliothek")}</h2>
          <small>{ui("Bis 20 MB Text pro Workspace")}</small>
        </div>
        <div className="file-list">
          {files.map((f) => (
            <article key={f.id}>
              <FileText size={20} />
              <div>
                <button
                  className="text-button"
                  onClick={() =>
                    void api<{ name: string; content: string; source: string }>(
                      `attachments/${f.id}`,
                    )
                      .then(setPreview)
                      .catch((e) => setError(e.message))
                  }
                >
                  {f.name}
                </button>
                <small>
                  {f.source} · {(f.bytes / 1000).toFixed(1)}
                  {ui(" KB Text")}
                </small>
              </div>
              <button
                className="icon-button"
                aria-label={ui("{0} löschen", [f.name])}
                onClick={() =>
                  void save(
                    `attachments/${f.id}`,
                    {},
                    "DELETE",
                    ui("Datei gelöscht."),
                  ).catch((e) => setError(e.message))
                }
              >
                <Trash2 size={16} />
              </button>
            </article>
          ))}
          {!files.length && (
            <div className="empty">
              <Upload size={28} />
              <h3>{ui("Dein Team braucht Ausgangsmaterial")}</h3>
              <p>{ui("Lade Dokumente hoch oder importiere ein Repository.")}</p>
            </div>
          )}
        </div>
      </section>
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={ui("Dateivorschau")}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{preview.name}</h2>
              <button
                className="icon-button"
                aria-label={ui("Schließen")}
                onClick={() => setPreview(null)}
              >
                <X size={18} />
              </button>
            </header>
            <small>{preview.source}</small>
            <pre className="file-preview">{preview.content}</pre>
          </section>
        </div>
      )}
    </>
  );
}
