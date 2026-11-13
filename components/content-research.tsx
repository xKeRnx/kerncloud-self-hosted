"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import { moneyText, networks } from "../src/core/studio-research";
import {
  CalendarDays,
  Search,
  ShieldCheck,
  RefreshCw,
  FileText,
  Plus,
  ExternalLink,
} from "lucide-react";
const utcInput = (value: string) => new Date(value).toISOString().slice(0, 16);
const values = (f: FormData, key: string) => String(f.get(key) ?? "");
function useStudio(workspace: string, project: string) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = async () =>
    setData(await api("studio", undefined, "GET", { projectId: project }));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [workspace, project]);
  const act = async (body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r: any = await api("studio/action", body, "POST", {
        projectId: project,
      });
      await load();
      setNotice("Saved");
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { data, error, busy, notice, act, load };
}
export function ContentResearch({
  workspaceId,
  projectId,
  mode,
}: {
  workspaceId: string;
  projectId: string;
  mode: "studio" | "research";
}) {
  const { t } = useLanguage(),
    state = useStudio(workspaceId, projectId),
    { data, error, busy, notice, act, load } = state;
  const [edit, setEdit] = useState<any>(null),
    [jobId, setJobId] = useState(""),
    [job, setJob] = useState<any>(null),
    [queryError, setQueryError] = useState("");
  const manage = ["owner", "admin"].includes(data?.role);
  const publishing = (data?.connections ?? []).filter(
      (c: any) => c.provider === "ayrshare",
    ),
    research = (data?.connections ?? []).filter((c: any) =>
      ["tavily", "brave", "exa"].includes(c.provider),
    );
  const readJob = async (id = jobId) => {
    if (id)
      setJob(
        await api(
          "research/job?id=" + encodeURIComponent(id),
          undefined,
          "GET",
          { projectId },
        ),
      );
  };
  useEffect(() => {
    void readJob().catch((e) => setQueryError(e.message));
  }, [jobId]);
  return (
    <section className="studio-hub">
      <header className="workspace-page-heading">
        <div>
          <span className="scope-label">
            {mode === "studio"
              ? "PLAN · REVIEW · PUBLISH"
              : "SEARCH · SOURCES · REPORT"}
          </span>
          <h1>
            {mode === "studio"
              ? t("Content-Studio", "Content Studio")
              : t("Recherche-Zentrale", "Research")}
          </h1>
          <p>
            {mode === "studio"
              ? t(
                  "Entwürfe und Veröffentlichung mit Freigabe – für dieses Projekt.",
                  "Drafts and approved publishing, scoped to this project.",
                )
              : t(
                  "Begrenzte Recherche, wiederverwendbare Quellen und prüfbare Berichte.",
                  "Bounded research, reusable sources and reviewable reports.",
                )}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => {
            void load();
            void readJob().catch((e) => setQueryError(e.message));
          }}
        >
          <RefreshCw size={16} />
          {t("Aktualisieren", "Refresh")}
        </button>
      </header>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="info-box" role="status">
          {t("Gespeichert", "Saved")}
        </p>
      )}
      {data && (
        <>
          <ExternalBudget data={data} manage={manage} act={act} busy={busy} />
          {mode === "studio" ? (
            <>
              <div className="studio-metrics">
                <Metric
                  label={t("Entwürfe", "Drafts")}
                  value={
                    data.posts.filter((p: any) => p.status === "draft").length
                  }
                />
                <Metric
                  label={t("Zur Freigabe", "Awaiting review")}
                  value={
                    data.posts.filter((p: any) => p.status === "review").length
                  }
                />
                <Metric
                  label={t("Geplant", "Queued")}
                  value={
                    data.posts.filter((p: any) => p.status === "queued").length
                  }
                />
                <Metric
                  label={t("An Anbieter übergeben", "Submitted to provider")}
                  value={
                    data.posts.filter((p: any) => p.status === "submitted")
                      .length
                  }
                />
              </div>
              {manage && (
                <details className="panel studio-card" open>
                  <summary>
                    <Plus size={17} />
                    {edit
                      ? t("Entwurf bearbeiten", "Edit draft")
                      : t("Beitrag vorbereiten", "Prepare a post")}
                  </summary>
                  {!publishing.length ? (
                    <p className="form-note">
                      {t(
                        "Verbinde Ayrshare unter Integrationen und gib dieses Projekt frei.",
                        "Connect Ayrshare under Integrations and grant this project access.",
                      )}{" "}
                      <a href="/apps">
                        {t("Integrationen öffnen", "Open integrations")}
                      </a>
                    </p>
                  ) : (
                    <form
                      key={edit?.id + ":" + edit?.revision}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          when = values(f, "scheduled");
                        const r = await act({
                          action: "save_post",
                          post: {
                            ...(edit
                              ? {
                                  id: edit.id,
                                  expected_revision: edit.revision,
                                }
                              : {}),
                            title: values(f, "title"),
                            text: values(f, "text"),
                            connection_id: values(f, "connection"),
                            platforms: f.getAll("platform"),
                            media_urls: values(f, "media")
                              .split(/\r?\n/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                            scheduled_at: when
                              ? new Date(when + "Z").toISOString()
                              : null,
                          },
                        });
                        if (r) setEdit(null);
                      }}
                    >
                      <div className="form-grid">
                        <label className="field">
                          <span>{t("Titel intern", "Internal title")}</span>
                          <input
                            name="title"
                            required
                            maxLength={180}
                            defaultValue={edit?.title}
                          />
                        </label>
                        <label className="field">
                          <span>
                            {t("Profilverbindung", "Profile connection")}
                          </span>
                          <select
                            name="connection"
                            defaultValue={edit?.connection_id}
                          >
                            {publishing.map((c: any) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="field">
                        <span>{t("Beitragstext", "Post text")}</span>
                        <textarea
                          name="text"
                          required
                          maxLength={10000}
                          rows={6}
                          defaultValue={edit?.payload.post}
                        />
                      </label>
                      <fieldset className="studio-networks">
                        <legend>
                          {t(
                            "Zielplattformen – maximal 5",
                            "Target platforms — maximum 5",
                          )}
                        </legend>
                        {networks.map((p) => (
                          <label className="check-row" key={p}>
                            <input
                              type="checkbox"
                              name="platform"
                              value={p}
                              defaultChecked={edit?.payload.platforms.includes(
                                p,
                              )}
                            />
                            {p}
                          </label>
                        ))}
                      </fieldset>
                      <div className="form-grid">
                        <label className="field">
                          <span>
                            {t(
                              "Öffentliche Medien-URLs, eine pro Zeile (max. 4)",
                              "Public media URLs, one per line (max. 4)",
                            )}
                          </span>
                          <textarea
                            name="media"
                            rows={3}
                            defaultValue={edit?.payload.mediaUrls?.join("\n")}
                          />
                        </label>
                        <label className="field">
                          <span>
                            {t(
                              "Geplanter Versand (UTC), leer = nach Freigabe",
                              "Scheduled dispatch (UTC), empty = after approval",
                            )}
                          </span>
                          <input
                            name="scheduled"
                            type="datetime-local"
                            defaultValue={
                              edit?.scheduled_at
                                ? utcInput(edit.scheduled_at)
                                : ""
                            }
                          />
                        </label>
                      </div>
                      <p className="form-note">
                        {t(
                          "Medien bleiben privat, bis du ihre angegebenen öffentlichen URLs für die Veröffentlichung freigibst. Kontotyp und Medienvorgaben des Anbieters gelten.",
                          "Review the public media URLs before approving publication. Provider account types and media requirements apply.",
                        )}
                      </p>
                      <div className="button-row">
                        <button className="primary" disabled={busy}>
                          {t(
                            "Als privaten Entwurf speichern",
                            "Save private draft",
                          )}
                        </button>
                        {edit && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setEdit(null)}
                          >
                            {t("Abbrechen", "Cancel")}
                          </button>
                        )}
                      </div>
                    </form>
                  )}
                </details>
              )}
              {manage && publishing.length > 0 && (
                <AiAssist
                  kind="post"
                  data={data}
                  connections={publishing}
                  act={act}
                  busy={busy}
                />
              )}
              <div className="studio-posts">
                {!data.posts.length && (
                  <div className="panel studio-card studio-empty">
                    <CalendarDays size={30} />
                    <h2>
                      {t(
                        "Dein Redaktionsplan beginnt hier",
                        "Your content plan starts here",
                      )}
                    </h2>
                    <p>
                      {t(
                        "Speichere einen Entwurf oder lass einen Agenten einen Entwurf vorbereiten.",
                        "Save a draft or ask an agent to prepare one.",
                      )}
                    </p>
                  </div>
                )}
                {data.posts.map((post: any) => (
                  <article className="panel studio-card" key={post.id}>
                    <div className="studio-card-top">
                      <div>
                        <span className="studio-status">
                          {post.status} · v{post.revision}
                        </span>
                        <h2>{post.title}</h2>
                      </div>
                      <span>
                        {post.scheduled_at
                          ? new Date(post.scheduled_at).toLocaleString()
                          : t("Nach Freigabe", "After approval")}
                      </span>
                    </div>
                    <PostPreview post={post} />
                    {post.last_error && (
                      <p className="error-box">{post.last_error}</p>
                    )}
                    {post.approved_at && (
                      <small>
                        {t("Freigegeben am ", "Approved ")}
                        {new Date(post.approved_at).toLocaleString()}
                      </small>
                    )}
                    {post.receipt && (
                      <pre className="studio-preview">
                        {JSON.stringify(post.receipt, null, 2)}
                      </pre>
                    )}
                    {manage &&
                      !["publishing", "submitted", "uncertain"].includes(
                        post.status,
                      ) && (
                        <div className="button-row">
                          <button
                            className="secondary"
                            onClick={() => setEdit(post)}
                          >
                            {t("Bearbeiten", "Edit")}
                          </button>
                          {post.status !== "review" &&
                            post.status !== "queued" && (
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  void act({
                                    action: "review",
                                    id: post.id,
                                    expected_revision: post.revision,
                                  })
                                }
                              >
                                {t("Freigabe anfordern", "Request approval")}
                              </button>
                            )}
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void act({
                                action: "cancel",
                                id: post.id,
                                expected_revision: post.revision,
                              })
                            }
                          >
                            {t("Zurückziehen", "Cancel post")}
                          </button>
                        </div>
                      )}
                    {post.status === "review" && (
                      <ReviewControls
                        post={{
                          ...post,
                          project_id: projectId,
                          price_micro_usd: data.prices.find(
                            (p: any) => p.connection_id === post.connection_id,
                          )?.price_micro_usd,
                          connection_revision: data.connections.find(
                            (c: any) => c.id === post.connection_id,
                          )?.revision,
                          price_revision: data.prices.find(
                            (p: any) => p.connection_id === post.connection_id,
                          )?.revision,
                          budget_revision: data.budget.revision,
                        }}
                        manage={manage}
                        onDone={load}
                      />
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              {manage && (
                <details className="panel studio-card" open>
                  <summary>
                    <Plus size={17} />
                    {t("Rechercheprojekt anlegen", "Create research notebook")}
                  </summary>
                  {!research.length ? (
                    <p className="form-note">
                      {t(
                        "Verbinde Tavily, Brave Search oder Exa unter Integrationen und gib dieses Projekt frei.",
                        "Connect Tavily, Brave Search or Exa under Integrations and grant this project access.",
                      )}{" "}
                      <a href="/apps">
                        {t("Integrationen öffnen", "Open integrations")}
                      </a>
                    </p>
                  ) : (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        const r = await act({
                          action: "create_research",
                          title: values(f, "title"),
                          connection_id: values(f, "connection"),
                          cost_limit: values(f, "cost"),
                          request_limit: Number(f.get("calls")),
                        });
                        if (r) setJobId(r.id);
                      }}
                    >
                      <div className="form-grid">
                        <label className="field">
                          <span>{t("Recherchethema", "Research topic")}</span>
                          <input name="title" maxLength={180} required />
                        </label>
                        <label className="field">
                          <span>{t("Suchanbieter", "Search provider")}</span>
                          <select name="connection">
                            {research.map((c: any) => (
                              <option key={c.id} value={c.id}>
                                {c.name} · {c.provider}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>
                            {t(
                              "Festes Recherchelimit (USD)",
                              "Fixed notebook ceiling (USD)",
                            )}
                          </span>
                          <input
                            name="cost"
                            type="number"
                            min="0"
                            max="999999"
                            step="0.000001"
                            defaultValue="0"
                            required
                          />
                        </label>
                        <label className="field">
                          <span>
                            {t(
                              "Maximale Anbieteranfragen",
                              "Maximum provider requests",
                            )}
                          </span>
                          <input
                            name="calls"
                            type="number"
                            min="1"
                            max="20"
                            defaultValue="3"
                            required
                          />
                        </label>
                      </div>
                      <button className="primary" disabled={busy}>
                        {t("Recherche anlegen", "Create notebook")}
                      </button>
                    </form>
                  )}
                </details>
              )}
              <label className="field">
                <span>{t("Recherche öffnen", "Open notebook")}</span>
                <select
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                >
                  <option value="">{t("Auswählen …", "Choose …")}</option>
                  {data.jobs.map((j: any) => (
                    <option key={j.id} value={j.id}>
                      {j.title} · {j.requests_used}/{j.request_limit}
                    </option>
                  ))}
                </select>
              </label>
              {queryError && (
                <p className="error-box" role="alert">
                  {queryError}
                </p>
              )}
              {job && jobId === job.job.id && (
                <>
                  <div className="studio-metrics">
                    <Metric
                      label="Notebook ceiling USD"
                      value={moneyText(job.job.cost_limit)}
                    />
                    <Metric
                      label="Committed ceiling USD"
                      value={moneyText(job.job.cost_used)}
                    />
                    <Metric
                      label="Provider requests"
                      value={
                        job.job.requests_used + " / " + job.job.request_limit
                      }
                    />
                  </div>
                  {manage && (
                    <form
                      className="panel studio-card"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setQueryError("");
                        const f = new FormData(e.currentTarget);
                        await act({
                          action: "search",
                          job_id: jobId,
                          query: values(f, "query"),
                        });
                        await readJob();
                      }}
                    >
                      <label className="field">
                        <span>
                          {t(
                            "Suchanfrage – vorhandene Treffer zuerst nutzen",
                            "Search query — reuse collected sources first",
                          )}
                        </span>
                        <input
                          name="query"
                          minLength={3}
                          maxLength={500}
                          required
                        />
                      </label>
                      <p className="form-note">
                        {t(
                          "Pro Anfrage maximal 5 Treffer. Erledigte Suchanfragen nutzen ihre Belege; andere Recherchen teilen einen 24-Stunden-Projektcache. KI-Synthese ist ein separater, begrenzter Auftrag.",
                          "Maximum 5 results per request. Completed queries reuse their receipts; other notebooks share a 24-hour project cache. AI synthesis is a separate capped task.",
                        )}
                      </p>
                      <button className="primary" disabled={busy}>
                        <Search size={16} />
                        {t("Begrenzt suchen", "Run bounded search")}
                      </button>
                    </form>
                  )}
                  {job.queries.map((q: any) => (
                    <article className="panel studio-card" key={q.id}>
                      <div className="studio-card-top">
                        <h2>{q.query}</h2>
                        <span className="studio-status">{q.status}</span>
                      </div>
                      <small>
                        {new Date(
                          q.finished_at ?? q.started_at,
                        ).toLocaleString()}{" "}
                        · USD {moneyText(q.reserved_cost)} committed
                      </small>
                      {q.results.map((s: any, index: number) => (
                        <div className="research-source" key={s.url + index}>
                          <a href={s.url} target="_blank" rel="noreferrer">
                            {s.title} <ExternalLink size={13} />
                          </a>
                          <p>{s.excerpt}</p>
                          <small>{s.url}</small>
                        </div>
                      ))}
                    </article>
                  ))}
                  {manage && (
                    <AiAssist
                      kind="research"
                      data={data}
                      jobId={jobId}
                      act={act}
                      busy={busy}
                    />
                  )}
                  <section className="panel studio-card">
                    <h2>{t("Bericht und Notizen", "Report and notes")}</h2>
                    <form
                      key={job.job.id + ":" + job.job.revision}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        await act({
                          action: "report",
                          job_id: jobId,
                          expected_revision: job.job.revision,
                          report: values(
                            new FormData(e.currentTarget),
                            "report",
                          ),
                        });
                        await readJob();
                      }}
                    >
                      <label className="field">
                        <span>
                          {t(
                            "Markdown mit Quellen und Unsicherheiten",
                            "Markdown with citations and uncertainty",
                          )}
                        </span>
                        <textarea
                          name="report"
                          rows={12}
                          defaultValue={job.job.report}
                          readOnly={!manage}
                          maxLength={60000}
                        />
                      </label>
                      <div className="button-row">
                        {manage && (
                          <button className="primary" disabled={busy}>
                            {t("Bericht speichern", "Save report")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          onClick={async () => {
                            const r = await fetch(
                              "/api/research/export?id=" +
                                encodeURIComponent(jobId),
                              {
                                headers: {
                                  "x-project-id": projectId,
                                  "x-workspace-id": workspaceId,
                                },
                              },
                            );
                            if (!r.ok) {
                              setQueryError("Export failed");
                              return;
                            }
                            const url = URL.createObjectURL(await r.blob()),
                              a = document.createElement("a");
                            a.href = url;
                            a.download = "research-report.md";
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                          }}
                        >
                          <FileText size={16} />
                          {t("Markdown herunterladen", "Download Markdown")}
                        </button>
                      </div>
                    </form>
                    <ReportHistory
                      data={job}
                      projectId={projectId}
                      manage={manage}
                      act={act}
                      reload={readJob}
                    />
                  </section>
                </>
              )}
            </>
          )}
          <details className="panel studio-card">
            <summary>
              {t(
                "Kostenbelege – reservierte Obergrenzen",
                "Cost receipts — committed ceilings",
              )}
            </summary>
            <p className="form-note">
              {t(
                "Kein Nachweis tatsächlicher Anbietergebühren. Die bestätigte maximale Anfragegebühr bleibt auch bei Fehlern oder unklarem Ausgang gebunden.",
                "These are not actual provider invoices. The confirmed maximum request charge stays committed on errors or uncertain outcomes.",
              )}
            </p>
            <div className="studio-receipts">
              {data.receipts.map((r: any) => (
                <div key={r.id}>
                  <span>{r.subject}</span>
                  <span>
                    USD {moneyText(r.price_micro_usd)} · {r.status}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      {!data && !error && (
        <p role="status">{t("Wird geladen …", "Loading …")}</p>
      )}
    </section>
  );
}
function ReportHistory({ data, projectId, manage, act, reload }: any) {
  const { t } = useLanguage();
  const [version, setVersion] = useState<any>(null),
    [error, setError] = useState("");
  if (!data.versions?.length) return null;
  return (
    <details className="studio-review">
      <summary>
        {t(
          "Vorherige Berichte ansehen und wiederherstellen",
          "View and restore previous reports",
        )}
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const v = values(new FormData(e.currentTarget), "version");
            setVersion(
              await api(
                "research/version?id=" + data.job.id + "&revision=" + v,
                undefined,
                "GET",
                { projectId },
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label className="field">
          <span>Version</span>
          <select name="version">
            {data.versions.map((v: any) => (
              <option key={v.revision} value={v.revision}>
                v{v.revision} · {new Date(v.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary">
          {t("Version laden", "Load version")}
        </button>
      </form>
      {error && <p className="error-box">{error}</p>}
      {version && (
        <>
          <pre className="studio-preview">{version.report}</pre>
          {manage && (
            <button
              className="secondary"
              onClick={async () => {
                const r = await act({
                  action: "restore_report",
                  job_id: data.job.id,
                  revision: version.revision,
                  expected_revision: data.job.revision,
                });
                if (r) {
                  await reload();
                  setVersion(null);
                }
              }}
            >
              {t(
                "Diese Version als neuen Stand wiederherstellen",
                "Restore this version as a new revision",
              )}
            </button>
          )}
        </>
      )}
    </details>
  );
}
function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="panel studio-metric">
      <span>{label}</span>
      <strong>{String(value)}</strong>
    </div>
  );
}
function PostPreview({ post }: { post: any }) {
  return (
    <div className="studio-post-preview">
      <div className="studio-networks">
        {post.payload.platforms.map((p: string) => (
          <span className="studio-status" key={p}>
            {p}
          </span>
        ))}
      </div>
      <p className="studio-preview">{post.payload.post}</p>
      {post.payload.mediaUrls?.map((url: string) => (
        <a href={url} target="_blank" rel="noreferrer" key={url}>
          {url}
        </a>
      ))}
    </div>
  );
}
function ExternalBudget({ data, manage, act, busy }: any) {
  const { t } = useLanguage();
  return (
    <details className="panel studio-card">
      <summary>
        <ShieldCheck size={18} />
        {t("Feste externe Projektlimits", "Fixed external project limits")} ·
        USD {moneyText(data.budget.cost_used)} /{" "}
        {moneyText(data.budget.cost_limit)} · {data.budget.requests_used}/
        {data.budget.request_limit} requests
      </summary>
      <p className="form-note">
        {t(
          "Zusätzliche Lebenszeit-Limits für dieses Projekt. KI-Aufträge behalten ihre eigenen Token- und Creditlimits. Neue Limits starten bei null. USD-Obergrenzen beruhen auf deiner bestätigten maximalen Anbietergebühr; setze zusätzlich ein Ausgabenlimit beim Anbieter. KeRnCloud kann dessen Abrechnung nicht kontrollieren.",
          "Additional lifetime limits for this project. AI tasks retain their own token and credit caps. New limits start at zero. USD ceilings use your confirmed maximum provider charge; also set a provider-side spending cap. KeRnCloud cannot control the provider's billing.",
        )}
      </p>
      {manage && (
        <div className="studio-budget-grid">
          <form
            onSubmit={async (e: any) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await act({
                action: "budget",
                cost_limit: values(f, "cost"),
                request_limit: Number(f.get("calls")),
              });
            }}
          >
            <h3>{t("1 · Projektlimit", "1 · Project ceiling")}</h3>
            <label className="field">
              <span>USD total ceiling</span>
              <input
                name="cost"
                type="number"
                min="0"
                max="999999"
                step="0.000001"
                defaultValue={moneyText(data.budget.cost_limit)}
                required
              />
            </label>
            <label className="field">
              <span>Maximum total requests</span>
              <input
                name="calls"
                type="number"
                min="0"
                max="10000"
                defaultValue={data.budget.request_limit}
                required
              />
            </label>
            <button className="secondary" disabled={busy}>
              {t("Projektlimit speichern", "Save project ceiling")}
            </button>
          </form>
          <form
            onSubmit={async (e: any) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await act({
                action: "price",
                connection_id: values(f, "connection"),
                price: values(f, "price"),
                valid_until: new Date(values(f, "until") + "Z").toISOString(),
                confirm: !!f.get("confirm"),
              });
            }}
          >
            <h3>
              {t(
                "2 · Maximaler Preis je API-Anfrage",
                "2 · Maximum price per API request",
              )}
            </h3>
            <label className="field">
              <span>Connection</span>
              <select name="connection">
                {data.connections.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                USD per request (including all selected platforms/additional
                fees)
              </span>
              <input
                name="price"
                type="number"
                min="0"
                max="999999"
                step="0.000001"
                required
              />
            </label>
            <label className="field">
              <span>Valid until (UTC, maximum 31 days)</span>
              <input
                name="until"
                type="datetime-local"
                defaultValue={utcInput(
                  new Date(Date.now() + 7 * 86400000).toISOString(),
                )}
                required
              />
            </label>
            <label className="check-row">
              <input type="checkbox" name="confirm" required />
              {t(
                "Ich habe die maximale Gebühr meines Tarifs geprüft.",
                "I have checked the maximum charge under my provider plan.",
              )}
            </label>
            <button
              className="secondary"
              disabled={busy || !data.connections.length}
            >
              {t("Preisobergrenze bestätigen", "Confirm price ceiling")}
            </button>
          </form>
        </div>
      )}
      <p>
        {t(
          "Änderungen an Limits oder Preisen machen bestehende Veröffentlichungsfreigaben ungültig.",
          "Changing limits or prices invalidates existing publishing approvals.",
        )}
      </p>
      <ul>
        {data.prices.map((p: any) => (
          <li key={p.connection_id}>
            {data.connections.find((c: any) => c.id === p.connection_id)
              ?.name ?? p.connection_id}{" "}
            · USD {moneyText(p.price_micro_usd)} ·{" "}
            {new Date(p.valid_until).toLocaleString()}
          </li>
        ))}
      </ul>
    </details>
  );
}
function AiAssist({ kind, data, connections = [], jobId, act, busy }: any) {
  const { t } = useLanguage();
  const [run, setRun] = useState("");
  return (
    <details className="panel studio-card">
      <summary>
        {t(
          "Mit Agent vorbereiten – eigener fester KI-Rahmen",
          "Prepare with an agent — separate fixed AI budget",
        )}
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const r = await act({
            action: "ai",
            kind: kind === "post" ? "post" : values(f, "kind"),
            brief: values(f, "brief"),
            agent_id: values(f, "agent"),
            ...(jobId
              ? { job_id: jobId }
              : { connection_id: values(f, "connection") }),
            token_limit: Number(f.get("tokens")),
            credit_limit: Number(f.get("credits")),
          });
          if (r?.run_id) setRun(r.run_id);
        }}
      >
        <label className="field">
          <span>Brief</span>
          <textarea name="brief" maxLength={3000} required rows={3} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Agent</span>
            <select name="agent">
              {data.agents.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {kind === "post" ? (
            <label className="field">
              <span>Publishing connection</span>
              <select name="connection">
                {connections.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Work</span>
              <select name="kind">
                <option value="research">
                  Research and write report within notebook limits
                </option>
                <option value="report">Summarize existing sources only</option>
              </select>
            </label>
          )}
          <label className="field">
            <span>Maximum total AI tokens</span>
            <input
              name="tokens"
              type="number"
              min="1000"
              max="20000"
              defaultValue="4000"
              required
            />
          </label>
          <label className="field">
            <span>Maximum AI credits</span>
            <input
              name="credits"
              type="number"
              min="0"
              max="100000"
              defaultValue="1000"
              required
            />
          </label>
        </div>
        <button className="primary" disabled={busy || !data.agents.length}>
          {t("Begrenzten KI-Auftrag starten", "Start capped AI task")}
        </button>
        {run && (
          <a href={"/tasks/" + run}>{t("Auftrag öffnen", "Open task")}</a>
        )}
      </form>
    </details>
  );
}
export function StudioReviews({ workspaceId }: { workspaceId: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const load = async () =>
    setData(
      await api("studio/reviews", undefined, "GET", { projectScope: false }),
    );
  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [workspaceId]);
  if (!data?.posts.length) return null;
  return (
    <section className="studio-hub studio-inbox">
      <h2>
        {t(
          "Content-Studio · Veröffentlichungen prüfen",
          "Content Studio · review publications",
        )}
      </h2>
      {data.posts.map((p: any) => (
        <article className="panel studio-card" key={p.id + ":" + p.revision}>
          <div className="studio-card-top">
            <div>
              <span className="scope-label">{p.project_name}</span>
              <h3>{p.title}</h3>
            </div>
            <span>{p.connection_name}</span>
          </div>
          <PostPreview post={p} />
          <ReviewControls
            post={p}
            manage={["owner", "admin"].includes(data.role)}
            onDone={load}
          />
        </article>
      ))}
    </section>
  );
}
function ReviewControls({
  post,
  manage,
  onDone,
}: {
  post: any;
  manage: boolean;
  onDone: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="studio-review"
      onSubmit={async (e) => {
        e.preventDefault();
        const choice = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement;
        setBusy(true);
        setError("");
        try {
          await api(
            "studio/review-action",
            {
              project_id: post.project_id,
              action: choice.value,
              id: post.id,
              expected_revision: post.revision,
              ...(choice.value === "approve"
                ? {
                    expected_connection_revision: post.connection_revision,
                    expected_price_revision: post.price_revision,
                    expected_budget_revision: post.budget_revision,
                    expected_price: String(post.price_micro_usd),
                  }
                : {}),
              confirm: !!new FormData(e.currentTarget).get("confirm"),
            },
            "POST",
            { projectScope: false },
          );
          await onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        <strong>
          {t(
            "Vorgeschlagene Aktion: Beitrag veröffentlichen",
            "Proposed action: publish post",
          )}
        </strong>
      </p>
      <p>
        {post.scheduled_at
          ? new Date(post.scheduled_at).toLocaleString()
          : t(
              "Nach Freigabe, sobald der Veröffentlichungsdienst läuft",
              "After approval, when the publishing service runs",
            )}{" "}
        · {post.payload.platforms.join(", ")} ·{" "}
        {t("Reservierte Obergrenze: ", "Reserved ceiling: ")}
        {post.price_micro_usd == null
          ? t("Preis fehlt", "Price missing")
          : "USD " + moneyText(post.price_micro_usd)}
      </p>
      <label className="check-row">
        <input type="checkbox" name="confirm" disabled={!manage} />
        {t(
          "Diesen Text, diese Medien, Ziele, Zeit und Kostenobergrenze einmalig freigeben.",
          "Approve this exact text, media, targets, time and cost ceiling once.",
        )}
      </label>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {manage && (
        <div className="button-row">
          <button
            className="primary"
            name="choice"
            value="approve"
            disabled={busy || post.price_micro_usd == null}
          >
            {t("Veröffentlichung freigeben", "Approve publication")}
          </button>
          <button
            className="secondary"
            name="choice"
            value="reject"
            disabled={busy}
          >
            {t("Ablehnen", "Reject")}
          </button>
        </div>
      )}
    </form>
  );
}
