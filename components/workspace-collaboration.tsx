"use client";
import { useEffect, useId, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";

export function TeamPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useLanguage(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState("");
  const load = async () => setData(await api("team"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    setInvite(new URLSearchParams(window.location.search).get("invite") ?? "");
  }, [workspaceId]);
  const act = async (body: any) => {
    setBusy(true);
    setError("");
    try {
      const r = await api("team", body);
      if (r.invite_url) setLink(r.invite_url);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canManage = ["owner", "admin"].includes(data?.role);
  return (
    <section className="panel settings-panel">
      <h1>{t("Team & Rollen", "Team & roles")}</h1>
      <p>
        {t(
          "Gemeinsam an diesem Workspace arbeiten. Abrechnung und Kontoinhaberschaft bleiben beim Eigentümer.",
          "Work together in this workspace. Billing and account ownership remain with its owner.",
        )}
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {invite && (
        <div className="form-note">
          <p>
            {t(
              "Einladung für dein angemeldetes Konto annehmen? Die E-Mail-Adresse muss übereinstimmen.",
              "Accept this invitation for your signed-in account? The email address must match.",
            )}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api("team/accept", { token: invite });
                window.location.href =
                  "/team?workspaceId=" + encodeURIComponent(r.workspace_id);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {t("Einladung annehmen", "Accept invitation")}
          </button>
        </div>
      )}
      {data && (
        <>
          <p>
            {t("Deine Rolle: ", "Your role: ")}
            <strong>{data.role}</strong>
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Person", "Person")}</th>
                  <th>{t("Rolle", "Role")}</th>
                  <th>{t("Aktion", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m: any) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <br />
                      <small>{m.email}</small>
                    </td>
                    <td>
                      {canManage && m.role !== "owner" ? (
                        <select
                          aria-label={t("Rolle für ", "Role for ") + m.email}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            void act({
                              action: "role",
                              id: m.id,
                              role: e.target.value,
                            })
                          }
                        >
                          <option>admin</option>
                          <option>editor</option>
                          <option>viewer</option>
                        </select>
                      ) : (
                        m.role
                      )}
                    </td>
                    <td>
                      {canManage && m.role !== "owner" && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act({ action: "remove", id: m.id })
                          }
                        >
                          {t("Zugriff entziehen", "Revoke access")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            {t(
              "Admin: Mitglieder und Workspace verwalten. Editor: Aufträge, Chat und Projekte bearbeiten; Freigaben bleiben bei Admin/Eigentümer. Viewer: lesen.",
              "Admin: manage members and workspace. Editor: work with tasks, chat and projects; approvals remain with admin/owner. Viewer: read only.",
            )}
          </p>
          {canManage && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act({
                  action: "invite",
                  email: f.get("email"),
                  role: f.get("role"),
                });
              }}
            >
              <h2>{t("Mitglied einladen", "Invite member")}</h2>
              <div className="form-grid">
                <label className="field">
                  <span>E-Mail</span>
                  <input name="email" type="email" required />
                </label>
                <label className="field">
                  <span>{t("Rolle", "Role")}</span>
                  <select name="role" defaultValue="editor">
                    <option>editor</option>
                    <option>viewer</option>
                    <option>admin</option>
                  </select>
                </label>
              </div>
              <button className="primary" disabled={busy}>
                {t(
                  "Einladung erstellen & E-Mail vormerken",
                  "Create invitation & queue email",
                )}
              </button>
            </form>
          )}
          {link && (
            <label className="field">
              <span>
                {t(
                  "Einladungslink – nur der eingeladenen Person geben",
                  "Invitation link — share only with the invited person",
                )}
              </span>
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <small>
                {t(
                  "Sieben Tage gültig, einmalig. E-Mail-Versand benötigt den eingerichteten Mailserver.",
                  "Valid for seven days, single use. Email delivery requires a configured mail server.",
                )}
              </small>
            </label>
          )}
          {canManage && data.invitations?.length > 0 && (
            <div>
              <h2>{t("Einladungen", "Invitations")}</h2>
              {data.invitations.map((i: any) => (
                <p key={i.id}>
                  {i.email} · {i.role} ·{" "}
                  {i.accepted_at
                    ? t("angenommen", "accepted")
                    : i.revoked_at
                      ? t("widerrufen", "revoked")
                      : new Date(i.expires_at).toLocaleDateString()}
                  {!i.accepted_at && !i.revoked_at && (
                    <button
                      className="text-button"
                      onClick={() => void act({ action: "revoke", id: i.id })}
                    >
                      {t("Widerrufen", "Revoke")}
                    </button>
                  )}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function KnowledgePanel() {
  const { t } = useLanguage(),
    [query, setQuery] = useState(""),
    [data, setData] = useState<any>(null),
    [source, setSource] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel settings-panel">
      <h1>{t("Projektsuche", "Project search")}</h1>
      <p>
        {t(
          "Dateien, Ergebnisse, Gespräche und Gedächtnis gemeinsam durchsuchen. Gezielte Auszüge mit Quellenbezug, ohne KI-Aufruf.",
          "Search files, deliverables, conversations and memory together. Focused excerpts with references, without an AI call.",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setSource(null);
          try {
            setData(
              await api("knowledge/search?q=" + encodeURIComponent(query)),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{t("Suchbegriff", "Search query")}</span>
          <input
            value={query}
            minLength={2}
            maxLength={200}
            required
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {t("Workspace durchsuchen", "Search workspace")}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {data && (
        <p role="status">
          {data.results.length}{" "}
          {t(
            "Treffer · Volltextsuche · 0 KI-Aufrufe",
            "results · full-text search · 0 AI calls",
          )}
        </p>
      )}
      {data?.results.map((r: any) => (
        <article className="form-note" key={r.reference}>
          <strong>{r.title}</strong>
          <small>{r.reference}</small>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {r.preview}
          </p>
          <button
            className="secondary"
            onClick={async () => {
              try {
                setSource(
                  await api("knowledge/read", {
                    kind: r.kind,
                    id: r.id,
                    start: 1,
                    lines: 80,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {t("Quelle lesen", "Read source")}
          </button>
        </article>
      ))}
      {source && (
        <article className="form-note">
          <h2>{source.title}</h2>
          <p>
            {source.reference} · SHA256 {source.sha256.slice(0, 16)}
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 400,
              overflow: "auto",
            }}
          >
            {source.content}
          </pre>
          <p>
            {t("Zeilen ", "Lines ")}
            {source.start}–{Math.min(source.start + 79, source.total_lines)} /{" "}
            {source.total_lines}
          </p>
          {source.start + 80 <= source.total_lines && (
            <button
              className="secondary"
              onClick={async () => {
                const [kind, id] = source.reference.split(":");
                setSource(
                  await api("knowledge/read", {
                    kind,
                    id,
                    start: source.start + 80,
                    lines: 80,
                  }),
                );
              }}
            >
              {t("Nächster Auszug", "Next excerpt")}
            </button>
          )}
        </article>
      )}
    </section>
  );
}

export function BriefingPanel({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: string;
}) {
  const { t, locale } = useLanguage(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const formId = useId();
  const load = async () => setData(await api("briefings"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [workspaceId]);
  const act = async (path: string, body: any) => {
    setBusy(true);
    setError("");
    try {
      setData(await api(path, body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const manage = ["owner", "admin"].includes(role);
  return (
    <section className="panel settings-panel">
      <h1>{t("Briefings & Hinweise", "Briefings & notifications")}</h1>
      <p>
        {t(
          "Eine gebündelte Tagesübersicht statt ständiger KI-Abfragen. In-App-Hinweise und optional E-Mail mit Ruhezeiten.",
          "A consolidated daily overview instead of constant AI calls. In-app notices and optional email with quiet hours.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {data && (
        <div className="settings-stack">
          {manage && (
            <form
              id={formId}
              key={JSON.stringify(data.preferences)}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("briefings", {
                  action: "configure",
                  enabled: !!f.get("enabled"),
                  email: !!f.get("email"),
                  timezone: f.get("timezone"),
                  locale,
                  local_hour: Number(f.get("hour")),
                  quiet_start: Number(f.get("quiet_start")),
                  quiet_end: Number(f.get("quiet_end")),
                });
              }}
            >
              <label className="check-row">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={data.preferences.enabled}
                />
                {t("Tagesbriefing aktivieren", "Enable daily briefing")}
              </label>
              <div className="form-grid">
                <label className="field">
                  <span>{t("Zeitzone", "Time zone")}</span>
                  <input
                    name="timezone"
                    required
                    defaultValue={data.preferences.timezone}
                  />
                </label>
                {[
                  [
                    "hour",
                    t("Briefing-Stunde (0–23)", "Briefing hour (0–23)"),
                    data.preferences.local_hour,
                  ],
                  [
                    "quiet_start",
                    t("Ruhezeit ab Stunde", "Quiet hours start"),
                    data.preferences.quiet_start,
                  ],
                  [
                    "quiet_end",
                    t("Ruhezeit bis Stunde", "Quiet hours end"),
                    data.preferences.quiet_end,
                  ],
                ].map(([name, label, value]) => (
                  <label className="field" key={String(name)}>
                    <span>{label}</span>
                    <input
                      name={String(name)}
                      type="number"
                      min={0}
                      max={23}
                      required
                      defaultValue={String(value)}
                    />
                  </label>
                ))}
              </div>
              <label className="check-row">
                <input
                  name="email"
                  type="checkbox"
                  defaultChecked={data.preferences.email}
                />
                {t(
                  "Zusätzlich an die E-Mail-Adresse des Eigentümers senden",
                  "Also email the workspace owner",
                )}
              </label>
            </form>
          )}
          <div className="button-row">
            {manage && (
              <button
                className="primary"
                type="submit"
                form={formId}
                disabled={busy}
              >
                {t(
                  "Briefing-Einstellungen speichern",
                  "Save briefing settings",
                )}
              </button>
            )}
            {role !== "viewer" && (
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => void act("briefings/refresh", {})}
              >
                {t(
                  "Übersicht jetzt erstellen (ohne KI)",
                  "Build overview now (no AI)",
                )}
              </button>
            )}
          </div>
          {data.notifications.length === 0 && (
            <p>{t("Noch keine Hinweise.", "No notifications yet.")}</p>
          )}
          {data.notifications.map((n: any) => (
            <article className="form-note briefing-notice" key={n.id}>
              <h2>{n.title}</h2>
              <p>{n.body}</p>
              <small>{new Date(n.created_at).toLocaleString()}</small>
              <div className="button-row">
                <a href={n.href}>{t("Öffnen", "Open")}</a>
                {!n.read_at && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void act("briefings/read", { id: n.id })}
                  >
                    {t("Als gelesen markieren", "Mark read")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function EnvironmentBudgets({
  workspaceId,
  role = "owner",
}: {
  workspaceId?: string;
  role?: string;
}) {
  const { t } = useLanguage(),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const load = async () => setData(await api("environments/budgets"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [workspaceId]);
  return (
    <section className="panel settings-panel">
      <h2>{t("Leerlauf & Speicherbudgets", "Idle & storage budgets")}</h2>
      <p>
        {t(
          "Leerlauf beendet die Laufzeit, Dateien bleiben erhalten. CPU/RAM werden bereits über Containergrenzen begrenzt.",
          "Idle shutdown stops runtime billing; files are retained. CPU/RAM are already limited by container settings.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((e: any) => (
        <form
          className="form-note"
          key={e.id}
          onSubmit={async (event) => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            try {
              setData(
                await api("environments/budgets", {
                  id: e.id,
                  idle_minutes: Number(f.get("idle")),
                  auto_wake: !!f.get("wake"),
                  storage_budget_mb: Number(f.get("storage")),
                }),
              );
              setError("");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <strong>
            {e.name} · {e.status}
          </strong>
          <p>
            {e.cpu} CPU · {e.memory_mb} MiB RAM ·{" "}
            {e.storage_used_bytes === null
              ? t(
                  "Speichernutzung noch nicht gemessen",
                  "Storage usage not measured yet",
                )
              : (e.storage_used_bytes / 1048576).toFixed(1) + " MiB"}
          </p>
          <div className="form-grid">
            <label className="field">
              <span>
                {t(
                  "Nach Leerlauf stoppen (Minuten; 0 = aus)",
                  "Stop after idle (minutes; 0 = off)",
                )}
              </span>
              <input
                name="idle"
                type="number"
                min={0}
                max={1440}
                defaultValue={e.idle_minutes}
              />
            </label>
            <label className="field">
              <span>
                {t(
                  "Projekt-Speicherbudget (MiB)",
                  "Project storage budget (MiB)",
                )}
              </span>
              <input
                name="storage"
                type="number"
                min={64}
                max={1048576}
                defaultValue={e.storage_budget_mb}
              />
            </label>
          </div>
          <label className="check-row">
            <input name="wake" type="checkbox" defaultChecked={e.auto_wake} />
            {t(
              "Freigegebene Agenten dürfen die Umgebung starten; Hosting-Minuten können anfallen.",
              "Authorized agents may start this environment; hosted minutes may be charged.",
            )}
          </label>
          {["owner", "admin"].includes(role) && (
            <button className="secondary">
              {t("Umgebungsbudget speichern", "Save environment budget")}
            </button>
          )}
        </form>
      ))}
      <small>
        {t(
          "Speicher wird am Controller überwacht; eine harte Dateisystemquote erfordert eine geeignete Host-/Volume-Konfiguration.",
          "Storage is monitored by the controller; a hard filesystem quota requires a suitable host/volume configuration.",
        )}
      </small>
    </section>
  );
}
