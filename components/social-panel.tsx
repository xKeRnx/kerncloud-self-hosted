"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import { moneyText } from "../src/core/studio-research";
import { socialPlatforms, commentPlatforms } from "../src/core/social";
import { RefreshCw, MessageSquare, ShieldCheck, BarChart3 } from "lucide-react";
type Act = (body: any) => Promise<any>;
const field = (f: FormData, k: string) => String(f.get(k) ?? "");
const label = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SocialPanel({
  workspaceId,
  projectId,
  analytics = false,
}: {
  workspaceId: string;
  projectId: string;
  analytics?: boolean;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState(""),
    [network, setNetwork] = useState(""),
    [archived, setArchived] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [edit, setEdit] = useState<any>(null);
  const load = async () =>
    setData(await api("social", undefined, "GET", { projectId }));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [workspaceId, projectId]);
  const act: Act = async (body) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api("social/action", body, "POST", { projectId });
      await load();
      setNotice(
        r.cached
          ? t(
              "Gespeicherte Daten wiederverwendet; kein Anbieteraufruf.",
              "Cached data reused; no provider request.",
            )
          : t("Gespeichert.", "Saved."),
      );
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <p>{error || t("Wird geladen …", "Loading …")}</p>;
  const manage = ["owner", "admin"].includes(data.role),
    sources = data.sources.filter((s: any) =>
      analytics ? s.kind === "analytics" : s.kind !== "analytics",
    ),
    items = data.items.filter(
      (i: any) =>
        (!source || i.source_id === source) &&
        (!network || i.platform === network) &&
        i.archived === archived,
    );
  const chosen = selected && data.items.find((i: any) => i.id === selected.id);
  return (
    <section className="studio-hub social-hub">
      <header className="workspace-page-heading">
        <div>
          <span className="scope-label">
            {analytics
              ? "MEASURE · COMPARE · LEARN"
              : "COLLECT · DRAFT · REVIEW"}
          </span>
          <h1>
            {analytics
              ? t("Social-Auswertungen", "Social analytics")
              : t("Social-Postfach", "Social inbox")}
          </h1>
          <p>
            {analytics
              ? t(
                  "Gespeicherte Beitragsstatistiken mit Herkunft und Zeitstempel.",
                  "Cached post metrics with source and retrieval timestamps.",
                )
              : t(
                  "Kommentare und Direktnachrichten dieses Projekts. Antworten benötigen eine ausdrückliche Freigabe.",
                  "This project’s comments and direct messages. Every reply needs explicit approval.",
                )}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={16} />
          {t("Aktualisieren", "Refresh view")}
        </button>
      </header>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      <div className="notice">
        {t(
          "Gespeicherte Daten werden kostenlos angezeigt. Anbieterabrufe sind manuell und begrenzt. Kein automatisches kostenpflichtiges Polling.",
          "Viewing cached data starts no provider request. Fetches are manual and bounded; no automatic paid polling.",
        )}
      </div>
      <SocialLimits data={data} manage={manage} act={act} busy={busy} />
      <details className="panel studio-card">
        <summary>
          {t("Quellen und Abrufe verwalten", "Manage sources and fetches")}
        </summary>
        {!data.connections.length && (
          <p>
            <a href="/apps">
              {t(
                "Ayrshare unter Integrationen verbinden",
                "Connect Ayrshare under Integrations",
              )}
            </a>
          </p>
        )}
        {manage && !!data.connections.length && (
          <SourceForm data={data} analytics={analytics} act={act} busy={busy} />
        )}
        <div className="social-source-list">
          {sources.map((s: any) => (
            <SourceCard
              key={s.id}
              source={s}
              data={data}
              manage={manage}
              act={act}
              busy={busy}
            />
          ))}
        </div>
      </details>
      {analytics ? (
        <Analytics data={data} />
      ) : (
        <>
          <div className="panel studio-card social-filters">
            <label className="field">
              <span>{t("Quelle", "Source")}</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">{t("Alle Quellen", "All sources")}</option>
                {sources.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Plattform", "Platform")}</span>
              <select
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
              >
                <option value="">
                  {t("Alle Plattformen", "All platforms")}
                </option>
                {socialPlatforms.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              {t("Lokales Archiv anzeigen", "Show local archive")}
            </label>
          </div>
          <p className="form-note">
            {t(
              "Bis zu 200 zuletzt gespeicherte Einträge. Ein Nachrichtenabruf liest eine Seite mit maximal 20 Nachrichten; Fortsetzungen kosten jeweils einen weiteren begrenzten Abruf. Kommentare werden lokal auf 100 Einträge begrenzt.",
              "Up to 200 latest cached items. A message fetch reads one page of up to 20 messages; each continuation is another bounded request. Comments are locally limited to 100 items per fetch.",
            )}
          </p>
          {!items.length && (
            <section className="panel studio-card studio-empty">
              <MessageSquare />
              <h2>
                {t(
                  "Noch keine Einträge in dieser Ansicht",
                  "No items in this view yet",
                )}
              </h2>
              <p>
                {t(
                  "Quelle anlegen und nach Festlegen der Kostenlimits abrufen.",
                  "Add a source and fetch after setting fixed limits.",
                )}
              </p>
            </section>
          )}
          <div className="social-item-grid">
            {items.map((i: any) => (
              <article key={i.id} className="panel studio-card">
                <div className="studio-card-top">
                  <div>
                    <span className="studio-status">
                      {i.platform} · {i.kind} · {i.direction}
                    </span>
                    <h2>{i.author}</h2>
                    <small>{i.label}</small>
                  </div>
                  <span>
                    {i.provider_at
                      ? new Date(i.provider_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
                <p className="studio-preview">
                  {i.body ||
                    t(
                      "Mediennachricht ohne Text",
                      "Media message without text",
                    )}
                </p>
                <p className="form-note">
                  {t("Abgerufen", "Retrieved")}{" "}
                  {new Date(i.retrieved_at).toLocaleString()} · v{i.revision} ·{" "}
                  {t("Empfänger-/Kommentar-ID", "Recipient / comment ID")}:{" "}
                  <code>{i.recipient}</code>
                </p>
                {manage && (
                  <div className="button-row">
                    {i.replyable && i.direction === "received" && (
                      <button
                        className="primary"
                        onClick={() => {
                          setSelected(i);
                          setEdit(
                            data.replies.find(
                              (r: any) =>
                                r.item_id === i.id &&
                                !["rejected", "canceled"].includes(r.status),
                            ) ?? null,
                          );
                        }}
                      >
                        {t("Antwort vorbereiten", "Prepare reply")}
                      </button>
                    )}
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          action: "archive",
                          id: i.id,
                          archived: !i.archived,
                        })
                      }
                    >
                      {i.archived
                        ? t("Wiederherstellen", "Restore locally")
                        : t("Lokal archivieren", "Archive locally")}
                    </button>
                  </div>
                )}
                {!i.replyable && (
                  <p className="form-note">
                    {t(
                      "Keine Antwort über diese Schnittstelle verfügbar. Plattform oder erforderliche Zielangaben fehlen.",
                      "Reply unavailable through this interface: platform or required target metadata is missing.",
                    )}
                  </p>
                )}
              </article>
            ))}
          </div>
          {chosen && manage && (
            <section className="panel studio-card">
              <h2>
                {t(
                  "Antwort zur Prüfung vorbereiten",
                  "Prepare reply for review",
                )}
              </h2>
              <p>
                {chosen.author} · {chosen.platform} ·{" "}
                <code>{chosen.recipient}</code>
              </p>
              <p className="studio-preview">{chosen.body}</p>
              {edit &&
              ["sending", "submitted", "uncertain"].includes(edit.status) ? (
                <p className="notice">
                  {t(
                    "Diese Antwort wurde bereits versendet oder ihr Ausgang ist unklar. Kein erneuter Versand.",
                    "This reply was dispatched or has an uncertain outcome. It will not be sent again.",
                  )}
                </p>
              ) : (
                <form
                  key={chosen.id + ":" + (edit?.revision ?? 0)}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await act({
                      action: "reply",
                      item_id: chosen.id,
                      expected_item_revision: chosen.revision,
                      text: field(new FormData(e.currentTarget), "text"),
                      ...(edit
                        ? { id: edit.id, expected_revision: edit.revision }
                        : {}),
                    });
                    if (r) {
                      setSelected(null);
                      setEdit(null);
                    }
                  }}
                >
                  <label className="field">
                    <span>{t("Antworttext", "Reply text")}</span>
                    <textarea
                      name="text"
                      rows={5}
                      maxLength={chosen.platform === "twitter" ? 280 : 2000}
                      defaultValue={edit?.body ?? ""}
                      required
                    />
                  </label>
                  <p className="form-note">
                    {t(
                      "Speichern fordert eine neue Freigabe an. Änderungen verwerfen eine frühere Freigabe.",
                      "Saving requests a new review. Changes invalidate any earlier approval.",
                    )}
                  </p>
                  <div className="button-row">
                    <button className="primary" disabled={busy}>
                      {t("Zur Freigabe einreichen", "Request reply approval")}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setSelected(null)}
                    >
                      {t("Schließen", "Close")}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
          <section className="panel studio-card">
            <h2>
              {t(
                "Antworten und Versandbelege",
                "Replies and dispatch receipts",
              )}
            </h2>
            <p>
              {t(
                "Im zentralen Postfach freigeben. „Submitted“ bedeutet Annahme durch den Anbieter, keine bestätigte Zustellung. Unklare Antworten werden nie automatisch wiederholt.",
                "Approve in the central Inbox. “Submitted” means provider acceptance, not confirmed delivery. Uncertain replies are never automatically repeated.",
              )}
            </p>
            <a href="/decisions">{t("Freigaben öffnen", "Open approvals")}</a>
            {data.replies.map((r: any) => (
              <article className="research-source" key={r.id}>
                <span className="studio-status">
                  {r.status} · v{r.revision}
                </span>
                <h3>
                  {r.author} · {r.platform}
                </h3>
                <p className="studio-preview">{r.body}</p>
                {r.last_error && <p className="error-box">{r.last_error}</p>}
                {r.receipt && (
                  <p className="form-note">
                    {r.receipt.provider} · {r.receipt.status} ·{" "}
                    {r.receipt.id ?? "—"}
                  </p>
                )}
                {manage &&
                  ["review", "queued", "blocked"].includes(r.status) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          action: "cancel",
                          id: r.id,
                          expected_revision: r.revision,
                        })
                      }
                    >
                      {t("Antwort zurückziehen", "Cancel reply")}
                    </button>
                  )}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
function SocialLimits({ data, manage, act, busy }: any) {
  const { t } = useLanguage();
  return (
    <details className="panel studio-card">
      <summary>
        <ShieldCheck size={17} />
        {t("Feste externe Limits", "Fixed external limits")} · USD{" "}
        {moneyText(data.budget.cost_used)} / {moneyText(data.budget.cost_limit)}{" "}
        · {data.budget.requests_used}/{data.budget.request_limit} requests
      </summary>
      <p>
        {t(
          "Abrufe und Antworten teilen das feste externe Projektbudget mit Content-Studio und Recherche. Neue Limits starten bei null.",
          "Fetches and replies share the fixed external project budget with Content Studio and Research. New limits start at zero.",
        )}
      </p>
      <a href="/studio">
        {t(
          "Projektbudget im Content-Studio verwalten",
          "Manage the project budget in Content Studio",
        )}
      </a>
      <p className="notice">
        {t(
          "Preisbestätigungen für Social-Abrufe und Antworten sind getrennt. Höchstens 31 Tage gültig. Alle Plattform-, Nachrichten-, Konversations- und Tarifgebühren einbeziehen. Reservierte Obergrenzen sind keine Anbieterrechnung; zusätzlich ein Ausgabenlimit beim Anbieter setzen.",
          "Social read and reply price confirmations are separate and expire within 31 days. Include all platform, messaging, conversation and plan fees. Reserved ceilings are not provider invoices; also set provider-side hard spending caps.",
        )}
      </p>
      {manage && !!data.connections.length && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act({
              action: "price",
              connection_id: field(f, "connection"),
              operation: field(f, "operation"),
              price: field(f, "price"),
              valid_until: new Date(field(f, "until") + "Z").toISOString(),
              confirm: f.get("confirm") === "on",
            });
          }}
        >
          <div className="form-grid">
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
              <span>Operation</span>
              <select name="operation">
                <option value="read">
                  Read: messages, comments or analytics
                </option>
                <option value="reply">Send one approved text reply</option>
              </select>
            </label>
            <label className="field">
              <span>Maximum total USD per request</span>
              <input
                name="price"
                type="number"
                step="0.000001"
                min="0"
                max="999999.999999"
                required
              />
            </label>
            <label className="field">
              <span>Valid until (UTC, maximum 31 days)</span>
              <input name="until" type="datetime-local" required />
            </label>
          </div>
          <label className="check-row">
            <input name="confirm" type="checkbox" required />
            {t(
              "Ich bestätige diese maximale Gesamtgebühr für den gewählten Vorgang.",
              "I confirm this maximum total fee for the selected operation.",
            )}
          </label>
          <button className="primary" disabled={busy}>
            {t("Preisobergrenze speichern", "Save price ceiling")}
          </button>
        </form>
      )}
      <div className="social-source-list">
        {data.prices.map((p: any) => (
          <p key={p.connection_id + p.operation}>
            {data.connections.find((c: any) => c.id === p.connection_id)
              ?.name ?? "Connection"}{" "}
            · {p.operation} · USD {moneyText(p.price_micro_usd)} ·{" "}
            {new Date(p.valid_until).toLocaleString()}
          </p>
        ))}
      </div>
    </details>
  );
}
function SourceForm({ data, analytics, act, busy }: any) {
  const { t } = useLanguage();
  const [kind, setKind] = useState(analytics ? "analytics" : "messages");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await act({
          action: "source",
          source: {
            connection_id: field(f, "connection"),
            kind,
            platform: field(f, "platform"),
            label: field(f, "label"),
            ...(kind !== "messages" ? { target: field(f, "target") } : {}),
          },
        });
      }}
    >
      <h2>{t("Quelle hinzufügen", "Add source")}</h2>
      <div className="form-grid">
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
          <span>Source type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {analytics ? (
              <option value="analytics">Post analytics</option>
            ) : (
              <>
                <option value="messages">Direct messages</option>
                <option value="comments">Post comments</option>
              </>
            )}
          </select>
        </label>
        <label className="field">
          <span>Platform</span>
          <select name="platform">
            {(kind === "messages"
              ? ["facebook", "instagram", "twitter"]
              : kind === "comments"
                ? commentPlatforms
                : socialPlatforms
            ).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Source label</span>
          <input name="label" maxLength={180} required />
        </label>
        {kind !== "messages" && (
          <label className="field">
            <span>Ayrshare post ID</span>
            <input name="target" maxLength={500} required />
            <small>
              {t(
                "Aus dem Versandbeleg oder der Anbieterhistorie. Keine Social-Post-ID.",
                "From the Studio dispatch receipt or provider history. Use the Ayrshare ID, not a social-network post ID.",
              )}
            </small>
          </label>
        )}
      </div>
      <button className="primary" disabled={busy}>
        {t(
          "Quelle anlegen (kein Anbieteraufruf)",
          "Add source (no provider request)",
        )}
      </button>
    </form>
  );
}
function SourceCard({ source: s, data, manage, act, busy }: any) {
  const { t } = useLanguage();
  const [retry, setRetry] = useState(false);
  return (
    <article className="research-source">
      <div className="studio-card-top">
        <div>
          <h3>{s.label}</h3>
          <p>
            {s.platform} · {s.kind} ·{" "}
            {data.connections.find((c: any) => c.id === s.connection_id)
              ?.name ?? "Disconnected"}{" "}
            · {s.enabled ? "Enabled" : "Paused"}
          </p>
        </div>
        <span>
          {s.last_fetch
            ? new Date(s.last_fetch).toLocaleString()
            : t("Noch kein Abruf", "Not fetched")}
        </span>
      </div>
      {s.fetch_status === "uncertain" && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={retry}
            onChange={(e) => setRetry(e.target.checked)}
          />
          {t(
            "Unklarer Abruf: einen neuen, zusätzlich reservierten Leseversuch bestätigen.",
            "Uncertain fetch: confirm a new read attempt with an additional reservation.",
          )}
        </label>
      )}
      {manage && (
        <div className="button-row">
          <button
            className="primary"
            disabled={
              busy || !s.enabled || (s.fetch_status === "uncertain" && !retry)
            }
            onClick={() =>
              void act({
                action: "sync",
                id: s.id,
                request_id: crypto.randomUUID(),
                retry_uncertain: retry,
              })
            }
          >
            {t("Eine Seite abrufen", "Fetch one page")}
          </button>
          {s.next_cursor && s.enabled && (
            <button
              className="secondary"
              disabled={busy || (s.fetch_status === "uncertain" && !retry)}
              onClick={() =>
                void act({
                  action: "sync",
                  id: s.id,
                  request_id: crypto.randomUUID(),
                  next: true,
                  retry_uncertain: retry,
                })
              }
            >
              {t(
                "Nächste Seite (weiterer Abruf)",
                "Next page (another request)",
              )}
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act({
                action: "toggle_source",
                id: s.id,
                enabled: !s.enabled,
              })
            }
          >
            {s.enabled
              ? t("Quelle pausieren", "Pause source")
              : t("Quelle aktivieren", "Enable source")}
          </button>
        </div>
      )}
    </article>
  );
}
function Analytics({ data }: any) {
  const { t } = useLanguage();
  const [source, setSource] = useState(""),
    [metric, setMetric] = useState("");
  const sources = data.sources.filter((s: any) => s.kind === "analytics"),
    id = source || sources[0]?.id,
    rows = data.analytics.filter((a: any) => a.source_id === id),
    latest = rows[0],
    keys = Array.from(
      new Set<string>(rows.flatMap((r: any) => Object.keys(r.metrics))),
    );
  const selected = keys.includes(metric) ? metric : keys[0],
    points = [...rows]
      .reverse()
      .filter((r: any) => typeof r.metrics[selected] === "number"),
    lo = Math.min(...points.map((r: any) => r.metrics[selected])),
    hi = Math.max(...points.map((r: any) => r.metrics[selected]));
  const csv = (s: unknown) =>
    '"' +
    String(s ?? "")
      .replace(/^[=+\-@\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return (
    <section className="panel studio-card">
      <h2>
        <BarChart3 size={20} /> {t("Beitragsentwicklung", "Post performance")}
      </h2>
      <p>
        {t(
          "Lebenszeit-Zählerstände je Beitrag und Plattform. Keine Tageswerte und keine Summierung wiederholter Abrufe. Fehlende Kennzahlen bleiben unbekannt.",
          "Lifetime snapshots per post and platform. These are not daily increments; repeated fetches are not added together. Missing metrics stay unknown.",
        )}
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Source / post</span>
          <select value={id ?? ""} onChange={(e) => setSource(e.target.value)}>
            <option value="">Choose …</option>
            {sources.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.platform}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Metric (provider field)</span>
          <select
            value={selected ?? ""}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="">Choose …</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!latest ? (
        <p className="notice">
          {t(
            "Noch keine gespeicherten Statistiken. Eine Quelle anlegen und begrenzt abrufen.",
            "No cached metrics yet. Add a source and run a bounded fetch.",
          )}
        </p>
      ) : (
        <>
          <div className="studio-metrics">
            {Object.entries(latest.metrics).map(([k, v]) => (
              <article className="panel studio-metric" key={k}>
                <span>{label(k)}</span>
                <strong>{Number(v).toLocaleString()}</strong>
              </article>
            ))}
          </div>
          {!!points.length && (
            <svg
              className="social-chart"
              viewBox="0 0 640 180"
              role="img"
              aria-label={
                label(selected ?? "Metric") + " over cached retrieval dates"
              }
            >
              <title>
                {label(selected ?? "Metric")} — cached lifetime snapshots
              </title>
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                points={points
                  .map(
                    (r: any, i: number) =>
                      `${30 + (i * 580) / Math.max(1, points.length - 1)},${150 - ((r.metrics[selected] - lo) * 120) / Math.max(1, hi - lo)}`,
                  )
                  .join(" ")}
              />
              {points.map((r: any, i: number) => (
                <circle
                  key={r.id}
                  cx={30 + (i * 580) / Math.max(1, points.length - 1)}
                  cy={
                    150 -
                    ((r.metrics[selected] - lo) * 120) / Math.max(1, hi - lo)
                  }
                  r="5"
                  fill="currentColor"
                >
                  <title>
                    {new Date(r.retrieved_at).toLocaleString()}:{" "}
                    {r.metrics[selected]}
                  </title>
                </circle>
              ))}
            </svg>
          )}
          <p className="form-note">
            {t("Abgerufen", "Retrieved")}:{" "}
            {new Date(latest.retrieved_at).toLocaleString()} ·{" "}
            {t("Anbieterstand", "Provider timestamp")}:{" "}
            {latest.provider_updated_at || "Unknown"} ·{" "}
            {t(
              "Verfügbare Plattformdaten hängen vom Anbietertarif und Kontotyp ab.",
              "Available metrics depend on the provider plan and account type.",
            )}
          </p>
          <button
            className="secondary"
            onClick={() =>
              download(
                "social-analytics.csv",
                [
                  "source,platform,retrieved_at,provider_updated_at,metric,value",
                  ...rows.flatMap((r: any) =>
                    Object.entries(r.metrics).map(([k, v]) =>
                      [
                        r.label,
                        r.platform,
                        r.retrieved_at,
                        r.provider_updated_at,
                        k,
                        v,
                      ]
                        .map(csv)
                        .join(","),
                    ),
                  ),
                ].join("\r\n"),
                "text/csv;charset=utf-8",
              )
            }
          >
            {t("Gespeicherte Werte als CSV", "Export cached metrics as CSV")}
          </button>
          <div className="social-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Retrieved</th>
                  <th>Provider timestamp</th>
                  <th>{label(selected ?? "Metric")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td>{new Date(r.retrieved_at).toLocaleString()}</td>
                    <td>{r.provider_updated_at || "Unknown"}</td>
                    <td>{r.metrics[selected] ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
export function SocialReviews({ workspaceId }: { workspaceId: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const load = async () =>
    setData(
      await api("social/reviews", undefined, "GET", { projectScope: false }),
    );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [workspaceId]);
  if (!data?.replies.length) return error ? <p role="alert">{error}</p> : null;
  return (
    <section className="studio-hub studio-inbox">
      <h2>
        {t(
          "Social-Postfach · Antworten prüfen",
          "Social inbox · review replies",
        )}
      </h2>
      {data.replies.map((r: any) => (
        <ReplyReview
          key={r.id + ":" + r.revision + ":" + r.item_revision}
          reply={r}
          manage={["owner", "admin"].includes(data.role)}
          onDone={load}
        />
      ))}
    </section>
  );
}
function ReplyReview({ reply: r, manage, onDone }: any) {
  const { t } = useLanguage();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <article className="panel studio-card">
      <div className="studio-card-top">
        <div>
          <span className="scope-label">
            {r.project_name} · {r.platform} · {r.kind}
          </span>
          <h3>
            {t("Antwort an", "Reply to")} {r.author}
          </h3>
          <p>
            {r.connection_name} · <code>{r.recipient}</code>
          </p>
        </div>
        <span>v{r.revision}</span>
      </div>
      <p>
        <strong>{t("Eingegangener Inhalt", "Incoming content")}:</strong>
      </p>
      <p className="studio-preview">{r.original_body}</p>
      <p className="form-note">
        {t("Letzter Abruf", "Last retrieved")}:{" "}
        {new Date(r.retrieved_at).toLocaleString()} ·{" "}
        {t("Keine Live-Zustellgarantie.", "Not a live delivery guarantee.")}
      </p>
      <p>
        <strong>{t("Vorgeschlagene Antwort", "Proposed reply")}:</strong>
      </p>
      <p className="studio-preview">{r.body}</p>
      <p>
        {t("Maximal reservierte Gebühr", "Maximum reserved fee")}:{" "}
        {r.price_micro_usd == null
          ? "Price missing"
          : "USD " + moneyText(r.price_micro_usd)}{" "}
        · {t("Einmaliger Versand nach Freigabe", "One dispatch after approval")}
      </p>
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
              "social/review-action",
              {
                project_id: r.project_id,
                action: choice.value,
                id: r.id,
                expected_revision: r.revision,
                confirm: new FormData(e.currentTarget).get("confirm") === "on",
                ...(choice.value === "approve"
                  ? {
                      expected_item_revision: r.item_revision,
                      expected_connection_revision: r.connection_revision,
                      expected_price_revision: r.price_revision,
                      expected_budget_revision: r.budget_revision,
                      expected_price: String(r.price_micro_usd),
                    }
                  : {}),
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
        <label className="check-row">
          <input type="checkbox" name="confirm" disabled={!manage} />
          {t(
            "Diesen Text an diesen Empfänger über diese Verbindung zu dieser Kostenobergrenze einmalig senden.",
            "Send this exact text to this recipient through this connection at this cost ceiling once.",
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
              name="choice"
              value="approve"
              className="primary"
              disabled={busy || r.price_micro_usd == null}
            >
              {t("Antwort freigeben", "Approve reply")}
            </button>
            <button
              name="choice"
              value="reject"
              className="secondary"
              disabled={busy}
            >
              {t("Ablehnen", "Reject")}
            </button>
          </div>
        )}
      </form>
    </article>
  );
}
