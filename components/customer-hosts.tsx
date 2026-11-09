"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
type Host = {
  id: string;
  name: string;
  enabled: boolean;
  last_seen: string | null;
  environments: number;
  cpu_limit: number;
  memory_limit_mb: number;
  inventory: {
    version?: string;
    containers?: { id: string; name: string; state: string; health: string }[];
  };
};
type Data = {
  hosts: Host[];
  policy: { allowHosted: boolean; hostIds: string[] };
  eligible: boolean;
  limits: { hosts: number; environments: number; running: number };
};
export function CustomerHosts({
  onChange,
}: {
  onChange: () => Promise<unknown>;
}) {
  const { t, date } = useLanguage();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = async () => setData(await api<Data>("customer-hosts"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => void load().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, []);
  function download(encoded: string) {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/zip" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "kerncloud-kunden-connector.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function manage(body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ archive?: string }>("customer-hosts", body);
      if (r.archive) {
        download(r.archive);
        setNotice(
          t(
            "Einrichtungspaket erstellt. Es enthält den privaten Connector-Schlüssel; sicher aufbewahren.",
            "Setup package created. It contains the private connector key; keep it safe.",
          ),
        );
      }
      await load();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <p role="status">
        {error ||
          t("Kunden-Rechner werden geladen …", "Loading customer hosts …")}
      </p>
    );
  return (
    <section className="panel settings-panel customer-hosts-panel">
      <h2>
        {t(
          "Eigene Rechner & Ausführungsorte",
          "Your hosts & execution locations",
        )}
      </h2>
      <p>
        {t(
          "Neue Browser- und Entwicklungsumgebungen auf deinem eigenen Docker-Rechner bereitstellen. Verbinde mehrere Rechner und bestimme pro Workspace, welche Agenten verwenden dürfen.",
          "Create new browser and development environments on your own Docker hosts. Connect multiple hosts and choose which locations agents may use in each workspace.",
        )}
      </p>
      <p className="form-note">
        {t(
          "Lokale Dateien und Rechenleistung liegen bei dir. Steuerdaten, gelesene Inhalte, Werkzeugausgaben und veröffentlichte Ergebnisse können weiterhin an KeRnCloud und dein KI-Modell gehen. Lokal ist kein vollständig cloudfreier KI-Betrieb.",
          "Files and compute stay on your host. Control data, read content, tool outputs and published results may still reach KeRnCloud and your AI model. Local execution does not mean fully offline AI.",
        )}
      </p>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}
      <p>
        {data.hosts.length} / {data.limits.hosts}{" "}
        {t("Kunden-Rechner ·", "customer hosts ·")} {data.limits.environments}{" "}
        {t("lokale Umgebungsplätze ·", "local environment slots ·")}{" "}
        {data.limits.running} {t("gleichzeitig", "running at once")}
      </p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void manage({
            action: "create",
            name: f.get("name"),
            cpu: Number(f.get("cpu")),
            memory: Number(f.get("memory")),
          });
        }}
      >
        <label className="field">
          <span>{t("Rechnername", "Host name")}</span>
          <input
            name="name"
            placeholder={t("Mein PC / Firmenserver", "My PC / company server")}
            maxLength={100}
            required
          />
        </label>
        <label className="field">
          <span>{t("Freigegebene CPU-Kerne", "Available CPU cores")}</span>
          <input
            name="cpu"
            type="number"
            min={2}
            max={128}
            defaultValue={4}
            required
          />
        </label>
        <label className="field">
          <span>{t("Freigegebener RAM (MiB)", "Available RAM (MiB)")}</span>
          <input
            name="memory"
            type="number"
            min={3072}
            max={262144}
            defaultValue={8192}
            required
          />
        </label>
        <div className="button-row">
          <button
            className="primary"
            disabled={
              busy || !data.eligible || data.hosts.length >= data.limits.hosts
            }
          >
            {t(
              "Rechner hinzufügen & Einrichtung laden",
              "Add host & download setup",
            )}
          </button>
        </div>
      </form>
      <details className="agent-tool-activity">
        <summary>
          {t("Einrichtung auf dem eigenen Rechner", "Set up your own host")}
        </summary>
        <ol>
          <li>
            {t(
              "Docker Desktop mit Linux-Containern oder Linux Docker Engine starten.",
              "Start Docker Desktop with Linux containers or Linux Docker Engine.",
            )}
          </li>
          <li>
            {t(
              "ZIP entpacken, im Paketordner ausführen:",
              "Extract the ZIP, then run inside its folder:",
            )}
            <pre>
              docker compose --profile images build
              <br />
              docker compose up -d connector
            </pre>
          </li>
          <li>
            {t(
              "Rechner unten freigeben und danach eine Umgebung gezielt dort anlegen. Agentenrechte separat aktivieren.",
              "Allow the host below, then create an environment there. Enable agent permissions separately.",
            )}
          </li>
        </ol>
        <p>
          {t(
            "Der vertrauenswürdige Connector benötigt lokal den Docker-Socket. Er erstellt ausschließlich eigene KeRnCloud-Umgebungen; Agenten erhalten keinen Docker-Socket. Keine Routerports oder öffentliche Docker-API öffnen.",
            "The trusted connector needs the local Docker socket. It creates dedicated KeRnCloud environments; agents do not receive the socket. Do not expose router ports or a public Docker API.",
          )}
        </p>
      </details>
      <div className="host-grid">
        {data.hosts.map((h) => (
          <article className="host-card" key={h.id}>
            <h3>{h.name}</h3>
            <p>
              {!h.enabled
                ? t("Getrennt", "Disconnected")
                : h.last_seen && Date.now() - Date.parse(h.last_seen) < 60000
                  ? t("Verbunden", "Connected")
                  : t(
                      "Offline / Einrichtung ausstehend",
                      "Offline / setup pending",
                    )}{" "}
              · {h.environments} {t("Umgebungen", "environments")}
            </p>
            <small>
              {h.inventory?.version ?? "Docker"} · {h.cpu_limit} CPU ·{" "}
              {h.memory_limit_mb} MiB
              {h.last_seen ? ` · ${date(h.last_seen)}` : ""}
            </small>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy || !data.eligible}
                onClick={() => void manage({ action: "rotate", id: h.id })}
              >
                {t(
                  "Einrichtung neu laden · Schlüssel ersetzen",
                  "Download new setup · replace key",
                )}
              </button>
              <button
                className="secondary"
                disabled={busy || !h.enabled}
                onClick={() => void manage({ action: "revoke", id: h.id })}
              >
                {t("Verbindung trennen", "Disconnect")}
              </button>
            </div>
            {h.inventory?.containers?.length ? (
              <details>
                <summary>{t("Containerzustand", "Container health")}</summary>
                {h.inventory.containers.map((c) => (
                  <p key={c.id}>
                    {c.name} · {c.state} · {c.health}
                  </p>
                ))}
              </details>
            ) : null}
          </article>
        ))}
      </div>
      <h3>
        {t(
          "Erlaubte Ausführungsorte dieses Workspaces",
          "Allowed execution locations for this workspace",
        )}
      </h3>
      <form
        key={JSON.stringify(data.policy)}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await api("execution-policy", {
              allowHosted: f.get("hosted") === "on",
              hostIds: f.getAll("hosts"),
            });
            await load();
            await onChange();
            setNotice(
              t(
                "Ausführungsorte gespeichert. Kein automatischer Wechsel zu anderen Rechnern oder zur Cloud.",
                "Execution locations saved. No automatic fallback to other hosts or the cloud.",
              ),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="check-row">
          <input
            name="hosted"
            type="checkbox"
            defaultChecked={data.policy.allowHosted}
          />
          {t(
            "KeRnCloud Hosting erlauben (separate Planplätze und Laufzeit-Minuten)",
            "Allow KeRnCloud hosting (separate plan slots and runtime minutes)",
          )}
        </label>
        {data.hosts
          .filter((h) => h.enabled)
          .map((h) => (
            <label className="check-row" key={h.id}>
              <input
                name="hosts"
                type="checkbox"
                value={h.id}
                defaultChecked={data.policy.hostIds.includes(h.id)}
              />
              {h.name}
            </label>
          ))}
        <p className="form-note">
          {t(
            "Nur markierte Orte werden Agenten angeboten. Bei Ausfall wird gewartet, statt Daten auf einen anderen Rechner zu verschieben. Eine Umgebung bleibt an ihren ausgewählten Rechner gebunden. Änderungen widerrufen dort laufende Agentenaktionen, soweit noch stoppbar.",
            "Agents can only use selected locations. An outage does not move data to another host. Each environment stays on its selected host. Changes revoke agent actions at excluded locations where they can still be stopped.",
          )}
        </p>
        <button className="secondary" disabled={busy}>
          {t("Auswahl speichern", "Save selection")}
        </button>
      </form>
      <p className="form-note">
        {t(
          "Trennen sperrt den KeRnCloud-Zugang; auf einem offline befindlichen Rechner können Container weiterlaufen. Lokal prüfen und bei Bedarf stoppen. Deaktivierte Connectoren behalten ihren Planplatz und können neu eingerichtet werden.",
          "Disconnecting revokes KeRnCloud access; containers on an offline host may keep running. Check and stop them locally if needed. Disabled connectors retain their plan slot and can be set up again.",
        )}
      </p>
    </section>
  );
}
