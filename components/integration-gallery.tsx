"use client";
import { useEffect, useState } from "react";
import {
  Search,
  Plug,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Unplug,
  KeyRound,
} from "lucide-react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import type { Integration } from "../src/core/integration-catalog";

export function IntegrationGallery({
  workspaceId,
  isAdmin,
}: {
  workspaceId: string;
  isAdmin: boolean;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [tab, setTab] = useState("browse"),
    [selected, setSelected] = useState<Integration | null>(null);
  const load = async () => setData(await api("suite/apps"));
  useEffect(() => {
    setData(null);
    setSelected(null);
    setError("");
    void load().catch((e) => setError(e.message));
  }, [workspaceId]);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r: any = await api(path, body);
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const manage = ["owner", "admin"].includes(data?.role);
  const catalog: Integration[] = data?.catalog ?? [];
  const matches = catalog.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      [i.name, i.category, i.description]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="integration-hub">
      <header className="workspace-page-heading">
        <div>
          <span className="scope-label">
            {t(
              "DEINE DIENSTE. DEINE FREIGABEN.",
              "YOUR SERVICES. YOUR PERMISSIONS.",
            )}
          </span>
          <h1>{t("Integrationen", "Integrations")}</h1>
          <p>
            {t(
              "Verbinde deine Arbeitsdienste. Bestimme, welche Projekte und Agenten darauf zugreifen dürfen.",
              "Connect your work services. Choose exactly which projects and agents can access them.",
            )}
          </p>
        </div>
        <span className="integration-total">
          <Plug size={18} />
          {catalog.length} {t("Dienste", "services")}
        </span>
      </header>
      {error && (
        <div role="alert" className="error-box">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="info-box">
          {notice}
        </div>
      )}
      <div className="integration-safety">
        <ShieldCheck size={22} />
        <div>
          <strong>
            {t(
              "Gezielte Zugriffe statt voller Kontozugriff",
              "Purposeful access, explicit permissions",
            )}
          </strong>
          <p>
            {t(
              "Neue Verbindungen haben zunächst keine Agentenfreigabe. Schreibaktionen brauchen eine Einzelfreigabe. Verbindungstests nutzen keine KI, können aber Anbieter-Kontingente verbrauchen.",
              "New connections initially grant no agent access. Writes require individual approval. Connection tests use no AI, but may consume provider quotas.",
            )}
          </p>
        </div>
      </div>
      <nav
        className="integration-tabs"
        aria-label={t("Integrationen anzeigen", "Integration view")}
      >
        <button
          type="button"
          className={tab === "browse" ? "is-active" : ""}
          onClick={() => setTab("browse")}
        >
          {t("Dienste entdecken", "Browse services")}{" "}
          <span>{catalog.length}</span>
        </button>
        <button
          type="button"
          className={tab === "connected" ? "is-active" : ""}
          onClick={() => {
            setTab("connected");
            setSelected(null);
          }}
        >
          {t("Verbunden", "Connected")}{" "}
          <span>{data?.connections.length ?? 0}</span>
        </button>
      </nav>
      {tab === "browse" && (
        <>
          <div className="integration-filters">
            <label className="integration-search">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(
                  "Dienst oder Funktion suchen …",
                  "Search services or capabilities …",
                )}
                aria-label={t("Integrationen suchen", "Search integrations")}
              />
            </label>
            <label className="field">
              <span>{t("Kategorie", "Category")}</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">
                  {t("Alle Kategorien", "All categories")}
                </option>
                {[...new Set(catalog.map((i) => i.category))].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          {selected && (
            <section
              className="panel integration-setup"
              aria-labelledby="integration-setup-title"
            >
              <div className="integration-card-heading">
                <span className="integration-monogram">
                  {selected.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <span className="scope-label">
                    {t("VERBINDUNG EINRICHTEN", "SET UP CONNECTION")}
                  </span>
                  <h2 id="integration-setup-title">{selected.name}</h2>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelected(null)}
                >
                  {t("Schließen", "Close")}
                </button>
              </div>
              <p>{selected.description}</p>
              <p>
                <a href={selected.docs} target="_blank" rel="noreferrer">
                  {t(
                    "Offizielle Einrichtung und Berechtigungen",
                    "Official setup and permissions",
                  )}{" "}
                  <ExternalLink size={13} />
                </a>
              </p>
              <div className="integration-capabilities">
                {(selected.operations ?? []).map((o) => (
                  <span key={o}>{o.replaceAll("_", " ")}</span>
                ))}
                {selected.actions.map((a) => (
                  <span key={a.id}>
                    {a.label}
                    {a.write ? " · approval" : ""}
                  </span>
                ))}
              </div>
              {selected.id === "github" && (
                <p className="form-note">
                  {t(
                    "GitHub-OAuth repo umfasst technisch Schreibzugriff. KeRnCloud führt Schreibaktionen nur mit aktivierter Schreibfreigabe und Einzelfreigabe aus.",
                    "GitHub OAuth repo technically includes write access. KeRnCloud requires writes to be enabled and individually approved.",
                  )}
                </p>
              )}
              {manage ? (
                <form
                  key={selected.id}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form);
                    const common = {
                      service_id: selected.id,
                      name: f.get("name"),
                      project_ids: f.getAll("project"),
                    };
                    const r = await act(
                      selected.auth === "token"
                        ? "suite/apps/token"
                        : "suite/apps/connect",
                      selected.auth === "token"
                        ? { ...common, token: f.get("token") }
                        : {
                            ...common,
                            provider: selected.provider,
                            write: !!f.get("write"),
                          },
                    );
                    if (r?.url) window.location.assign(r.url);
                    else if (r?.id) {
                      form.reset();
                      setSelected(null);
                      setTab("connected");
                      setNotice(
                        t(
                          "Verbunden. Lege jetzt die Agentenrechte fest und teste die Verbindung.",
                          "Saved. Choose agent permissions and test the connection next.",
                        ),
                      );
                    }
                  }}
                >
                  <div className="form-grid">
                    <label className="field">
                      <span>{t("Verbindungsname", "Connection name")}</span>
                      <input
                        name="name"
                        required
                        maxLength={100}
                        defaultValue={selected.name}
                      />
                    </label>
                    {selected.auth === "token" && (
                      <label className="field">
                        <span>
                          {selected.id === "discord"
                            ? "Bot token"
                            : t(
                                "API-Token / persönlicher Zugriffstoken",
                                "API token / personal access token",
                              )}
                        </span>
                        <input
                          name="token"
                          type="password"
                          autoComplete="new-password"
                          required
                          minLength={8}
                          maxLength={4096}
                        />
                      </label>
                    )}
                  </div>
                  {selected.auth === "token" && (
                    <p className="form-note">
                      {t(
                        "Erstelle beim Anbieter einen eingeschränkten Token. Nur der Tokenwert, ohne Bearer/Bot-Präfix. Der Wert wird verschlüsselt gespeichert und nie an ein Modell gesendet.",
                        "Create a scoped token at the provider. Paste only its value, without a Bearer/Bot prefix. It is stored encrypted and never sent to a model.",
                      )}
                    </p>
                  )}
                  <fieldset className="integration-permissions">
                    <legend>
                      {t("Erlaubte Projekte", "Allowed projects")}
                    </legend>
                    {data?.projects.map((p: any) => (
                      <label key={p.id} className="check-row">
                        <input name="project" type="checkbox" value={p.id} />
                        {p.name}
                      </label>
                    ))}
                    <small>
                      {t(
                        "Keine Auswahl bedeutet keinen Agentenzugriff.",
                        "No selection means no agent access.",
                      )}
                    </small>
                  </fieldset>
                  {selected.auth === "oauth" &&
                    !!selected.scopes?.write.length && (
                      <label className="check-row">
                        <input type="checkbox" name="write" />
                        {t(
                          "Auch die aufgeführten Schreibrechte beim Anbieter anfragen",
                          "Also request the listed write scopes at the provider",
                        )}
                      </label>
                    )}
                  {selected.auth === "oauth" && (
                    <details className="integration-scopes">
                      <summary>
                        {t("Angefragte OAuth-Rechte", "Requested OAuth scopes")}
                      </summary>
                      <p>{selected.scopes?.read.join(" · ")}</p>
                      {!!selected.scopes?.write.length && (
                        <p>
                          {t(
                            "Optional zum Schreiben: ",
                            "Optional for writes: ",
                          )}
                          {selected.scopes?.write.join(" · ")}
                        </p>
                      )}
                    </details>
                  )}
                  {selected.auth === "oauth" &&
                    !data?.providers.find(
                      (p: any) => p.id === selected.provider,
                    )?.configured && (
                      <div className="form-note">
                        {t(
                          "Die OAuth-App dieses Anbieters muss zuerst von der lokalen Administration eingerichtet werden. Die Einrichtung findest du unten.",
                          "This provider's OAuth app must first be configured by the local administrator. Setup is available below.",
                        )}
                      </div>
                    )}
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        (selected.auth === "oauth" &&
                          !data?.providers.find(
                            (p: any) => p.id === selected.provider,
                          )?.configured)
                      }
                    >
                      <Plug size={16} />
                      {selected.auth === "oauth"
                        ? t("Beim Anbieter verbinden", "Connect at provider")
                        : t("Verbindung speichern", "Save connection")}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="form-note">
                  {t(
                    "Nur Workspace-Administratoren dürfen Verbindungen einrichten.",
                    "Only workspace administrators can set up connections.",
                  )}
                </p>
              )}
            </section>
          )}
          <div className="integration-grid">
            {matches.map((i) => (
              <article
                className={
                  "panel integration-card" +
                  (selected?.id === i.id ? " is-selected" : "")
                }
                key={i.id}
              >
                <div className="integration-card-heading">
                  <span className="integration-monogram" aria-hidden="true">
                    {i.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <span className="integration-category">{i.category}</span>
                    <h2>{i.name}</h2>
                  </div>
                </div>
                <p>{i.description}</p>
                <div className="integration-card-footer">
                  <span>
                    {i.auth === "oauth" ? "OAuth" : "API token"} ·{" "}
                    {(i.operations?.length ?? 0) + i.actions.length}{" "}
                    {t("Aktionen", "actions")}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setSelected(i)}
                  >
                    {t("Einrichten", "Set up")}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {data && !matches.length && (
            <p className="form-note">
              {t("Keine passenden Dienste.", "No matching services.")}
            </p>
          )}
        </>
      )}
      {tab === "connected" && (
        <div className="integration-connections">
          {data && !data.connections.length && (
            <div className="panel integration-empty">
              <Plug size={30} />
              <h2>
                {t("Dein erster Dienst wartet", "Connect your first service")}
              </h2>
              <p>
                {t(
                  "Wähle einen Dienst aus der Galerie und gib nur die benötigten Rechte frei.",
                  "Choose a service from the gallery and grant only the access you need.",
                )}
              </p>
              <button className="primary" onClick={() => setTab("browse")}>
                {t("Dienste entdecken", "Browse services")}
              </button>
            </div>
          )}
          {data?.connections.map((c: any) => {
            const service = catalog.find((i) => i.id === c.service_id);
            const canWrite =
              !service ||
              service.actions.some((a) => a.write) ||
              service.operations?.some((o) =>
                ["mail_send", "calendar_create", "github_publish"].includes(o),
              );
            return (
              <article
                className="panel integration-connection"
                key={c.id + ":" + c.revision}
              >
                <div className="integration-card-heading">
                  <span className="integration-monogram">
                    <Plug size={21} />
                  </span>
                  <div>
                    <span className="integration-category">
                      {service?.name ?? c.provider}
                    </span>
                    <h2>{c.name}</h2>
                  </div>
                  <span className={"integration-health is-" + c.health}>
                    {c.health === "ok" ? (
                      <CheckCircle2 size={15} />
                    ) : c.health === "error" ? (
                      <CircleAlert size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{" "}
                    {c.health === "ok"
                      ? t("Test erfolgreich", "Test passed")
                      : c.health === "error"
                        ? t("Prüfung fehlgeschlagen", "Check failed")
                        : t("Ungeprüft", "Unchecked")}
                  </span>
                </div>
                {c.health_message && (
                  <p className="form-note">{c.health_message}</p>
                )}
                {c.checked_at && (
                  <small>
                    {t("Letzter Test: ", "Last test: ")}
                    {new Date(c.checked_at).toLocaleString()}
                  </small>
                )}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const r = await act("suite/apps", {
                      action: "configure",
                      id: c.id,
                      agent_ids: f.getAll("agent"),
                      project_ids: f.get("all-projects")
                        ? null
                        : f.getAll("project"),
                      write_enabled: !!f.get("write"),
                    });
                    if (r)
                      setNotice(
                        t("Berechtigungen gespeichert.", "Permissions saved."),
                      );
                  }}
                >
                  <div className="integration-grant-grid">
                    <fieldset className="integration-permissions">
                      <legend>{t("Agenten", "Agents")}</legend>
                      {data.agents.map((a: any) => (
                        <label className="check-row" key={a.id}>
                          <input
                            name="agent"
                            value={a.id}
                            type="checkbox"
                            defaultChecked={c.agent_ids.includes(a.id)}
                            disabled={!manage}
                          />
                          {a.name}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset className="integration-permissions">
                      <legend>{t("Projekte", "Projects")}</legend>
                      <label className="check-row">
                        <input
                          name="all-projects"
                          type="checkbox"
                          defaultChecked={c.project_ids === null}
                          disabled={!manage}
                        />
                        {t(
                          "Alle Projekte dieses Workspace (auch neue)",
                          "All workspace projects (including new ones)",
                        )}
                      </label>
                      {data.projects.map((p: any) => (
                        <label className="check-row" key={p.id}>
                          <input
                            name="project"
                            value={p.id}
                            type="checkbox"
                            defaultChecked={
                              c.project_ids?.includes(p.id) ?? false
                            }
                            disabled={!manage}
                          />
                          {p.name}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  <label className="check-row">
                    <input
                      name="write"
                      type="checkbox"
                      defaultChecked={c.write_enabled}
                      disabled={!manage || !canWrite}
                    />
                    {t(
                      "Schreibaktionen mit zusätzlicher Einzelfreigabe erlauben",
                      "Allow writes with additional individual approval",
                    )}
                  </label>
                  <details className="integration-scopes">
                    <summary>
                      {t("Berechtigungen beim Anbieter", "Provider scopes")}
                    </summary>
                    <p>{c.scopes.join(" · ")}</p>
                  </details>
                  {manage && (
                    <div className="button-row">
                      <button className="primary" disabled={busy}>
                        {t("Rechte speichern", "Save permissions")}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={async () => {
                          const r = await act("suite/apps/check", { id: c.id });
                          if (r) setNotice(r.message);
                        }}
                      >
                        <RefreshCw size={15} />
                        {t("Verbindung testen", "Test connection")}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act("suite/apps", {
                            id: c.id,
                            action: "disconnect",
                          })
                        }
                      >
                        <Unplug size={15} />
                        {t("Trennen", "Disconnect")}
                      </button>
                    </div>
                  )}
                </form>
                {manage && service?.auth === "token" && (
                  <details className="integration-rotate">
                    <summary>
                      <KeyRound size={15} />
                      {t("Token ersetzen", "Replace token")}
                    </summary>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          f = new FormData(form);
                        const r = await act("suite/apps/token", {
                          id: c.id,
                          service_id: service.id,
                          name: c.name,
                          token: f.get("token"),
                          project_ids: c.project_ids ?? [],
                        });
                        if (r) {
                          form.reset();
                          setNotice(
                            t(
                              "Token ersetzt. Bestehende Freigaben bleiben erhalten.",
                              "Token replaced. Existing permissions are retained.",
                            ),
                          );
                        }
                      }}
                    >
                      <label className="field">
                        <span>{t("Neuer Token", "New token")}</span>
                        <input
                          type="password"
                          name="token"
                          minLength={8}
                          maxLength={4096}
                          autoComplete="new-password"
                          required
                        />
                      </label>
                      <button className="secondary" disabled={busy}>
                        {t("Token ersetzen", "Replace token")}
                      </button>
                    </form>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
      {!data && !error && (
        <p role="status">
          {t("Integrationen werden geladen …", "Loading integrations …")}
        </p>
      )}
      {isAdmin && <OAuthAdministration onSaved={load} />}
    </section>
  );
}

function OAuthAdministration({ onSaved }: { onSaved: () => Promise<void> }) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return (
    <details className="panel integration-admin">
      <summary>
        {t(
          "Administration: OAuth-Anbieter einrichten",
          "Administration: configure OAuth providers",
        )}
      </summary>
      <p>
        {t(
          "Registriere eine eigene OAuth-App für deine Installation. Verwende die angezeigte Callback-Adresse. Je nach Anbieter und Rechten kann eine App-Prüfung oder Organisationsfreigabe nötig sein.",
          "Register your installation's OAuth app and use the callback address shown below. App review or organization consent may be required, depending on provider and scopes.",
        )}
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="info-box">
          {t("Gespeichert", "Saved")}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setConfig(await api("admin/work-apps"));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Einrichtung laden", "Load configuration")}
      </button>
      {config && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            setSaved(false);
            try {
              setConfig(
                await api("admin/work-apps", {
                  publicUrl: f.get("origin"),
                  providers: Object.fromEntries(
                    ["google", "microsoft", "github"].map((p) => [
                      p,
                      {
                        enabled: !!f.get(p + "enabled"),
                        clientId: f.get(p + "id"),
                        ...(f.get(p + "secret")
                          ? { secret: f.get(p + "secret") }
                          : {}),
                      },
                    ]),
                  ),
                }),
              );
              await onSaved();
              setSaved(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Public URL</span>
            <input
              name="origin"
              type="url"
              required
              defaultValue={config.publicUrl}
            />
          </label>
          <div className="integration-grid">
            {["google", "microsoft", "github"].map((p) => (
              <fieldset key={p} className="integration-permissions">
                <legend>{p}</legend>
                <p className="integration-callback">
                  {config.providers[p].callback}
                </p>
                <label className="check-row">
                  <input
                    name={p + "enabled"}
                    type="checkbox"
                    defaultChecked={config.providers[p].enabled}
                  />
                  {t("Aktiv", "Enabled")}
                </label>
                <label className="field">
                  <span>Client ID</span>
                  <input
                    name={p + "id"}
                    defaultValue={config.providers[p].clientId}
                  />
                </label>
                <label className="field">
                  <span>
                    Client secret {config.providers[p].configured ? "✓" : ""}
                  </span>
                  <input
                    name={p + "secret"}
                    type="password"
                    autoComplete="new-password"
                    placeholder={t(
                      "Leer behält vorhandenen Wert",
                      "Leave empty to retain existing value",
                    )}
                  />
                </label>
              </fieldset>
            ))}
          </div>
          <button className="primary" disabled={busy}>
            {t("OAuth-Einrichtung speichern", "Save OAuth configuration")}
          </button>
        </form>
      )}
    </details>
  );
}
