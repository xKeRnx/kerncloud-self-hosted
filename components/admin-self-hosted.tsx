"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
type Interest = {
  id: string;
  email: string;
  company: string;
  use_case: string;
  team_size: string;
  deployment: string;
  locale: string;
  status: string;
  note: string;
  revision: number;
  created_at: string;
  expires_at: string;
  consented_at: string;
  consent_version: string;
};
export function AdminSelfHosted() {
  const { t, number } = useLanguage(),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Interest | null>(null),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState(false);
  const params = new URLSearchParams({
    q: search,
    status,
    page: String(page),
  }).toString();
  const load = useCallback(async () => {
    try {
      setData(await api("admin/self-hosted-interests?" + params));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [params]);
  useEffect(() => {
    void load();
  }, [load]);
  const statusLabel = (v: string) =>
    ({
      new: t("Neu", "New"),
      contacted: t("Kontaktiert", "Contacted"),
      qualified: t("Qualifiziert", "Qualified"),
      archived: t("Archiviert", "Archived"),
    })[v] ?? v;
  const deployment = (v: string) =>
    ({
      undecided: t("Noch offen", "Undecided"),
      local: t("Lokal", "Local"),
      server: t("Eigener Server", "Own server"),
      airgap: t("Ohne Internet", "Air-gapped"),
    })[v] ?? v;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("admin/self-hosted-interests", {
        action: remove ? "delete" : "update",
        id: selected.id,
        revision: selected.revision,
        ...(!remove ? { status: f.get("status"), note: f.get("note") } : {}),
      });
      setSelected(null);
      setRemove(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="waitlist-admin">
      <div className="section-title">
        <div>
          <h2>{t("Self-Hosted-Interessenten", "Self-hosted interest")}</h2>
          <p>
            {t(
              "Unverbindliche Interessensbekundungen von der Landingpage. E-Mail-Adressen sind nicht bestätigt; diese Zahlen sind keine Kunden oder Bestellungen.",
              "Non-binding interest from the landing page. Email addresses are unverified; these counts are not customers or orders.",
            )}
          </p>
        </div>
        <a
          className="button secondary"
          href={"/api/admin/self-hosted-interests/export?" + params}
          download
        >
          {t("Gefilterten CSV-Export laden", "Download filtered CSV")}
        </a>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="stats-grid">
            {[
              [t("Einträge gesamt", "Total entries"), data.summary.total],
              [t("Neu", "New"), data.summary.new],
              [t("Letzte 30 Tage", "Last 30 days"), data.summary.recent],
              [t("Qualifiziert", "Qualified"), data.summary.qualified],
            ].map(([label, value]) => (
              <article className="stat-card" key={label}>
                <div>{label}</div>
                <strong>{number(Number(value))}</strong>
              </article>
            ))}
          </div>
          <div className="waitlist-breakdown">
            {data.deployments.map((v: any) => (
              <span className="badge" key={v.deployment}>
                {deployment(v.deployment)}: {number(v.total)}
              </span>
            ))}
          </div>
        </>
      )}
      <form
        className="waitlist-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <label>
          {t("Suche", "Search")}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t(
              "E-Mail, Firma oder Bedarf",
              "Email, company or use case",
            )}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">{t("Alle", "All")}</option>
            {["new", "contacted", "qualified", "archived"].map((v) => (
              <option value={v} key={v}>
                {statusLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary">{t("Filtern", "Filter")}</button>
      </form>
      {data ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    t("Kontakt", "Contact"),
                    t("Bedarf", "Needs"),
                    t("Eingang", "Received"),
                    "Status",
                    t("Aktion", "Action"),
                  ].map((v) => (
                    <th key={v}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((v: Interest) => (
                  <tr key={v.id}>
                    <td>
                      <strong>{v.email}</strong>
                      <br />
                      {v.company || "—"}
                      <small>
                        {t("E-Mail unbestätigt", "Email unverified")} ·{" "}
                        {v.locale.toUpperCase()}
                      </small>
                    </td>
                    <td>
                      {deployment(v.deployment)} ·{" "}
                      {v.team_size === "undecided" ? "—" : v.team_size}
                      <p className="waitlist-use-case">{v.use_case || "—"}</p>
                    </td>
                    <td>{new Date(v.created_at).toLocaleDateString()}</td>
                    <td>{statusLabel(v.status)}</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => {
                          setSelected(v);
                          setRemove(false);
                        }}
                      >
                        {t("Öffnen", "Open")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.items.length && (
            <p>
              {t(
                "Noch keine passenden Interessenten. Die Warteliste ist auf der Landingpage unter „Self-Hosted“ erreichbar.",
                "No matching interest yet. The waitlist is available under “Self-Hosted” on the landing page.",
              )}
            </p>
          )}
          <div className="organisation-actions">
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t("Zurück", "Previous")}
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(data.total / 25))} ·{" "}
              {number(data.total)} {t("Treffer", "matches")}
            </span>
            <button
              className="secondary"
              disabled={page * 25 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              {t("Weiter", "Next")}
            </button>
          </div>
        </>
      ) : (
        <p role="status">{t("Wird geladen …", "Loading …")}</p>
      )}
      {selected && (
        <form
          className="panel settings-panel"
          onSubmit={save}
          key={selected.id + ":" + selected.revision}
        >
          <h3>{selected.email}</h3>
          <p>
            {selected.company || "—"} · {deployment(selected.deployment)} ·{" "}
            {selected.team_size}
          </p>
          <p className="waitlist-use-case">{selected.use_case || "—"}</p>
          <p>
            {t("Einwilligung", "Consent")}:{" "}
            {new Date(selected.consented_at).toLocaleString()} ·{" "}
            {selected.consent_version}
            <br />
            {t("Automatische Löschung ab", "Automatic removal after")}:{" "}
            {new Date(selected.expires_at).toLocaleDateString()}
          </p>
          <label>
            Status
            <select name="status" defaultValue={selected.status}>
              {["new", "contacted", "qualified", "archived"].map((v) => (
                <option key={v} value={v}>
                  {statusLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Interne Notiz", "Internal note")}
            <textarea
              name="note"
              rows={3}
              maxLength={3000}
              defaultValue={selected.note}
            />
          </label>
          {remove && (
            <p className="error-box">
              {t(
                "E-Mail-Adresse und Angaben werden endgültig gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.",
                "The email address and details will be permanently deleted. This cannot be undone.",
              )}
            </p>
          )}
          <div className="organisation-actions">
            <button className={remove ? "danger" : "primary"} disabled={busy}>
              {remove
                ? t(
                    "Endgültig löschen bestätigen",
                    "Confirm permanent deletion",
                  )
                : t("Speichern", "Save")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setRemove(false);
              }}
            >
              {t("Schließen", "Close")}
            </button>
            {!remove && (
              <button
                type="button"
                className="text-button"
                onClick={() => setRemove(true)}
              >
                {t("Eintrag löschen", "Delete entry")}
              </button>
            )}
          </div>
        </form>
      )}
      <p className="notice">
        {t(
          "Nur für die Prüfung und Kontaktaufnahme zum Self-Hosted-Angebot verwenden. Keine automatischen E-Mails. Einträge werden nach 180 Tagen entfernt; Widerrufe bitte über „Eintrag löschen“ bearbeiten. CSV-Dateien enthalten personenbezogene Angaben und müssen ebenfalls geschützt und bei Löschanfragen berücksichtigt werden.",
          "Use only to assess and contact interest in self-hosting. No automatic emails. Entries expire after 180 days; process withdrawals using “Delete entry”. CSV files contain personal details and must also be protected and considered for deletion requests.",
        )}
      </p>
    </section>
  );
}
