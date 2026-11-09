"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  Globe2,
  Code2,
  Server,
  Play,
  Square,
  ArrowRightLeft,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function EnvironmentOverview() {
  const { t, number, date } = useLanguage();
  const [data, setData] = useState<any>(null),
    [project, setProject] = useState(""),
    [status, setStatus] = useState("all"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [transfer, setTransfer] = useState<any>(null);
  const dialog = useRef<HTMLElement>(null),
    target = useRef<HTMLSelectElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    sequence = useRef(0);
  const url = useCallback(() => {
    const p = new URLSearchParams({ status, query, page: String(page) });
    if (project) p.set("filterProject", project);
    return "environments/overview?" + p;
  }, [project, status, query, page]);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const d = await api(url());
      if (seq === sequence.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => {
      clearInterval(timer);
      ++sequence.current;
    };
  }, [load]);
  useEffect(() => {
    if (!transfer) return;
    target.current?.focus();
    return () => trigger.current?.focus();
  }, [Boolean(transfer)]);
  const state = (s: string) => {
    const labels: Record<string, string> = {
      booked: t("Gebucht · gestoppt", "Booked · stopped"),
      running: t("Läuft", "Running"),
      stopped: t("Gestoppt", "Stopped"),
      pending: t("Vorgang läuft", "Action pending"),
      failed: t("Fehler", "Failed"),
      uncertain: t("Betreiberprüfung nötig", "Operator review needed"),
      exited: t("Gestoppt", "Stopped"),
    };
    return labels[s] ?? s;
  };
  async function act(e: any, action: string, targetProjectId?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("environments/overview/manage", {
        id: e.id,
        action,
        expectedProjectId: e.project_id,
        ...(action === "start" ? { expectedRate: e.current_rate } : {}),
        ...(targetProjectId ? { targetProjectId } : {}),
      });
      setTransfer(null);
      await load();
      setNotice(
        action === "assign"
          ? t(
              "Projektzuordnung geändert. Deine aktive Projektauswahl bleibt erhalten.",
              "Project assignment changed. Your active project selection is unchanged.",
            )
          : t(
              "Aktion angenommen. Der Status aktualisiert sich automatisch; der Container bestätigt den Abschluss.",
              "Action accepted. Status updates automatically; the container confirms completion.",
            ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("target") as string;
    if (value) void act(transfer, "assign", value);
  };
  return (
    <section className="workspace-env-hub">
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <h1>{t("Alle Umgebungen", "All environments")}</h1>
          <p>
            {t(
              "Browser und Entwicklungsumgebungen über alle Projekte dieses Workspace. Filter und Aktionen ändern deine aktive Projektauswahl nicht.",
              "Browsers and development environments across every project in this workspace. Filters and actions do not change your active project selection.",
            )}
          </p>
        </div>
        <Link className="button secondary" href="/environments">
          {t("Im aktiven Projekt buchen", "Book in active project")}
        </Link>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="form-note">
          {notice}
        </p>
      )}
      {data && (
        <div className="workspace-env-summary">
          {[
            [t("Umgebungen", "Environments"), data.summary.total],
            [t("Laufen", "Running"), data.summary.running],
            [t("Gestoppt", "Stopped"), data.summary.stopped],
            [t("Vorgänge offen", "Pending actions"), data.summary.pending],
          ].map(([label, value]) => (
            <div className="panel" key={label}>
              <span>{label}</span>
              <strong>{number(Number(value))}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="panel workspace-env-hub-filters">
        <label className="field">
          <span>{t("Projektfilter", "Project filter")}</span>
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("Alle Projekte", "All projects")}</option>
            {data?.projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("Alle Status", "All statuses")}</option>
            {[
              "booked",
              "running",
              "stopped",
              "pending",
              "failed",
              "uncertain",
              "exited",
            ].map((s) => (
              <option key={s} value={s}>
                {state(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            {t("Umgebung oder Projekt suchen", "Search environment or project")}
          </span>
          <input
            type="search"
            maxLength={100}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
          aria-label={t("Übersicht aktualisieren", "Refresh overview")}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="form-note workspace-env-hub-note">
        {t(
          "Hosting-Plätze und Minuten sind kontoweit geteilt. Starten reserviert die erste Laufzeitminute. Eigene Rechner verbrauchen keine Hosting-Minuten. Eine neue Zuordnung ist nur gestoppt bzw. noch nicht gestartet, ohne aktive Abrechnung und ohne offene oder ungeklärte Aktionen möglich.",
          "Hosted slots and minutes are shared by the account. Starting reserves the first runtime minute. Your own hosts use no hosted minutes. Reassignment requires a stopped or not-yet-started environment, inactive billing and no pending or uncertain actions.",
        )}
      </p>
      {!data ? (
        <p role="status">
          {t("Umgebungen werden geladen …", "Loading environments …")}
        </p>
      ) : (
        <>
          <p className="workspace-env-count">
            {data.total} {t("Treffer", "matches")} · {t("Seite", "Page")}{" "}
            {data.page}/{Math.max(1, Math.ceil(data.total / data.page_size))}
            {!data.can_manage &&
              " · " + t("Lesender Zugriff", "Read-only access")}
          </p>
          <div className="workspace-env-hub-grid">
            {data.environments.map((e: any) => {
              const moving =
                e.pending_job || e.pending_tools || e.reserved_minute;
              const canMove =
                ["booked", "stopped"].includes(e.status) &&
                !e.billing_active &&
                !moving;
              const Icon = e.template_id === "browser" ? Globe2 : Code2;
              return (
                <article
                  className="panel workspace-env-hub-card"
                  key={e.id}
                  aria-label={e.name}
                >
                  <div className="workspace-env-card-heading">
                    <Icon size={23} />
                    <h2>{e.name}</h2>
                    <span className={"badge status-" + e.status}>
                      {state(e.status)}
                    </span>
                  </div>
                  <div className="workspace-env-assignment">
                    <span>{t("Zugeordnetes Projekt", "Assigned project")}</span>
                    <Link href={"/projects/" + e.project_id}>
                      {e.project_name}
                    </Link>
                  </div>
                  <dl>
                    <div>
                      <dt>{t("Typ", "Type")}</dt>
                      <dd>{e.template_name}</dd>
                    </div>
                    <div>
                      <dt>
                        <Server size={13} /> {t("Standort", "Location")}
                      </dt>
                      <dd>
                        {e.host_name} ·{" "}
                        {e.billing_source === "customer"
                          ? t("Eigener Rechner", "Own host")
                          : "KeRnCloud"}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Ressourcen", "Resources")}</dt>
                      <dd>
                        {e.cpu} CPU · {e.memory_mb} MiB
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Laufzeittarif", "Runtime rate")}</dt>
                      <dd>
                        {e.billing_source === "customer"
                          ? t("Keine Hosting-Minuten", "No hosted minutes")
                          : number(e.current_rate) +
                            " " +
                            t(
                              "Hosting-Min. je Minute",
                              "hosted min per minute",
                            )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Aktualisiert", "Updated")}</dt>
                      <dd>{date(e.updated_at)}</dd>
                    </div>
                  </dl>
                  {e.last_error && (
                    <p className="workspace-env-last-error">{e.last_error}</p>
                  )}
                  {moving && (
                    <p className="workspace-env-operation-note">
                      {t(
                        "Eine Aktion läuft oder benötigt Klärung. Start und Zuordnung sind bis dahin gesperrt.",
                        "An action is pending or needs review. Start and reassignment are blocked until it is resolved.",
                      )}
                    </p>
                  )}
                  {data.can_manage && (
                    <div className="workspace-env-hub-actions">
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          moving ||
                          !e.self_service ||
                          !["booked", "stopped", "exited", "failed"].includes(
                            e.status,
                          )
                        }
                        onClick={() => void act(e, "start")}
                      >
                        <Play size={14} />
                        {t("Starten", "Start")}
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          e.pending_job ||
                          !["running", "failed", "exited"].includes(e.status)
                        }
                        onClick={() => void act(e, "stop")}
                      >
                        <Square size={14} />
                        {t("Stoppen", "Stop")}
                      </button>
                      <button
                        className="secondary"
                        disabled={busy || !canMove || data.projects.length < 2}
                        onClick={(event) => {
                          trigger.current = event.currentTarget;
                          setError("");
                          setTransfer(e);
                        }}
                      >
                        <ArrowRightLeft size={14} />
                        {t("Projekt zuordnen", "Assign project")}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!data.environments.length && (
            <div className="panel workspace-env-hub-empty">
              <Globe2 size={28} />
              <h2>{t("Keine Umgebungen gefunden", "No environments found")}</h2>
              <p>
                {t(
                  "Passe die Filter an oder buche eine Umgebung im gewünschten Projekt.",
                  "Adjust the filters or book an environment in the project you want.",
                )}
              </p>
            </div>
          )}
          <div className="workspace-env-pagination">
            <button
              className="secondary"
              disabled={page <= 1 || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("Zurück", "Previous")}
            </button>
            <button
              className="secondary"
              disabled={page * data.page_size >= data.total || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("Weiter", "Next")}
            </button>
          </div>
        </>
      )}
      {transfer && (
        <div className="workspace-env-transfer-backdrop">
          <section
            className="panel workspace-env-transfer-dialog"
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-env-transfer-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) setTransfer(null);
              if (event.key === "Tab") {
                const elements = dialog.current?.querySelectorAll<HTMLElement>(
                  "button:not(:disabled),select:not(:disabled)",
                );
                if (!elements?.length) return;
                const first = elements[0],
                  last = elements[elements.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <header>
              <h2 id="workspace-env-transfer-title">
                {t("Umgebung neu zuordnen", "Reassign environment")}
              </h2>
              <button
                className="icon-button"
                aria-label={t("Schließen", "Close")}
                disabled={busy}
                onClick={() => setTransfer(null)}
              >
                <X size={18} />
              </button>
            </header>
            <p>
              <strong>{transfer.name}</strong> · {transfer.project_name}
            </p>
            <p>
              {t(
                "Die gespeicherten Dateien bleiben erhalten und sind anschließend für die berechtigten Agenten des Zielprojekts erreichbar. Deine aktive Projektauswahl bleibt unverändert.",
                "Saved files remain and become reachable by the target project's authorised agents. Your active project selection stays unchanged.",
              )}
            </p>
            {error && (
              <p role="alert" className="error-box">
                {error}
              </p>
            )}
            <form onSubmit={submit}>
              <label className="field">
                <span>{t("Zielprojekt", "Target project")}</span>
                <select
                  ref={target}
                  required
                  name="target"
                  defaultValue=""
                  disabled={busy}
                >
                  <option value="" disabled>
                    {t("Projekt auswählen …", "Choose project …")}
                  </option>
                  {data.projects
                    .filter((p: any) => p.id !== transfer.project_id)
                    .map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="organisation-actions">
                <button className="primary" disabled={busy}>
                  {t("Zuordnung ändern", "Change assignment")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setTransfer(null)}
                >
                  {t("Abbrechen", "Cancel")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
