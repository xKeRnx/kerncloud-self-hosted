"use client";
import { useState, useEffect } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function ProjectPages({
  state,
  artifacts = [],
}: {
  state: any;
  artifacts?: any[];
}) {
  const { t, date } = useLanguage();
  const [pages, setPages] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState(""),
    [history, setHistory] = useState<Record<string, any[]>>({});
  const project = state.workspace.project_id;
  const url = "project-pages?projectId=" + encodeURIComponent(project);
  const load = () => api<any>(url).then((d) => setPages(d.pages));
  useEffect(() => {
    let live = true;
    void api<any>(url)
      .then((d) => {
        if (live) setPages(d.pages);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [url]);
  const files = artifacts.filter((f: any) => !f.retired && !f.binary_bytes);
  async function write(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const existing = pages.find((p) => p.id === f.get("page"));
      await api(url, {
        id: existing?.id,
        title: f.get("title"),
        artifactId: f.get("artifact"),
        expectedRevision: existing?.revision,
        confirmPublicUpdate: f.get("public") === "on",
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sharing(p: any) {
    if (
      !p.shared &&
      !confirm(
        t(
          "Seite und eingebundene Dateien geprüft? Der Link zeigt auch ausdrücklich bestätigte zukünftige Änderungen und ist 7 Tage gültig.",
          "Have you reviewed the page and bundled files? The link also shows explicitly confirmed future updates and expires in 7 days.",
        ),
      )
    )
      return;
    setError("");
    setBusy(true);
    try {
      const r = await api<any>(
        "project-pages/" + p.id + "/sharing?projectId=" + project,
        { enabled: !p.shared, reviewed: true, expectedRevision: p.revision },
      );
      setLink(r.url ? window.location.origin + r.url : "");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel project-pages">
      <h2>{t("Projektseiten", "Project pages")}</h2>
      <p>
        {t(
          "Berichte und Dashboards bleiben unter derselben Seite erreichbar. Änderungen erzeugen neue Versionen.",
          "Reports and dashboards keep the same page identity. Updates create new versions.",
        )}
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {pages.map((p) => (
        <article key={p.id} className="project-result-row">
          <div>
            <strong>{p.title}</strong>
            <small>
              v{p.revision} · {date(p.updated_at)} ·{" "}
              {p.shared ? t("Geteilt", "Shared") : t("Privat", "Private")}
            </small>
          </div>
          <div className="button-row">
            <a
              className="button secondary"
              href={
                "/api/project-pages/" + p.id + "/preview?projectId=" + project
              }
              target="_blank"
              rel="noreferrer"
            >
              {t("Öffnen / PDF drucken", "Open / print PDF")}
            </a>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void api<any>(
                  "project-pages/" + p.id + "/versions?projectId=" + project,
                )
                  .then((d) =>
                    setHistory((h) => ({ ...h, [p.id]: d.versions })),
                  )
                  .catch((e) => setError(e.message))
              }
            >
              {t("Versionen", "Versions")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void sharing(p)}
            >
              {p.shared
                ? t("Link widerrufen", "Revoke link")
                : t("Freigabelink erstellen", "Create sharing link")}
            </button>
          </div>
          {history[p.id] && (
            <div className="button-row project-page-history">
              {history[p.id].map((v) => (
                <a
                  key={v.revision}
                  className="button secondary"
                  target="_blank"
                  rel="noreferrer"
                  href={
                    "/api/project-pages/" +
                    p.id +
                    "/versions/" +
                    v.revision +
                    "/preview?projectId=" +
                    project
                  }
                >
                  v{v.revision} · {date(v.created_at)}
                </a>
              ))}
            </div>
          )}
        </article>
      ))}
      {link && (
        <label className="field">
          <span>{t("Freigabelink", "Sharing link")}</span>
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
        </label>
      )}
      <details>
        <summary>
          {t("Seite erstellen oder aktualisieren", "Create or update a page")}
        </summary>
        <form onSubmit={write} className="settings-form page-edit-form">
          <label>
            {t("Seite", "Page")}
            <select name="page">
              <option value="">{t("Neue Seite", "New page")}</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · v{p.revision}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Titel", "Title")}
            <input name="title" maxLength={180} required />
          </label>
          <label>
            {t("Ergebnisdatei", "Result artifact")}
            <select name="artifact" required>
              <option value="">{t("Datei auswählen", "Choose file")}</option>
              {files.map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input name="public" type="checkbox" />
            {t(
              "Diese geprüfte Änderung darf auch auf einem bestehenden Freigabelink erscheinen.",
              "This reviewed update may also appear on an existing public link.",
            )}
          </label>
          <button className="primary" disabled={busy || !files.length}>
            {t("Version speichern", "Save version")}
          </button>
        </form>
      </details>
    </section>
  );
}
