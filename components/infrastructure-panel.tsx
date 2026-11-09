"use client";
import { useLanguage } from "./language";
import { useCallback, useEffect, useState } from "react";
import { AdminRuntimeBilling } from "./admin-runtime";
import { api } from "./api-client";
type Container = {
  id: string;
  name: string;
  image: string;
  state: string;
  health: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  environmentId: string | null;
};
type Host = {
  customer_account_id: string | null;
  customer_email: string | null;
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  provisioning: boolean;
  self_service: boolean;
  max_running: number;
  cpu_limit: number;
  memory_limit_mb: number;
  last_seen: string | null;
  inventory: {
    version?: string;
    hostname?: string;
    cpuCount?: number;
    memoryTotal?: number;
    memoryFree?: number;
    commandsEnabled?: boolean;
    accessConfigured?: boolean;
    containers?: Container[];
  };
};
type Environment = {
  id: string;
  name: string;
  workspace_name: string;
  email: string;
  host_id: string;
  template_id: string;
  status: string;
  endpoint: string | null;
  last_error: string | null;
  created_at: string;
};
type Template = {
  id: string;
  name: string;
  image: string;
  command: string[];
  cpu: number;
  memory_mb: number;
  container_port: number;
  network: boolean;
  enabled: boolean;
  user_id: string;
  read_only: true;
  access_mode: string;
  runtime_rate: number;
};
type Infrastructure = {
  hosts: Host[];
  workers: {
    id: string;
    name: string;
    last_seen: string;
    concurrency: number;
    active_tasks: number;
  }[];
  environments: Environment[];
  templates: Template[];
  workspaces: { id: string; name: string; email: string }[];
  jobs: {
    id: string;
    environment_id: string;
    action: string;
    status: string;
    error: string | null;
    created_at: string;
  }[];
};
export function AdminInfrastructure() {
  const { ui, localeTag, date, bytes: mib, t } = useLanguage();

  const [data, setData] = useState<Infrastructure | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState<{ id: string; token: string } | null>(null),
    [notice, setNotice] = useState("");
  const load = useCallback(
    () => api<Infrastructure>("admin/infrastructure").then(setData),
    [],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const t = setInterval(() => {
      if (document.visibilityState === "visible")
        void load().catch((e) => setError(e.message));
    }, 15000);
    return () => clearInterval(t);
  }, [load]);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("admin/infrastructure", body);
      if (result.token) setSecret(result as { id: string; token: string });
      await load();
      setNotice(
        ui(
          "Änderung gespeichert. Containeraktionen werden vom freigegebenen Server ausgeführt.",
        ),
      );
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>{error || ui("Infrastruktur wird geladen …")}</p>;
  const online = (host: Host) =>
    host.enabled &&
    host.last_seen &&
    Date.now() - Date.parse(host.last_seen) < 60000;
  const activeHosts = data.hosts.filter(
    (h) =>
      !h.customer_account_id &&
      online(h) &&
      h.provisioning &&
      h.inventory.commandsEnabled,
  );
  return (
    <>
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
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>{ui("Server & Container")}</h2>
            <p>
              {ui(
                "Live-Inventar der verbundenen Betreiber-Server. Abfrage alle 15 Sekunden; ohne frische Rückmeldung gilt ein Server nach 60 Sekunden als offline.",
              )}
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            {ui("Aktualisieren")}
          </button>
        </div>
        <div className="stats-grid">
          {[
            [ui("Verbunden"), data.hosts.filter(online).length],
            [
              ui("Container gemeldet"),
              data.hosts.reduce(
                (n, h) => n + (h.inventory.containers?.length ?? 0),
                0,
              ),
            ],
            [
              ui("Kundenumgebungen"),
              data.environments.filter((e) => e.status !== "deleted").length,
            ],
            [
              ui("Aktive Worker"),
              data.workers.filter(
                (w) => Date.now() - Date.parse(w.last_seen) < 60000,
              ).length,
            ],
          ].map(([label, value]) => (
            <article className="stat-card" key={label}>
              <div>{label}</div>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        {!data.hosts.length && (
          <p className="form-note">
            {ui(
              "Noch kein Infrastruktur-Connector verbunden. Worker melden bereits ihren Arbeitsstatus; für echte Docker-Zustände muss ein Betreiber-Connector auf dem Docker-Host laufen.",
            )}
          </p>
        )}
        {data.hosts.map((host) => (
          <article key={host.id} className="host-card">
            <div className="panel-heading">
              <div>
                <h3>
                  {host.name}{" "}
                  <span
                    className={`infra-state ${online(host) ? "online" : ""}`}
                  >
                    {!host.enabled
                      ? ui("Gesperrt")
                      : online(host)
                        ? ui("Verbunden")
                        : "Offline"}
                  </span>
                </h3>
                <p>
                  {host.customer_account_id && (
                    <strong>
                      {t("Privater Kunden-Rechner", "Private customer host")} ·{" "}
                      {host.customer_email} ·{" "}
                    </strong>
                  )}
                  {host.kind === "aws_ecs"
                    ? "AWS ECS/Fargate"
                    : ui("Docker-Server")}{" "}
                  · {host.inventory.version ?? ui("Version unbekannt")} ·{" "}
                  {host.inventory.hostname ?? "–"}
                </p>
              </div>
              <small>
                {ui("Letzte Meldung: ")}
                {date(host.last_seen)}
              </small>
            </div>
            <p className="muted">
              {ui("Connector-System: ")}
              {host.inventory.cpuCount ?? "–"} CPUs ·{" "}
              {mib(host.inventory.memoryFree)} /{" "}
              {mib(host.inventory.memoryTotal)}
              {ui(
                " RAM frei. Cloud-Task-Ressourcen werden separat in ECS überwacht.",
              )}
            </p>
            <form
              className="host-capacity"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save({
                  action: "host",
                  id: host.id,
                  enabled: host.enabled,
                  provisioning: host.provisioning,
                  self_service: f.get("self_service") === "on",
                  max_running: Number(f.get("max_running")),
                  cpu_limit: Number(f.get("cpu_limit")),
                  memory_limit_mb: Number(f.get("memory_limit_mb")),
                });
              }}
            >
              <label className="check-row">
                <input
                  name="self_service"
                  type="checkbox"
                  defaultChecked={host.self_service}
                  disabled={Boolean(host.customer_account_id)}
                />
                {ui("Kunden dürfen auf diesem Server selbst buchen")}
              </label>
              <div className="form-grid">
                {[
                  [
                    "max_running",
                    ui("Max. laufende Umgebungen"),
                    host.max_running,
                    1,
                    500,
                  ],
                  [
                    "cpu_limit",
                    ui("CPU-Budget für Kundencontainer"),
                    host.cpu_limit,
                    1,
                    1024,
                  ],
                  [
                    "memory_limit_mb",
                    ui("RAM-Budget für Kundencontainer (MiB)"),
                    host.memory_limit_mb,
                    256,
                    1048576,
                  ],
                ].map(([name, label, value, min, max]) => (
                  <label className="field" key={String(name)}>
                    <span>{label}</span>
                    <input
                      type="number"
                      name={String(name)}
                      defaultValue={value}
                      min={Number(min)}
                      max={Number(max)}
                      required
                    />
                  </label>
                ))}
              </div>
              <p className="form-note">
                {ui(
                  "Zusätzlich Platz für App, Datenbank und Zugangs-Relays freihalten. Die Limits reservieren Kapazität für gleichzeitig laufende Kundenumgebungen.",
                )}
              </p>
              <button className="secondary" disabled={busy}>
                {ui("Kapazität speichern")}
              </button>
            </form>
            <p className="form-note">
              {ui("Geschützter Zugang eingerichtet:")}{" "}
              {host.inventory.accessConfigured
                ? ui("Ja")
                : ui("Nein – INFRA_RELAY_URL und Relay-Image prüfen")}
            </p>
            <div className="button-row">
              <button
                className="secondary compact"
                disabled={busy}
                onClick={() =>
                  void save({
                    action: "host",
                    id: host.id,
                    enabled: !host.enabled,
                    provisioning: host.provisioning,
                  })
                }
              >
                {host.enabled
                  ? ui("Server-Zugang sperren")
                  : ui("Server-Zugang aktivieren")}
              </button>
              <button
                className="secondary compact"
                disabled={busy || !host.enabled}
                onClick={() =>
                  void save({
                    action: "host",
                    id: host.id,
                    enabled: host.enabled,
                    provisioning: !host.provisioning,
                  })
                }
              >
                {host.provisioning
                  ? ui("Neue Containeraktionen sperren")
                  : ui("Containeraktionen freigeben")}
              </button>
              <span className="muted">
                {ui("Connector erlaubt Aktionen:")}{" "}
                {host.inventory.commandsEnabled
                  ? ui("Ja")
                  : ui("Nein – INFRA_ALLOW_COMMANDS=true auf dem Server nötig")}
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{ui("Container / Task")}</th>
                    <th>{ui("Zustand")}</th>
                    <th>Healthcheck</th>
                    <th>CPU</th>
                    <th>RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {host.inventory.containers?.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <small>{c.image}</small>
                      </td>
                      <td>{c.state}</td>
                      <td>{c.health}</td>
                      <td>
                        {c.cpuPercent == null ? "–" : `${c.cpuPercent} %`}
                      </td>
                      <td>{mib(c.memoryBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!host.inventory.containers?.length && (
              <p className="muted">
                {ui(
                  "Keine Container gemeldet. Bei AWS fehlen ohne CloudWatch-Anbindung direkte CPU-/RAM-Messwerte der Tasks.",
                )}
              </p>
            )}
          </article>
        ))}
      </section>
      <section className="panel settings-panel">
        <h2>{ui("Server hinzufügen")}</h2>
        <p>
          {ui(
            "Registriere einen eigenen Docker-Host oder einen AWS-ECS-Connector. Jeder Server erhält einen separaten, widerrufbaren Zugang. Der Connector baut selbst die Verbindung zur Plattform auf; ein öffentlicher Docker-Port ist nicht nötig.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              action: "createHost",
              name: f.get("name"),
              kind: f.get("kind"),
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{ui("Servername")}</span>
              <input
                name="name"
                required
                maxLength={100}
                placeholder={ui("z. B. Docker EU 01")}
              />
            </label>
            <label className="field">
              <span>{ui("Betriebsart")}</span>
              <select name="kind">
                <option value="docker">
                  {ui("Eigener Docker-Server / EC2-Host")}
                </option>
                <option value="aws_ecs">AWS ECS/Fargate</option>
              </select>
            </label>
          </div>
          <button className="primary" disabled={busy}>
            {ui("Server registrieren")}
          </button>
        </form>
        {secret && (
          <div className="host-enrollment">
            <h3>{ui("Server-Zugang jetzt sicher übernehmen")}</h3>
            <p>
              {ui(
                "Dieser Token wird nur jetzt angezeigt. Er gehört ausschließlich auf den Betreiber-Connector.",
              )}
            </p>
            <label className="field">
              <span>INFRA_HOST_ID</span>
              <input value={secret.id} readOnly />
            </label>
            <label className="field">
              <span>INFRA_HOST_TOKEN</span>
              <input
                type="password"
                value={secret.token}
                readOnly
                autoComplete="off"
              />
            </label>
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `INFRA_HOST_ID=${secret.id}\nINFRA_HOST_TOKEN=${secret.token}\n`,
                )
              }
            >
              {ui("Server-Zugang kopieren")}
            </button>
            <button className="text-button" onClick={() => setSecret(null)}>
              {ui("Zugang gesichert")}
            </button>
          </div>
        )}
        <details>
          <summary>{ui("Installationsanleitung für eigene Server")}</summary>
          <p>
            {ui(
              "Auf dem Server das KeRnCloud-Image bereitstellen und eine nur für den Betreiber lesbare Datei ",
            )}
            <code>.env.infrastructure</code>
            {ui("anlegen:")}
          </p>
          <pre>{`PLATFORM_URL=https://deine-plattform.example\nINFRA_HOST_ID=<Server-ID>\nINFRA_HOST_TOKEN=<Server-Token>\nINFRA_ALLOW_COMMANDS=false\nDOCKER_PROJECT=kerncloud-local`}</pre>
          <p>
            {ui("Mit ")}
            <code>compose.infrastructure.yaml</code>
            {ui(" starten. Im lokalen Projekt: ")}
            <code>npm run setup:infrastructure</code>
            {ui(", dann")}{" "}
            <code>
              docker compose --profile infrastructure up -d infrastructure
            </code>
            {ui(". Neue Worker mit ")}
            <code>compose.worker.yaml</code>
            {ui(" starten; sie sind keine Kundencontainer.")}
          </p>
          <p>
            {ui(
              "Für Provisionierung sowohl den Server hier freigeben als auch",
            )}{" "}
            <code>INFRA_ALLOW_COMMANDS=true</code>
            {ui(
              " auf dem Connector setzen. Der Docker-Socket liegt ausschließlich am vertrauenswürdigen Betreiber-Connector.",
            )}
          </p>
        </details>
        <details>
          <summary>{ui("AWS ECS/Fargate vorbereiten")}</summary>
          <p>
            {ui("Connector mit ")}
            <code>INFRA_MODE=aws_ecs</code>
            {ui(
              ", AWS-Region, Cluster, privaten Subnetzen, Security Groups und einer Zuordnung von Vorlagen zu Taskdefinitionen starten. AWS-Zugang über eine IAM-Rolle am Connector bereitstellen; keine AWS-Schlüssel in der Web-App speichern.",
            )}
          </p>
          <p>
            {ui(
              "RunTask/StopTask sind implementiert. Cluster, IAM, Netzwerk, freigegebene Taskdefinitionen, Image-Registry und ggf. getrennte EFS-Access-Points müssen zuvor eingerichtet werden. Es werden hier keine AWS-Basisressourcen automatisch angelegt. Fargate-Taskdaten sind ohne EFS flüchtig. Cloud-Kosten laufen beim tatsächlichen Start an.",
            )}
          </p>
        </details>
      </section>
      <section className="panel settings-panel">
        <h2>{ui("Kundenumgebung bereitstellen")}</h2>
        <p>
          {ui(
            "Ordne einem Workspace eine freigegebene Vorlage auf einem freigegebenen Server zu. Dies ist eine Betreiberbereitstellung; automatische Buchung und Abrechnung von Containerlaufzeit sind noch nicht aktiviert.",
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              action: "deploy",
              name: f.get("name"),
              workspaceId: f.get("workspaceId"),
              hostId: f.get("hostId"),
              templateId: f.get("templateId"),
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{ui("Umgebungsname")}</span>
              <input name="name" required maxLength={100} />
            </label>
            <label className="field">
              <span>Workspace</span>
              <select name="workspaceId" required>
                {data.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.email} · {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Server</span>
              <select name="hostId" required>
                {activeHosts.length ? (
                  activeHosts.map((h) => (
                    <option value={h.id} key={h.id}>
                      {h.name}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {ui("Kein freigegebener Server verbunden")}
                  </option>
                )}
              </select>
            </label>
            <label className="field">
              <span>{ui("Vorlage")}</span>
              <select name="templateId" required>
                {data.templates
                  .filter((t) => t.enabled)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.cpu} CPU / {t.memory_mb} MiB
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            className="primary"
            disabled={
              busy ||
              !activeHosts.length ||
              !data.templates.some((t) => t.enabled)
            }
          >
            {ui("Bereitstellung beauftragen")}
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{ui("Umgebung")}</th>
                <th>{ui("Kunde / Workspace")}</th>
                <th>Status</th>
                <th>{ui("Aktionen")}</th>
              </tr>
            </thead>
            <tbody>
              {data.environments.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    <small>{e.template_id}</small>
                  </td>
                  <td>
                    {e.email}
                    <small>{e.workspace_name}</small>
                  </td>
                  <td>
                    {e.status}
                    {e.last_error && (
                      <small className="inline-error">{e.last_error}</small>
                    )}
                    {e.endpoint && e.status === "running" && (
                      <small>
                        {ui("Host-lokal: ")}
                        {e.endpoint}
                      </small>
                    )}
                  </td>
                  <td>
                    <div className="button-row">
                      {e.status === "uncertain" ? (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() =>
                            void save({
                              action: "environment",
                              id: e.id,
                              operation: "reconcile",
                            })
                          }
                        >
                          {ui("Vorgang abgleichen")}
                        </button>
                      ) : (
                        e.status !== "deleted" &&
                        ["start", "stop", "reset", "delete"].map(
                          (operation) => (
                            <button
                              key={operation}
                              disabled={busy || e.status === "pending"}
                              className="secondary compact"
                              onClick={() => {
                                let confirmation = "";
                                if (
                                  operation === "reset" ||
                                  operation === "delete"
                                ) {
                                  const value = window.prompt(
                                    data.hosts.find(
                                      (host) => host.id === e.host_id,
                                    )?.kind === "aws_ecs"
                                      ? ui(
                                          "AWS-Task von „{0}“ wird gestoppt bzw. neu erstellt. EFS-Daten bleiben erhalten und sind separat zu verwalten. Zur Bestätigung den vollständigen Umgebungsnamen eingeben:",
                                          [e.name],
                                        )
                                      : ui(
                                          "Arbeitsdaten von „{0}“ werden entfernt. Zur Bestätigung den vollständigen Umgebungsnamen eingeben:",
                                          [e.name],
                                        ),
                                  );
                                  if (value === null) return;
                                  confirmation = value;
                                }
                                void save({
                                  action: "environment",
                                  id: e.id,
                                  operation,
                                  confirmation,
                                });
                              }}
                            >
                              {
                                {
                                  start: ui("Starten"),
                                  stop: ui("Stoppen"),
                                  reset: ui("Neu aufsetzen"),
                                  delete: ui("Entfernen"),
                                }[operation]
                              }
                            </button>
                          ),
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="form-note">
          {ui(
            "Docker-Arbeitsdaten in /home/runner liegen in einem eigenen Volume und bleiben beim Stoppen erhalten. Neuaufsetzen oder Entfernen löscht dieses Volume. Netzwerkzugriff ist pro Vorlage freizugeben. Host-lokale Ports sind kein öffentlicher Kunden-Zugang; dafür ist ein gesonderter authentifizierter Proxy erforderlich.",
          )}
        </p>
      </section>
      <AdminRuntimeBilling />
      <section className="panel settings-panel">
        <h2>{ui("Container-Vorlagen")}</h2>
        <p>
          {ui(
            "Nur der Betreiber gibt Images, Ressourcen und Netzwerkzugriff vor. Browser und Entwicklungsumgebung sind vorbereitet: zuerst mit docker compose -f compose.environments.yaml build die Images bauen, danach die jeweilige Vorlage freigeben. Weitere Images kannst du hier ergänzen. Images müssen den normalen Benutzer und /home/runner als Arbeitsverzeichnis unterstützen; eine laufende Weboberfläche hängt vom Image ab.",
          )}
        </p>
        {[
          ...data.templates,
          {
            id: "",
            name: "",
            image: "",
            command: [],
            cpu: 1,
            memory_mb: 512,
            container_port: 0,
            network: false,
            enabled: false,
            access_mode: "none",
            runtime_rate: 1,
            user_id: "1000:1000",
            read_only: true,
          },
        ].map((t, index) => (
          <details key={t.id || "new"}>
            <summary>
              {t.name || ui("Neue Vorlage")}
              {t.id
                ? ` · ${t.enabled ? ui("freigegeben") : ui("gesperrt")}`
                : ""}
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save({
                  action: "template",
                  id: f.get("id"),
                  name: f.get("name"),
                  image: f.get("image"),
                  command: String(f.get("command") ?? "")
                    .split("\n")
                    .filter(Boolean),
                  access_mode: f.get("access_mode") || "none",
                  runtime_rate: Number(f.get("rate")),
                  cpu: Number(f.get("cpu")),
                  memory_mb: Number(f.get("memory")),
                  container_port: Number(f.get("port")),
                  network: f.get("network") === "on",
                  enabled: f.get("enabled") === "on",
                  user_id: f.get("user"),
                  read_only: true,
                });
              }}
            >
              <label className="field">
                <span>{ui("Zugangsverfahren des Images")}</span>
                <select
                  name="access_mode"
                  defaultValue={t.access_mode ?? "none"}
                >
                  <option value="none">{ui("Kein Webzugang")}</option>
                  <option value="code-server">
                    {ui("Code Server · Passwort")}
                  </option>
                  <option value="basic">
                    {ui("Browser · Benutzer/Passwort")}
                  </option>
                </select>
              </label>
              <div className="form-grid">
                {[
                  ["id", ui("Vorlagen-ID"), t.id],
                  ["name", "Name", t.name],
                  ["image", ui("Docker-Image / Tag oder Digest"), t.image],
                  ["user", "Linux UID:GID", t.user_id],
                ].map(([name, label, value]) => (
                  <label className="field" key={name}>
                    <span>{label}</span>
                    <input
                      name={name}
                      defaultValue={value}
                      readOnly={name === "id" && Boolean(t.id)}
                      required
                    />
                  </label>
                ))}
                {[
                  [
                    "rate",
                    ui("Laufzeit-Minuten pro Betriebsminute"),
                    t.runtime_rate ?? 1,
                    1,
                    100,
                  ],
                  ["cpu", "CPUs", t.cpu, 1, 16],
                  ["memory", "RAM (MiB)", t.memory_mb, 64, 32768],
                  [
                    "port",
                    ui("Web-Port im Container (0 = keiner)"),
                    t.container_port,
                    0,
                    65535,
                  ],
                ].map(([name, label, value, min, max]) => (
                  <label className="field" key={String(name)}>
                    <span>{label}</span>
                    <input
                      name={String(name)}
                      type="number"
                      defaultValue={value}
                      min={min}
                      max={max}
                      required
                    />
                  </label>
                ))}
              </div>
              <label className="field">
                <span>{ui("Startbefehl – ein Argument pro Zeile")}</span>
                <textarea
                  name="command"
                  defaultValue={t.command.join("\n")}
                  rows={3}
                />
              </label>
              <label className="check-row">
                <input
                  name="network"
                  type="checkbox"
                  defaultChecked={t.network}
                />
                {ui("Ausgehenden Netzwerkzugriff erlauben")}
              </label>
              <label className="check-row">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={t.enabled}
                />
                {ui("Vorlage freigeben")}
              </label>
              <button className="secondary" disabled={busy}>
                {ui("Vorlage speichern")}
              </button>
            </form>
          </details>
        ))}
      </section>
      <section className="panel settings-panel">
        <h2>{ui("Worker & Vorgangsprotokoll")}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Worker</th>
                <th>{ui("Letzte Meldung")}</th>
                <th>{ui("Belegt / Plätze")}</th>
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{date(w.last_seen)}</td>
                  <td>
                    {w.active_tasks} / {w.concurrency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{ui("Zeit")}</th>
                <th>{ui("Aktion")}</th>
                <th>Status</th>
                <th>{ui("Hinweis")}</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{date(j.created_at)}</td>
                  <td>{j.action}</td>
                  <td>{j.status}</td>
                  <td>{j.error ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export { CustomerEnvironments } from "./customer-environments";
