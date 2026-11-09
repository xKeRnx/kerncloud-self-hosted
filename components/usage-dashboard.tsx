"use client";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Clock3,
  Cpu,
  RefreshCw,
  Zap,
} from "lucide-react";
import { api } from "./api-client";
import { useLanguage } from "./language";

type Metrics = {
  requests: number;
  tokens: number;
  credits: number;
  reserved: number;
  unknown_usage: number;
  uncertain: number;
  errors: number;
  managed_requests: number;
  byok_requests: number;
  duration_ms: number | null;
  timed: number;
  cached_tokens: number;
  cache_input_tokens: number;
  cache_reports: number;
};
type Usage = {
  renewal: {
    mode: string;
    active: boolean;
    next_at: string | null;
    ends_at: string | null;
    timezone: string;
  };
  filters: { from: string; to: string; bucket: string };
  account: {
    credits: number;
    subscription_status: string;
    plan_name: string;
    plan_credits: number;
    runtime_minutes: number;
    monthly_steps: number;
    steps_used: number;
    runtime_included: number;
    runtime_purchased: number;
    runtime_period_end: string | null;
  };
  allocation: { period: string; credits: number } | null;
  workspaces: { id: string; name: string }[];
  options: { id: string | null; name: string }[];
  totals: Metrics;
  series: (Metrics & { at: string })[];
  models: (Metrics & {
    id: string | null;
    name: string;
    provider: string;
    managed: boolean;
  })[];
  agents: (Metrics & { id: string; name: string })[];
  calls: {
    id: string;
    run_id: string;
    created_at: string;
    model: string;
    provider: string;
    workspace: string;
    agent: string;
    managed: boolean;
    status: string;
    outcome: string | null;
    usage_known: boolean;
    tokens: number;
    input_tokens: number;
    output_tokens: number;
    charged_credits: number;
    reserved: number;
    duration_ms: number | null;
    cached_tokens: number | null;
  }[];
  ledger: {
    id: string;
    amount: number;
    reason: string;
    created_at: string;
    workspace: string;
  }[];
  page: number;
  pages: number;
  generated_at: string;
};

function Trend({
  data,
  metric,
  title,
}: {
  data: Usage;
  metric: "credits" | "tokens" | "requests";
  title: string;
}) {
  const { number, localeTag, t } = useLanguage();
  const step = data.filters.bucket === "hour" ? 3600000 : 86400000,
    first = Math.floor(Date.parse(data.filters.from) / step) * step,
    end = Date.parse(data.filters.to);
  const map = new Map(data.series.map((s) => [Date.parse(s.at), s[metric]]));
  const bars: { at: number; value: number }[] = [];
  for (let x = first; x < end; x += step)
    bars.push({ at: x, value: map.get(x) ?? 0 });
  const max = Math.max(1, ...bars.map((x) => x.value)),
    width = 700,
    height = 170,
    pad = 35,
    space = (width - 2 * pad) / Math.max(1, bars.length);
  const label = (at: number) =>
    new Date(at).toLocaleString(
      localeTag,
      data.filters.bucket === "hour"
        ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
        : { day: "2-digit", month: "short", timeZone: "UTC" },
    );
  return (
    <section className="panel usage-trend">
      <div className="panel-heading">
        <h2>{title}</h2>
        <small>{t("Stunden/Tage in UTC", "Hours/days in UTC")}</small>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height + 34}`}
        role="img"
        aria-label={`${title}: ${number(bars.reduce((s, b) => s + b.value, 0))}`}
      >
        {[0, 0.5, 1].map((q) => (
          <g key={q}>
            <line
              x1={pad}
              x2={width - pad}
              y1={height - q * (height - 20)}
              y2={height - q * (height - 20)}
              stroke="var(--border)"
              strokeDasharray="3 5"
            />
            <text
              x={pad - 6}
              y={height - q * (height - 20) + 4}
              textAnchor="end"
            >
              {Intl.NumberFormat(localeTag, {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(q * max)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => (
          <rect
            key={b.at}
            x={pad + i * space + space * 0.15}
            width={Math.max(0.4, space * 0.7)}
            y={height - (b.value / max) * (height - 20)}
            height={(b.value / max) * (height - 20)}
            rx={Math.min(3, space * 0.12)}
            className={`usage-bar ${metric}`}
          >
            <title>
              {label(b.at)} UTC · {number(b.value)}
            </title>
          </rect>
        ))}
        {[0, Math.floor((bars.length - 1) / 2), bars.length - 1]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((i) => (
            <text
              key={i}
              x={pad + (i + 0.5) * space}
              y={height + 23}
              textAnchor="middle"
            >
              {label(bars[i]?.at ?? first)}
            </text>
          ))}
      </svg>
      {!data.totals.requests && (
        <p className="muted">
          {t(
            "Keine Anfragen in diesem Zeitraum.",
            "No requests in this period.",
          )}
        </p>
      )}
    </section>
  );
}

export function UsageDashboard() {
  const { t, number, localeTag, minutes } = useLanguage();
  const [range, setRange] = useState("30d"),
    [scope, setScope] = useState("all"),
    [source, setSource] = useState("all"),
    [model, setModel] = useState("all"),
    [page, setPage] = useState(1),
    [tab, setTab] = useState("overview"),
    [metric, setMetric] = useState<"credits" | "tokens" | "requests">("tokens");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(
      null,
    ),
    [data, setData] = useState<Usage | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const load = () => {
      const q = new URLSearchParams({
        range,
        workspace: scope,
        source,
        model,
        page: String(page),
        ...(range === "custom" && custom ? custom : {}),
      });
      void api<Usage>(`usage?${q}`)
        .then((x) => {
          if (alive) {
            setData(x);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [range, scope, source, model, page, revision, custom]);
  const change = (fn: () => void) => {
    setPage(1);
    fn();
  };
  const stamp = (date: string) => new Date(date).toLocaleString(localeTag);
  return (
    <div className="usage-dashboard" aria-busy={loading}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {t("DEIN VERBRAUCH IM BLICK", "UNDERSTAND YOUR USAGE")}
          </div>
          <h1>{t("Verbrauch & Statistik", "Usage & statistics")}</h1>
          <p>
            {t(
              "Modelle, Guthaben und Anfragen – über alle deine Workspaces.",
              "Models, balance and requests across your workspaces.",
            )}
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={15} />
          {t("Aktualisieren", "Refresh")}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {data && (
        <>
          <section className="usage-wallet panel">
            <div className="usage-wallet-main">
              <span className="usage-icon">
                <Coins size={22} />
              </span>
              <div>
                <span>
                  {t("Verfügbare KI-Credits", "Available AI credits")}
                </span>
                <strong>{number(data.account.credits)}</strong>
                <small>
                  {data.account.plan_name} · {data.account.subscription_status}
                </small>
              </div>
            </div>
            <div>
              <strong>
                {minutes(data.account.runtime_included)} +{" "}
                {minutes(data.account.runtime_purchased)}
              </strong>
              <span>
                {t(
                  "Hosting-Minuten: Plan + nachgekauft/geschenkt",
                  "Hosted minutes: plan + purchased/gifted",
                )}
              </span>
              <a href="/environments">
                {t("Umgebungen verwalten", "Manage environments")} →
              </a>
            </div>
            <div>
              <strong>
                {number(data.account.steps_used)} /{" "}
                {number(data.account.monthly_steps)}
              </strong>
              <span>
                {t(
                  "Modellaufrufe im aktuellen UTC-Monat",
                  "Model calls this UTC month",
                )}
              </span>
              <progress
                max={data.account.monthly_steps}
                value={data.account.steps_used}
                aria-label={t(
                  "Modellaufruf-Kontingent",
                  "Model call allowance",
                )}
              />
              <a href="/billing">{t("Plan & Guthaben", "Plan & credit")} →</a>
            </div>
          </section>
          <div className="form-note" data-testid="allowance-renewal">
            <strong>{t("Monatliche Kontingente", "Monthly allowances")}</strong>
            <p>
              {number(data.account.plan_credits)}{" "}
              {t("KI-Credits", "AI credits")} ·{" "}
              {number(data.account.runtime_minutes)}{" "}
              {t("Hosting-Minuten je Zeitraum", "hosted minutes per period")}.{" "}
              {data.renewal.mode === "monthly" ? (
                <>
                  {t(
                    "Aktive und verschenkte Abos erhalten ihre Kontingente automatisch am 1. jedes Monats (UTC), solange der Zugang gilt.",
                    "Active and gifted subscriptions receive allowances automatically on the first day of each month (UTC), while access remains valid.",
                  )}{" "}
                  {data.renewal.next_at
                    ? t("Nächste Zuteilung: ", "Next allocation: ") +
                      stamp(data.renewal.next_at)
                    : t(
                        "Keine weitere Zuteilung vor Ablauf dieses Abos.",
                        "No further allocation before this subscription expires.",
                      )}
                </>
              ) : data.renewal.mode === "payment" ? (
                t(
                  "Bei Stripe-Abos erfolgt die Erneuerung nach bestätigter Zahlung für den nächsten Abrechnungszeitraum.",
                  "Stripe subscriptions renew allowances after confirmed payment for the next billing period.",
                )
              ) : (
                t(
                  "Ohne aktives Abo erfolgt keine automatische Zuteilung.",
                  "No automatic allocation without an active subscription.",
                )
              )}
            </p>
            <small>
              {t(
                "KI-Credits werden hinzugefügt. Enthaltene Hosting-Minuten werden erneuert; zusätzliche Minuten bleiben erhalten. Bei Planwechsel erfolgt keine doppelte Monatszuteilung.",
                "AI credits are added. Included hosted minutes reset; extra minutes remain available. Plan changes do not create duplicate monthly allocations.",
              )}
            </small>
          </div>
          {data.account.credits === 0 && (
            <div className="form-note">
              <strong>{t("Warum 0 Credits?", "Why 0 credits?")}</strong>
              <p>
                {t(
                  "Aktive Abos erhalten ihr Kontingent automatisch. Ist es bereits verbraucht, warte auf den nächsten Zeitraum oder wende dich an den Betreiber. Stripe-Kontingente setzen eine bestätigte Zahlung voraus. Mit deiner eigenen KI-Verbindung (BYOK) kannst du ohne KeRnCloud-KI-Credits arbeiten; dein Anbieter rechnet separat ab.",
                  "Active subscriptions receive allowances automatically. If already used, wait for the next period or contact the operator. Stripe allowances require confirmed payment. With your own AI connection (BYOK), you can work without KeRnCloud AI credits; your provider bills separately.",
                )}
              </p>
            </div>
          )}
          <section
            className="panel usage-filters"
            aria-label={t("Verbrauch filtern", "Filter usage")}
          >
            <div className="usage-presets">
              {[
                ["24h", "24 h"],
                ["7d", t("7 Tage", "7 days")],
                ["30d", t("30 Tage", "30 days")],
                ["365d", t("365 Tage", "365 days")],
              ].map(([v, label]) => (
                <button
                  key={v}
                  aria-pressed={range === v}
                  onClick={() => change(() => setRange(v))}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Workspace</span>
              <select
                value={scope}
                onChange={(e) => change(() => setScope(e.target.value))}
              >
                <option value="all">
                  {t("Alle Workspaces", "All workspaces")}
                </option>
                {data.workspaces.map((w) => (
                  <option value={w.id} key={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("KI-Abrechnung", "AI billing")}</span>
              <select
                value={source}
                onChange={(e) => change(() => setSource(e.target.value))}
              >
                <option value="all">
                  {t("Alle Verbindungen", "All connections")}
                </option>
                <option value="managed">KeRnCloud</option>
                <option value="byok">
                  {t("Eigene KI · BYOK", "Your AI · BYOK")}
                </option>
              </select>
            </label>
            <label className="field">
              <span>{t("Modell", "Model")}</span>
              <select
                value={model}
                onChange={(e) => change(() => setModel(e.target.value))}
              >
                <option value="all">{t("Alle Modelle", "All models")}</option>
                {data.options
                  .filter((o) => o.id)
                  .map((o) => (
                    <option key={o.id} value={o.id!}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
            <details className="usage-custom">
              <summary>
                {t("Eigener Zeitraum (UTC)", "Custom period (UTC)")}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  change(() => {
                    setCustom({
                      from: new Date(String(f.get("from")) + "Z").toISOString(),
                      to: new Date(String(f.get("to")) + "Z").toISOString(),
                    });
                    setRange("custom");
                  });
                }}
              >
                <label className="field">
                  <span>{t("Von", "From")}</span>
                  <input name="from" type="datetime-local" required />
                </label>
                <label className="field">
                  <span>{t("Bis", "To")}</span>
                  <input name="to" type="datetime-local" required />
                </label>
                <button className="secondary">{t("Anwenden", "Apply")}</button>
              </form>
            </details>
          </section>
          <p className="usage-period">
            {stamp(data.filters.from)} – {stamp(data.filters.to)} ·{" "}
            {t(
              "Anzeige in deiner lokalen Zeitzone; Diagramme in UTC.",
              "Dates use your local time zone; charts use UTC.",
            )}{" "}
            {loading
              ? t("Wird aktualisiert …", "Updating …")
              : t("Aktualisiert: ", "Updated: ") + stamp(data.generated_at)}
          </p>
          <nav
            className="experience-tabs"
            aria-label={t("Statistikansicht", "Statistics view")}
          >
            {[
              ["overview", t("Übersicht", "Overview")],
              ["requests", t("Einzelne Anfragen", "Request history")],
              ["ledger", t("Credit-Buchungen", "Credit transactions")],
            ].map(([v, label]) => (
              <button
                aria-current={tab === v ? "page" : undefined}
                onClick={() => setTab(v)}
                key={v}
              >
                {label}
                {v === "requests" && (
                  <span>{number(data.totals.requests)}</span>
                )}
              </button>
            ))}
          </nav>
          {(data.totals.unknown_usage > 0 || data.totals.uncertain > 0) && (
            <p className="form-note">
              {t("Unvollständige Messwerte:", "Incomplete measurements:")}{" "}
              {number(data.totals.unknown_usage)}{" "}
              {t(
                "Anfragen ohne gemeldete Tokenzahlen;",
                "requests without reported tokens;",
              )}{" "}
              {number(data.totals.uncertain)}{" "}
              {t(
                "mit unklarem Abschluss. Token-Summen enthalten nur gemeldeten Verbrauch. Bei unklarem KI-Verbrauch können Reservierungen als Sicherheitsabbuchung bestehen bleiben.",
                "with uncertain completion. Token totals include reported usage only. When AI usage is uncertain, reservations may remain as provisional charges.",
              )}
            </p>
          )}
          {tab === "overview" && (
            <>
              <div className="usage-stat-grid">
                {[
                  {
                    label: t("KI-Credits verbraucht", "AI credits used"),
                    value: number(data.totals.credits),
                    help: t(
                      "Inkl. Sicherheitsabbuchungen; keine Euro-Kosten",
                      "Includes provisional charges; not a euro amount",
                    ),
                    icon: Coins,
                  },
                  {
                    label: t("Anfragen", "Requests"),
                    value: number(data.totals.requests),
                    help: `${number(data.totals.managed_requests)} KeRnCloud · ${number(data.totals.byok_requests)} BYOK`,
                    icon: Activity,
                  },
                  {
                    label: t("Gemeldete Tokens", "Reported tokens"),
                    value: number(data.totals.tokens),
                    help: t(
                      "Eingabe + Ausgabe; keine Schätzwerte",
                      "Input + output; no estimates",
                    ),
                    icon: Cpu,
                  },
                  {
                    label: t("Ø Antwortdauer", "Avg. response time"),
                    value:
                      data.totals.duration_ms === null
                        ? "—"
                        : (data.totals.duration_ms / 1000).toLocaleString(
                            localeTag,
                            { maximumFractionDigits: 1 },
                          ) + " s",
                    help: `${number(data.totals.timed)} / ${number(data.totals.requests)} ${t("gemessen", "measured")}`,
                    icon: Clock3,
                  },
                  {
                    label: t("Cache-Anteil (Tokens)", "Cache share (tokens)"),
                    value: data.totals.cache_input_tokens
                      ? `${((data.totals.cached_tokens / data.totals.cache_input_tokens) * 100).toLocaleString(localeTag, { maximumFractionDigits: 1 })}%`
                      : "—",
                    help: `${number(data.totals.cache_reports)} ${t("Anfragen mit Cache-Meldung", "requests reporting cache usage")}`,
                    icon: Zap,
                  },
                ].map((c) => (
                  <article className="stat-card" key={c.label}>
                    <div>
                      <c.icon size={15} />
                      {c.label}
                    </div>
                    <strong>{c.value}</strong>
                    <small>{c.help}</small>
                  </article>
                ))}
              </div>
              <div className="usage-chart-toolbar">
                <h2>{t("Verlauf", "Usage over time")}</h2>
                <div className="usage-presets">
                  {[
                    ["tokens", "Tokens"],
                    ["credits", "Credits"],
                    ["requests", t("Anfragen", "Requests")],
                  ].map(([v, l]) => (
                    <button
                      aria-pressed={metric === v}
                      key={v}
                      onClick={() => setMetric(v as typeof metric)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <Trend
                data={data}
                metric={metric}
                title={
                  metric === "credits"
                    ? t("KI-Credits im Zeitraum", "AI credits over time")
                    : metric === "tokens"
                      ? t("Tokenverbrauch im Zeitraum", "Token usage over time")
                      : t("Anfragen im Zeitraum", "Requests over time")
                }
              />
              <section className="panel usage-models">
                <div className="panel-heading">
                  <h2>{t("Nutzung nach Modell", "Usage by model")}</h2>
                  <span>
                    {data.models.length} {t("Modelle", "models")}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Modell / Anbieter", "Model / provider")}</th>
                        <th>{t("Abrechnung", "Billing")}</th>
                        <th>{t("Anfragen", "Requests")}</th>
                        <th>Tokens</th>
                        <th>Credits</th>
                        <th>{t("Unklar", "Uncertain")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.models.map((m, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{m.name}</strong>
                            <small>{m.provider}</small>
                            <div className="usage-meter">
                              <i
                                style={{
                                  width: `${data.totals.tokens ? (m.tokens / data.totals.tokens) * 100 : 0}%`,
                                }}
                              />
                            </div>
                          </td>
                          <td>{m.managed ? "KeRnCloud" : "BYOK"}</td>
                          <td>{number(m.requests)}</td>
                          <td>{number(m.tokens)}</td>
                          <td>{number(m.credits)}</td>
                          <td>{m.uncertain}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.models.length && (
                  <p className="usage-empty">
                    {t(
                      "Hier erscheinen Modelle nach dem ersten Aufruf im gewählten Zeitraum.",
                      "Models appear here after the first request in the selected period.",
                    )}
                  </p>
                )}
              </section>
              <div className="usage-two-col">
                <section className="panel usage-ranking">
                  <h2>{t("Aktivste Agenten", "Most active agents")}</h2>
                  {data.agents.map((a, i) => (
                    <div key={a.id ?? i}>
                      <span className="usage-rank">{i + 1}</span>
                      <strong>
                        {a.name}
                        <small>{number(a.tokens)} Tokens</small>
                      </strong>
                      <b>
                        {number(a.requests)} {t("Anfragen", "requests")}
                      </b>
                    </div>
                  ))}
                  {!data.agents.length && (
                    <p className="usage-empty">
                      {t("Noch keine Nutzung.", "No usage yet.")}
                    </p>
                  )}
                </section>
                <section className="panel usage-explainer">
                  <h2>
                    {t(
                      "So liest du deine Statistik",
                      "Understanding your statistics",
                    )}
                  </h2>
                  <p>
                    <strong>BYOK:</strong>{" "}
                    {t(
                      "Anbieter-Kosten fallen direkt bei deinem KI-Anbieter an. 0 Credits bedeutet hier keine KeRnCloud-Abbuchung, nicht zwingend kostenlose KI.",
                      "Provider costs are billed directly by your AI provider. 0 credits means no KeRnCloud charge, not necessarily free AI.",
                    )}
                  </p>
                  <p>
                    <strong>{t("Cache & Dauer:", "Cache & timing:")}</strong>{" "}
                    {t(
                      "Nur verfügbar, wenn gemeldet bzw. erfasst. Ältere Anfragen haben keine nachträglich erfundenen Werte. Cache-Anteil bezieht sich auf Eingabetokens der Anfragen mit Cache-Meldung.",
                      "Available only when reported or measured. Historical requests are not filled with invented values. Cache share refers to input tokens in requests reporting cache usage.",
                    )}
                  </p>
                  <p>
                    <strong>{t("Noch reserviert:", "Still reserved:")}</strong>{" "}
                    {number(data.totals.reserved)} Credits ·{" "}
                    {t(
                      "laufende Anfragen, noch nicht im Verbrauch enthalten.",
                      "in-flight requests, not included in usage yet.",
                    )}
                  </p>
                </section>
              </div>
            </>
          )}
          {tab === "requests" && (
            <section className="panel usage-models">
              <div className="panel-heading">
                <h2>{t("Anfragen im Detail", "Request details")}</h2>
                <small>
                  {t(
                    "Jeder Modellversuch zählt einzeln",
                    "Each model attempt counts separately",
                  )}
                </small>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Zeitpunkt / Auftrag", "Time / task")}</th>
                      <th>{t("Modell", "Model")}</th>
                      <th>{t("Agent / Workspace", "Agent / workspace")}</th>
                      <th>Status</th>
                      <th>Tokens</th>
                      <th>Credits</th>
                      <th>{t("Dauer", "Duration")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <a href={`/tasks/${c.run_id}`}>
                            {stamp(c.created_at)} ↗
                          </a>
                          <small>{c.id.slice(0, 8)}</small>
                        </td>
                        <td>
                          {c.model}
                          <small>
                            {c.provider} · {c.managed ? "KeRnCloud" : "BYOK"}
                          </small>
                        </td>
                        <td>
                          {c.agent}
                          <small>{c.workspace}</small>
                        </td>
                        <td>
                          <span
                            className={`usage-status ${c.status === "uncertain" || c.outcome === "error" ? "warning" : ""}`}
                          >
                            {c.status === "reserved"
                              ? t("Läuft", "In progress")
                              : c.status === "uncertain"
                                ? t("Unklar", "Uncertain")
                                : c.outcome === "error"
                                  ? t("Fehler", "Error")
                                  : c.outcome === "success"
                                    ? t("Erfolgreich", "Success")
                                    : t(
                                        "Abgerechnet · Altbestand",
                                        "Settled · historical",
                                      )}
                          </span>
                        </td>
                        <td>{c.usage_known ? number(c.tokens) : "—"}</td>
                        <td>
                          {c.status === "reserved"
                            ? `${number(c.reserved)} ${t("reserviert", "reserved")}`
                            : number(c.charged_credits)}
                        </td>
                        <td>
                          {c.duration_ms === null
                            ? "—"
                            : (c.duration_ms / 1000).toLocaleString(localeTag, {
                                maximumFractionDigits: 1,
                              }) + " s"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.calls.length && (
                <p className="usage-empty">
                  {t("Keine passenden Anfragen.", "No matching requests.")}
                </p>
              )}
              <div className="usage-pagination">
                <button
                  className="secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← {t("Zurück", "Previous")}
                </button>
                <span>
                  {page} / {data.pages}
                </span>
                <button
                  className="secondary"
                  disabled={page >= data.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("Weiter", "Next")} →
                </button>
              </div>
            </section>
          )}
          {tab === "ledger" && (
            <section className="panel usage-models">
              <div className="panel-heading">
                <h2>
                  {t("Credit-Buchungsverlauf", "Credit transaction history")}
                </h2>
                <small>
                  {t(
                    "Letzte 100 Buchungen im Zeitraum · Modellfilter gilt hier nicht",
                    "Last 100 transactions in period · model filter does not apply here",
                  )}
                </small>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Zeitpunkt", "Time")}</th>
                      <th>
                        {t("Buchung / Workspace", "Transaction / workspace")}
                      </th>
                      <th>Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((l) => (
                      <tr key={l.id}>
                        <td>{stamp(l.created_at)}</td>
                        <td>
                          {l.reason}
                          <small>{l.workspace}</small>
                        </td>
                        <td className={l.amount >= 0 ? "credit-positive" : ""}>
                          {l.amount >= 0 ? (
                            <ArrowDownLeft size={13} />
                          ) : (
                            <ArrowUpRight size={13} />
                          )}{" "}
                          {l.amount > 0 ? "+" : ""}
                          {number(l.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.ledger.length && (
                <p className="usage-empty">
                  {t(
                    "Keine Credit-Buchungen in diesem Zeitraum. BYOK-Aufrufe erzeugen keine KeRnCloud-Credit-Abbuchung.",
                    "No credit transactions in this period. BYOK requests create no KeRnCloud credit charge.",
                  )}
                </p>
              )}
            </section>
          )}
        </>
      )}
      {!data && !error && (
        <p role="status">{t("Verbrauch wird geladen …", "Loading usage …")}</p>
      )}
    </div>
  );
}
