"use client";
import Link from "next/link";
import {
  Globe2,
  Code2,
  Plus,
  Server,
  Monitor,
  Wallet,
  ArrowRight,
} from "lucide-react";
import { useLanguage } from "./language";
import { CheckpointPanel } from "./agent-safety";
import { EnvironmentAgentAccess } from "./environment-agent-access";
import { CustomerHosts } from "./customer-hosts";
import { useEffect, useState } from "react";
import { api } from "./api-client";
type Environment = {
  billing_source: "hosted" | "customer";
  host_id: string;
  host_name: string;
  id: string;
  name: string;
  status: string;
  template_id: string;
  runtime_rate: number;
  access_blocked: boolean;
  last_error: string | null;
  relay_seen: string | null;
  updated_at: string;
  self_service: boolean;
  agent_permissions: string[];
  agent_ids: string[];
  controller_seen: string | null;
};
type Catalog = {
  id: string;
  name: string;
  cpu: number;
  memory_mb: number;
  runtime_rate: number;
};
type Runtime = {
  agents: { id: string; name: string }[];
  tool_activity: {
    id: string;
    tool: string;
    status: string;
    result: unknown;
    created_at: string;
    environment_name: string;
    agent_name: string;
  }[];
  payments_enabled: boolean;
  environments: Environment[];
  catalog: Catalog[];
  eligible: boolean;
  plan: {
    name: string;
    runtime_minutes: number;
    max_local_environments: number;
    max_running_local: number;
    max_environments: number;
    max_running_environments: number;
  };
  usage: {
    booked: number;
    running: number;
    local_booked: number;
    local_running: number;
  };
  locations: { id: string; name: string; available: boolean }[];
  location_status: {
    hosted_plan: boolean;
    local_plan: boolean;
    hosted_allowed: boolean;
    hosted_ready: boolean;
  };
  balance: {
    included: number;
    purchased: number;
    debt: number;
    period_end: string | null;
  };
  products: {
    id: string;
    name: string;
    minutes: number;
    price_cents: number;
    configured: boolean;
  }[];
  ledger: {
    id: string;
    kind: string;
    amount: number;
    reason: string;
    created_at: string;
  }[];
};
const states: Record<string, string> = {
  booked: "Gebucht · gestoppt",
  pending: "Vorgang läuft",
  running: "Läuft",
  stopped: "Gestoppt",
  deleted: "Entfernt",
  failed: "Fehler",
  uncertain: "Betreiberprüfung nötig",
  exited: "Gestoppt",
};
export function CustomerEnvironments() {
  const { ui, localeTag, minutes, t: tr } = useLanguage();
  const [location, setLocation] = useState("");
  const [section, setSection] = useState("mine");

  const [data, setData] = useState<Runtime | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [terms, setTerms] = useState(false),
    [confirm, setConfirm] = useState<{
      environment: Environment;
      action: "reset" | "delete";
    } | null>(null);
  const load = () => api<Runtime>("runtime").then(setData);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void api<Runtime>("runtime")
        .then((x) => {
          if (alive) setData(x);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function manage(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("environments/manage", body);
      if ((body as { action?: string }).action === "book") setSection("mine");
      setConfirm(null);
      await load();
      setNotice(
        ui("Aktion übernommen. Der Status wird automatisch aktualisiert."),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(environment: Environment) {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setError("");
    try {
      const r = await api<{ url: string }>("environments/launch", {
        id: environment.id,
      });
      if (tab) tab.location.replace(r.url);
      else {
        setError(
          ui("Bitte Pop-ups für diesen Workspace zulassen und erneut öffnen."),
        );
      }
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  }
  if (!data)
    return <p role="status">{error || ui("Umgebungen werden geladen …")}</p>;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("DEIN WORKSPACE")}</div>
          <h1>{ui("Browser & Entwicklungsumgebungen")}</h1>
          <p className="environment-project-scope">
            {tr(
              "Browser und Entwicklungsumgebungen gehören jeweils zu einem Projekt. Dessen berechtigte Agenten können sie nutzen. Plätze und Hosting-Minuten werden kontoweit geteilt; Ausführungsorte gelten für den gesamten Workspace.",
              "Each browser and development environment belongs to one project and can be used by its authorised agents. Slots and hosting minutes are shared across your account; execution locations apply to the whole workspace.",
            )}
          </p>
          <p>
            {ui(
              "Buche eigene Arbeitsumgebungen und behalte Laufzeit, Speicherplätze und Verbrauch im Blick.",
            )}
          </p>
        </div>
        <Link className="button secondary" href="/environments/all">
          {tr(
            "Alle Projekte · Umgebungsübersicht",
            "All projects · Environment overview",
          )}
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
      <div className="environment-intro">
        <article>
          <span className="usage-icon">
            <Globe2 size={23} />
          </span>
          <div>
            <h2>{tr("Browser", "Browser")}</h2>
            <p>
              {tr(
                "Ein eigener Chromium-Desktop für Webseiten, Recherche und Browseraktionen. Du kannst ihn selbst öffnen oder ausgewählten Agenten Zugriff geben.",
                "Your own Chromium desktop for websites, research and browser actions. Open it yourself or grant access to selected agents.",
              )}
            </p>
          </div>
        </article>
        <article>
          <span className="usage-icon purple">
            <Code2 size={23} />
          </span>
          <div>
            <h2>{tr("Entwicklungsumgebung", "Development environment")}</h2>
            <p>
              {tr(
                "Ein Code-Editor mit Terminal und Projektdateien. Für Programmieren, Git und Tests – manuell oder durch berechtigte Agenten.",
                "A code editor with a terminal and project files. For programming, Git and tests, manually or through permitted agents.",
              )}
            </p>
          </div>
        </article>
      </div>
      <div className="environment-overview">
        <article>
          <Server size={18} />
          <span>{tr("KeRnCloud-Hosting", "KeRnCloud hosting")}</span>
          <strong>
            {data.usage.booked} / {data.plan.max_environments}
          </strong>
          <small>
            {data.usage.running} / {data.plan.max_running_environments}{" "}
            {tr("gleichzeitig aktiv", "running at once")}
          </small>
        </article>
        <article>
          <Monitor size={18} />
          <span>{tr("Eigene Rechner", "Your hosts")}</span>
          <strong>
            {data.usage.local_booked} / {data.plan.max_local_environments}
          </strong>
          <small>
            {data.usage.local_running} / {data.plan.max_running_local}{" "}
            {tr("gleichzeitig aktiv", "running at once")}
          </small>
        </article>
        <article>
          <Wallet size={18} />
          <span>
            {tr("Hosting-Minuten verfügbar", "Hosted minutes available")}
          </span>
          <strong>
            {minutes(data.balance.included + data.balance.purchased)}
          </strong>
          <small>
            {minutes(data.balance.included)}{" "}
            {tr("aus dem Plan", "from your plan")} +{" "}
            {minutes(data.balance.purchased)} {tr("zusätzlich", "extra")}
          </small>
        </article>
        <article>
          <Globe2 size={18} />
          <span>{tr("Ausführungsorte", "Execution locations")}</span>
          <strong>{data.locations.filter((h) => h.available).length}</strong>
          <small>
            {tr("bereit für diesen Workspace", "ready for this workspace")}
          </small>
        </article>
      </div>
      <nav
        className="experience-tabs"
        aria-label={tr("Umgebungsbereiche", "Environment sections")}
      >
        {[
          ["mine", tr("Meine Umgebungen", "My environments")],
          ["book", tr("Neue Umgebung", "New environment")],
          ["hosts", tr("Eigene Rechner & Standorte", "Your hosts & locations")],
          ["billing", tr("Minuten & Abrechnung", "Minutes & billing")],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            aria-current={section === id ? "page" : undefined}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === "hosts" && (
        <>
          <div className="form-note">
            <h2>
              {tr(
                "Wo soll dein Team arbeiten?",
                "Where should your team work?",
              )}
            </h2>
            <p>
              {tr(
                "KeRnCloud-Hosting nutzt gebuchte Laufzeit-Minuten. Ein eigener Rechner nutzt deine Hardware und keine Hosting-Minuten. Der Connector stellt dort neue Umgebungen bereit. Wähle ausdrücklich, welche Standorte dieser Workspace verwenden darf; es gibt keinen automatischen Wechsel in die Cloud.",
                "KeRnCloud hosting uses runtime minutes. Your own host uses your hardware and no hosted minutes. The connector provisions new environments there. Explicitly choose the locations this workspace may use; there is no automatic cloud fallback.",
              )}
            </p>
            <p>
              {tr(
                "Dateien und Befehle bleiben auf dem gewählten Rechner. Inhalte können bei Agentennutzung an den gewählten KI-Anbieter und an KeRnCloud übertragen werden.",
                "Files and commands stay on the chosen host. When agents work, content can be sent to the selected AI provider and KeRnCloud.",
              )}
            </p>
          </div>
          <section className="panel settings-panel">
            <h2>
              {tr("Eigene Rechner & Standorte", "Your hosts & locations")}
            </h2>
            <p>
              {tr(
                "Diese Einstellungen gelten für den gesamten Workspace.",
                "These settings apply to the entire workspace.",
              )}
            </p>
            <a className="button secondary" href="/settings/hosts">
              {tr("Ausführungsorte verwalten", "Manage execution locations")} →
            </a>
          </section>
        </>
      )}
      {data.balance.debt > 0 && (
        <p className="error-box">
          {ui("Offene Guthabenkorrektur: ")}
          {minutes(data.balance.debt)}
          {ui(" Minuten. Neues Guthaben gleicht diese zuerst aus.")}
        </p>
      )}
      {!data.eligible && (
        <p className="form-note">
          {ui(
            "Dein aktueller Plan erlaubt keine laufenden Umgebungen. Bestehende Umgebungen kannst du weiterhin stoppen oder entfernen. Pläne verwaltest du unter ",
          )}
          <a href="/billing">{ui("Plan & Guthaben")}</a>.
        </p>
      )}
      {section === "book" && (
        <section className="panel settings-panel environment-booking">
          <div className="panel-heading">
            <div>
              <h2>
                {tr(
                  "In drei Schritten zum Arbeitsplatz",
                  "Set up your workspace in three steps",
                )}
              </h2>
              <p>
                {tr(
                  "1. Standort wählen → 2. Umgebung buchen → 3. Starten & Agenten freigeben",
                  "1. Choose location → 2. Book environment → 3. Start & grant agent access",
                )}
              </p>
            </div>
          </div>
          <label className="field environment-location">
            <span>
              {tr(
                "1 · Wo soll die Umgebung laufen?",
                "1 · Where should the environment run?",
              )}
            </span>
            <select
              aria-label={tr("Ausführungsort", "Execution location")}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={!data.locations.some((h) => h.available)}
            >
              <option value="">
                {tr("Standort bewusst auswählen …", "Choose a location …")}
              </option>
              {data.locations.map((h) => (
                <option value={h.id} key={h.id} disabled={!h.available}>
                  {h.name}
                  {!h.available
                    ? tr(" · offline / nicht bereit", " · offline / not ready")
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="form-note">
            {location === "hosted"
              ? tr(
                  "KeRnCloud-Server: Minuten werden erst beim Start verbraucht. KI-Credits werden getrennt abgerechnet.",
                  "KeRnCloud server: minutes are consumed only after starting. AI credits are billed separately.",
                )
              : location
                ? tr(
                    "Eigener Rechner: keine Hosting-Minuten. Hardware, Strom und KI-Anbieter zahlst du selbst.",
                    "Your host: no hosted minutes. You cover hardware, power and AI provider fees.",
                  )
                : tr(
                    "Die Buchung erstellt zunächst einen gestoppten Platz. Sie verbraucht noch keine Laufzeit-Minuten.",
                    "Booking creates a stopped slot initially. It does not consume runtime minutes yet.",
                  )}
          </p>
          <p>
            {data.plan.name} · {data.plan.max_environments}{" "}
            {tr("Hosting-Plätze und", "hosted slots and")}{" "}
            {data.plan.max_local_environments}{" "}
            {tr(
              "lokale Plätze. Gestoppte Umgebungen behalten ihre Dateien und belegen weiter einen Platz.",
              "local slots. Stopped environments retain their files and still occupy a slot.",
            )}
          </p>
          <div className="environment-catalog">
            {!data.locations.some((h) => h.available) && (
              <div className="form-note" role="status">
                <strong>
                  {tr(
                    "Kein verfügbarer Ausführungsort",
                    "No execution location available",
                  )}
                </strong>
                <p>
                  {!data.eligible
                    ? tr(
                        "Dein Plan oder Zugangsstatus erlaubt derzeit keine Umgebungsbuchung. Unter Plan & Guthaben kannst du die Freischaltung prüfen.",
                        "Your plan or access status does not currently allow booking environments. Review your access under Plan & credit.",
                      )
                    : !data.locations.length
                      ? tr(
                          "Für diesen Workspace ist kein zulässiger Standort ausgewählt. Erlaube KeRnCloud-Hosting oder verbinde einen eigenen Rechner und wähle ihn unter Ausführungsorte aus.",
                          "No permitted location is selected for this workspace. Allow KeRnCloud hosting or connect your own host and select it under execution locations.",
                        )
                      : tr(
                          "Die ausgewählten Standorte sind offline oder noch nicht vollständig eingerichtet. Starte deinen Connector oder kontaktiere den Betreiber.",
                          "Selected locations are offline or not fully configured. Start your connector or contact the operator.",
                        )}
                </p>
                <a href="/billing">
                  {tr("Plan & Guthaben prüfen", "Review plan & credit")}
                </a>
              </div>
            )}
            {data.catalog.map((t) => (
              <form
                key={t.id}
                data-template={t.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void manage({
                    action: "book",
                    templateId: t.id,
                    name: f.get("name"),
                    expectedRate: t.runtime_rate,
                    hostId: f.get("hostId"),
                  });
                }}
              >
                <h3>{ui(t.name)}</h3>
                <input type="hidden" name="hostId" value={location} />
                <span className="environment-template-icon">
                  {t.id === "browser" ? (
                    <Globe2 size={28} />
                  ) : (
                    <Code2 size={28} />
                  )}
                </span>
                <p className="environment-description">
                  {t.id === "browser"
                    ? tr(
                        "Webseiten bedienen, recherchieren und Abläufe im Browser erledigen.",
                        "Browse websites, research and complete browser workflows.",
                      )
                    : tr(
                        "Code schreiben, Dateien bearbeiten, Git nutzen und Tests im Terminal ausführen.",
                        "Write code, edit files, use Git and run tests in a terminal.",
                      )}
                </p>
                <p>
                  {t.cpu} CPUs · {t.memory_mb} MiB RAM
                </p>
                <p>
                  KeRnCloud-Hosting:{" "}
                  <strong>
                    {t.runtime_rate}{" "}
                    {tr(
                      "Laufzeit-Min. pro angefangener Betriebsminute",
                      "runtime min per started running minute",
                    )}
                  </strong>
                </p>
                {location && location !== "hosted" && (
                  <p>
                    {tr(
                      "Eigener Rechner: keine KeRnCloud-Laufzeit-Minuten. Hardware, Strom und ggf. KI-Anbieter zahlst du selbst.",
                      "Your host: no KeRnCloud runtime minutes. You cover hardware, power and any AI provider fees.",
                    )}
                  </p>
                )}
                <label className="field">
                  <span>{ui("Name der Umgebung")}</span>
                  <input
                    name="name"
                    defaultValue={
                      t.id === "browser"
                        ? ui("Mein Browser")
                        : ui("Meine Entwicklungsumgebung")
                    }
                    required
                    maxLength={100}
                  />
                </label>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !data.eligible ||
                    !location ||
                    !data.locations.find((h) => h.id === location)?.available ||
                    (location === "hosted"
                      ? data.usage.booked >= data.plan.max_environments
                      : data.usage.local_booked >=
                        data.plan.max_local_environments)
                  }
                >
                  {tr("2 · Gestoppt buchen", "2 · Book stopped environment")}
                </button>
              </form>
            ))}
          </div>
          {!data.catalog.length && (
            <p>
              {ui("Noch keine passende Vorlage für deinen Plan freigegeben.")}
            </p>
          )}
          {!data.locations.some((h) => h.available) && (
            <button className="secondary" onClick={() => setSection("hosts")}>
              {tr("Standorte einrichten", "Set up locations")}{" "}
              <ArrowRight size={15} />
            </button>
          )}
        </section>
      )}
      {section === "mine" && (
        <>
          <details className="panel settings-panel agent-tool-activity">
            <summary>
              {ui("Agenten-Aktivität ·")}{" "}
              {
                data.tool_activity.filter(
                  (j) => j.status === "running" || j.status === "queued",
                ).length
              }{" "}
              {ui("aktiv")}
            </summary>
            <p>
              {ui(
                "Aktive Aktionen und die letzten Ergebnisse dieses Workspaces. Workspace- oder Agenten-Stopp beendet laufende Befehle; bereits ausgelöste externe Wirkungen können bestehen bleiben.",
              )}
            </p>
            {data.tool_activity.length ? (
              data.tool_activity.map((j) => (
                <details className="artifact" key={j.id}>
                  <summary>
                    {j.agent_name} · {j.environment_name} ·{" "}
                    {(
                      {
                        environment_command: ui("Terminalbefehl"),
                        environment_read_file: ui("Datei lesen"),
                        environment_write_file: ui("Datei bearbeiten"),
                        environment_browser: ui("Browser bedienen"),
                      } as Record<string, string>
                    )[j.tool] ?? j.tool}{" "}
                    ·{" "}
                    {{
                      queued: ui("Wartet"),
                      running: ui("Läuft"),
                      done: ui("Abgeschlossen"),
                      uncertain: ui("Unterbrochen – Ergebnis prüfen"),
                      canceled: ui("Abgebrochen"),
                    }[j.status] ?? j.status}
                  </summary>
                  <p>{new Date(j.created_at).toLocaleString(localeTag)}</p>
                  {j.result !== null && (
                    <pre>{JSON.stringify(j.result, null, 2)}</pre>
                  )}
                </details>
              ))
            ) : (
              <p className="form-note">
                {ui("Noch keine Containeraktionen durch Agenten.")}
              </p>
            )}
          </details>
          <section className="panel settings-panel customer-environments-panel">
            <div className="panel-heading">
              <div>
                <h2>{tr("Deine Arbeitsplätze", "Your environments")}</h2>
                <p>
                  {tr(
                    "Umgebungen im ausgewählten Projekt. Plätze und Hosting-Minuten werden kontoweit geteilt.",
                    "Environments in the selected project. Allowances are shared across your account.",
                  )}
                </p>
              </div>
              <button className="primary" onClick={() => setSection("book")}>
                <Plus size={15} />
                {tr("Neue Umgebung", "New environment")}
              </button>
            </div>
            {data.environments
              .filter((e) => e.status !== "deleted")
              .map((e) => {
                const rate =
                  e.status === "running"
                    ? e.runtime_rate
                    : (data.catalog.find((t) => t.id === e.template_id)
                        ?.runtime_rate ?? e.runtime_rate);
                const inProgress = ["pending", "uncertain"].includes(e.status);
                return (
                  <article
                    className="host-card customer-environment"
                    data-environment={e.id}
                    key={e.id}
                  >
                    <div className="panel-heading">
                      <div>
                        <div className="environment-card-title">
                          <span
                            className={`usage-icon ${e.template_id === "development" ? "purple" : ""}`}
                          >
                            {e.template_id === "browser" ? (
                              <Globe2 size={23} />
                            ) : (
                              <Code2 size={23} />
                            )}
                          </span>
                          <div>
                            <span className="eyebrow">
                              {e.template_id === "browser"
                                ? tr("BROWSER", "BROWSER")
                                : tr("ENTWICKLUNG", "DEVELOPMENT")}
                            </span>
                            <h3>{e.name}</h3>
                          </div>
                        </div>
                        <p>
                          {e.host_name} ·{" "}
                          {e.billing_source === "customer"
                            ? tr(
                                "Eigener Rechner · keine Hosting-Minuten",
                                "Your host · no hosted minutes",
                              )
                            : rate}
                          {e.billing_source !== "customer" && (
                            <>
                              {ui(" Laufzeit-Minute")}
                              {rate !== 1 ? "n" : ""}
                              {ui(" / Betriebsminute")}
                            </>
                          )}
                        </p>
                      </div>
                      <span className="infra-state">
                        {ui(states[e.status] ?? e.status)}
                      </span>
                    </div>
                    {e.status === "running" && (
                      <CheckpointPanel environmentId={e.id} />
                    )}
                    {e.last_error && (
                      <p className="form-note">{ui(e.last_error)}</p>
                    )}
                    <div className="button-row">
                      {e.status === "running" && !e.access_blocked && (
                        <button
                          className="primary"
                          data-action="open"
                          onClick={() => void open(e)}
                        >
                          {ui("Geschützt öffnen ↗")}
                        </button>
                      )}
                      {(["booked", "stopped", "failed", "exited"].includes(
                        e.status,
                      ) ||
                        (e.status === "running" && e.access_blocked)) && (
                        <button
                          className="primary"
                          data-action="start"
                          disabled={
                            busy ||
                            !data.eligible ||
                            !data.locations.some(
                              (h) =>
                                h.available &&
                                h.id ===
                                  (e.billing_source === "customer"
                                    ? e.host_id
                                    : "hosted"),
                            )
                          }
                          onClick={() =>
                            void manage({
                              action: "start",
                              id: e.id,
                              expectedRate: rate,
                            })
                          }
                        >
                          {e.status === "running"
                            ? tr("Zugang wiederherstellen", "Restore access")
                            : ui("Starten")}
                        </button>
                      )}
                      {e.status === "running" && (
                        <button
                          className="secondary"
                          data-action="stop"
                          disabled={busy}
                          onClick={() =>
                            void manage({ action: "stop", id: e.id })
                          }
                        >
                          {ui("Stoppen")}
                        </button>
                      )}
                      <button
                        className="secondary"
                        data-action="reset"
                        disabled={
                          busy ||
                          inProgress ||
                          e.status === "booked" ||
                          !data.eligible
                        }
                        onClick={() =>
                          setConfirm({ environment: e, action: "reset" })
                        }
                      >
                        {ui("Neu aufsetzen")}
                      </button>
                      <button
                        className="secondary"
                        data-action="delete"
                        disabled={busy || inProgress}
                        onClick={() =>
                          setConfirm({ environment: e, action: "delete" })
                        }
                      >
                        {ui("Entfernen")}
                      </button>
                    </div>
                    <p className="environment-next-step">
                      {e.status === "running"
                        ? tr(
                            "Bereit: Umgebung öffnen oder unten Agenten Zugriff erteilen. Mit Stoppen endet die weitere Minutenabrechnung.",
                            "Ready: open the environment or grant agent access below. Stopping ends further runtime billing.",
                          )
                        : tr(
                            "Nächster Schritt: Starten. Deine Dateien bleiben beim Stoppen erhalten. Neu aufsetzen löscht die Arbeitsdateien.",
                            "Next: start the environment. Stopping preserves your files. Reset deletes working files.",
                          )}
                    </p>
                    <details className="environment-permissions">
                      <summary>
                        {tr(
                          "Agentenzugriff & Berechtigungen",
                          "Agent access & permissions",
                        )}
                      </summary>
                      <p>
                        {tr(
                          "Agenten können diese Umgebung erst nach ausdrücklicher Freigabe nutzen.",
                          "Agents can use this environment only after explicit permission.",
                        )}
                      </p>
                      <EnvironmentAgentAccess
                        key={e.agent_permissions.join() + e.agent_ids.join()}
                        environment={e}
                        agents={data.agents}
                        onChanged={load}
                      />
                    </details>
                    {confirm?.environment.id === e.id && (
                      <form
                        className="environment-confirm"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const f = new FormData(event.currentTarget);
                          void manage({
                            action: confirm.action,
                            id: e.id,
                            confirmation: f.get("confirmation"),
                            expectedRate: rate,
                          });
                        }}
                      >
                        <h4>
                          {confirm.action === "reset"
                            ? ui("Umgebung neu aufsetzen")
                            : ui("Umgebung entfernen")}
                        </h4>
                        <p>
                          {ui(
                            "Alle Arbeitsdateien dieser Umgebung werden gelöscht. Gib zur Bestätigung ",
                          )}
                          <strong>{e.name}</strong>
                          {ui(" ein.")}
                        </p>
                        <label className="field">
                          <span>{ui("Vollständiger Umgebungsname")}</span>
                          <input
                            name="confirmation"
                            required
                            autoFocus
                            autoComplete="off"
                          />
                        </label>
                        <div className="button-row">
                          <button className="primary" disabled={busy}>
                            {ui("Löschen bestätigen")}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setConfirm(null)}
                          >
                            {ui("Abbrechen")}
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                );
              })}
            {!data.environments.some((e) => e.status !== "deleted") && (
              <div className="environment-empty">
                <div className="environment-empty-icons">
                  <Globe2 size={30} />
                  <Code2 size={30} />
                </div>
                <h3>
                  {tr(
                    "Dein erster Arbeitsplatz wartet",
                    "Set up your first environment",
                  )}
                </h3>
                <p>
                  {tr(
                    "Buche einen Browser für Recherche oder einen Editor zum Programmieren. Wähle dabei KeRnCloud-Hosting oder deinen eigenen Rechner.",
                    "Book a browser for research or a code editor for development. Choose KeRnCloud hosting or your own host.",
                  )}
                </p>
                <button className="primary" onClick={() => setSection("book")}>
                  <Plus size={16} />
                  {tr("Umgebung auswählen", "Choose an environment")}
                </button>
              </div>
            )}
            <p className="form-note">
              {ui(
                "Die erste Minute wird beim Start reserviert und erst nach bestätigtem Start verbraucht. Weitere angefangene Minuten werden vorausbezahlt. Ab einer Stoppanforderung werden keine neuen Minuten berechnet; der Zugang wird sofort gesperrt. Bereits angefangene Minuten werden nicht anteilig erstattet. Bei leerem Guthaben oder entfallenem Plan-Zugang fordert das System automatisch einen Stopp an.",
              )}
            </p>
          </section>
        </>
      )}
      {section === "billing" && (
        <>
          <section className="panel settings-panel">
            <h2>{tr("So wird abgerechnet", "How billing works")}</h2>
            <div className="environment-cost-guide">
              <article>
                <h3>{tr("KeRnCloud-Hosting", "KeRnCloud hosting")}</h3>
                <p>
                  {tr(
                    "Verbraucht Laufzeit-Minuten, solange die Umgebung läuft. Jede Vorlage zeigt den Faktor je Betriebsminute. Plan-Minuten werden vor Zusatzguthaben verwendet.",
                    "Consumes runtime minutes while the environment runs. Each template shows its rate per running minute. Plan minutes are used before extra credit.",
                  )}
                </p>
                <strong>
                  {minutes(data.balance.included)}{" "}
                  {tr("Plan-Minuten übrig", "plan minutes left")}
                </strong>
                <p>
                  {data.balance.period_end
                    ? tr("Gültig bis: ", "Valid until: ") +
                      new Date(data.balance.period_end).toLocaleString(
                        localeTag,
                      )
                    : tr(
                        "Noch kein Laufzeit-Kontingent verfügbar. Aktive und Geschenk-Abos werden automatisch erneuert; bei Stripe ist eine bestätigte Zahlung nötig.",
                        "No runtime allowance available yet. Active and gifted subscriptions renew automatically; Stripe requires a confirmed payment.",
                      )}
                </p>
              </article>
              <article>
                <h3>{tr("Eigener Rechner", "Your own host")}</h3>
                <p>
                  {tr(
                    "Keine KeRnCloud-Hosting-Minuten. Plan-Limits für Plätze und gleichzeitige Umgebungen gelten trotzdem. Dein Rechner muss eingeschaltet und verbunden sein.",
                    "No KeRnCloud hosted minutes. Plan limits for slots and concurrency still apply. Your host must be powered on and connected.",
                  )}
                </p>
              </article>
              <article>
                <h3>{tr("Gestoppt oder entfernt?", "Stopped or removed?")}</h3>
                <p>
                  {tr(
                    "Stoppen beendet neue Laufzeit-Abbuchungen; Dateien und belegter Platz bleiben. Entfernen gibt den Platz frei und löscht die Umgebung. KI-Nutzung wird separat berechnet.",
                    "Stopping ends new runtime charges; files and the occupied slot remain. Removing frees the slot and deletes the environment. AI usage is billed separately.",
                  )}
                </p>
                <a href="/activity">
                  {tr("KI-Verbrauch ansehen", "View AI usage")} →
                </a>
              </article>
            </div>
          </section>
          <section className="panel settings-panel">
            <h2>{ui("Laufzeit-Minuten nachkaufen")}</h2>
            <p>
              {ui(
                "Plan-Minuten werden zuerst genutzt. Gekaufte Minuten bleiben bei einem neuen Plan-Zeitraum erhalten. Ein Plan mit Umgebungszugang ist zum Starten weiterhin nötig.",
              )}
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
              />
              {ui("Ich akzeptiere die")}{" "}
              <a href="/legal/agb" target="_blank" rel="noreferrer">
                {ui("Vertragsbedingungen")}
              </a>{" "}
              {ui("für den Kauf.")}
            </label>
            <div className="environment-catalog">
              {data.products.map((p) => (
                <article key={p.id}>
                  <h3>{p.name}</h3>
                  <p>
                    <strong>
                      {p.minutes} {tr("Hosting-Minuten", "hosted minutes")}
                    </strong>
                  </p>
                  <p>
                    {(p.price_cents / 100).toLocaleString(localeTag, {
                      style: "currency",
                      currency: "EUR",
                    })}
                  </p>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !terms ||
                      !data.eligible ||
                      !p.configured ||
                      !data.payments_enabled
                    }
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const r = await api<{ url: string }>(
                          "runtime/checkout",
                          {
                            productId: p.id,
                            termsAccepted: true,
                          },
                        );
                        window.location.assign(r.url);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {ui("Über Stripe kaufen")}
                  </button>
                </article>
              ))}
            </div>
            {!data.products.length && (
              <p>{ui("Noch keine Laufzeitpakete zum Kauf freigegeben.")}</p>
            )}
            <p className="form-note">
              {ui(
                "Gutschriften erfolgen nach bestätigter Zahlung. Rechnungen findest du im Kontomenü unter Rechnungen.",
              )}
            </p>
          </section>
          <section className="panel settings-panel">
            <h2>{ui("Laufzeitkonto")}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{ui("Zeitpunkt")}</th>
                    <th>{ui("Buchung")}</th>
                    <th>{ui("Minuten")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((x) => (
                    <tr key={x.id}>
                      <td>
                        {new Date(x.created_at).toLocaleString(localeTag)}
                      </td>
                      <td>
                        {ui(x.reason)}
                        <small>{x.kind}</small>
                      </td>
                      <td>
                        {x.amount > 0 ? "+" : ""}
                        {minutes(x.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
