"use client";
import { useState } from "react";
import type { Snapshot, Skill } from "../src/core/types";
import { useLanguage } from "./language";
import { api } from "./api-client";
import { RuntimeInsights } from "./runtime-insights";

export function RunPolicySettings({
  state,
  changed,
}: {
  state: Snapshot;
  changed: () => void;
}) {
  const { t } = useLanguage(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const own = state.workspace.ai_mode === "byok";
  const canManage = ["owner", "admin"].includes(
    state.workspace.membership_role ?? "owner",
  );
  const models = state.models.filter(
    (m) =>
      m.active &&
      (own ? m.workspace_id === state.workspace.id : m.workspace_id === null),
  );
  return (
    <>
      <section className="panel settings-panel safety-panel">
        <h2>
          {t(
            "Auftragslimit & Ausweichmodelle",
            "Task budget & fallback models",
          )}
        </h2>
        <p>
          {t(
            "Gilt für neue Aufträge und Teamchat-Aufträge, gemeinsam für alle beteiligten Agenten. Laufende Aufträge behalten ihre festen Grenzen.",
            "Applies to new tasks and team-chat tasks, shared by all participating agents. Existing tasks keep their fixed limits.",
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setNotice("");
            try {
              await api("run-policy", {
                credit_limit: Number(f.get("credits")),
                token_limit: Number(f.get("tokens")),
                fallback_model_ids: f.getAll("models"),
                context_strategy: f.get("context_strategy"),
              });
              setNotice(
                t(
                  "Gespeichert. Gilt ab dem nächsten Auftrag.",
                  "Saved. Applies from the next task.",
                ),
              );
              changed();
            } catch (err) {
              setNotice((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset
            disabled={!canManage || busy}
            className="budget-settings-fields"
          >
            <div className="form-grid">
              <label className="field">
                <span>
                  {t(
                    "Festes KI-Credit-Limit je Auftrag",
                    "Fixed AI-credit limit per task",
                  )}
                </span>
                <input
                  type="number"
                  name="credits"
                  min={0}
                  max={10000000}
                  step={1}
                  defaultValue={state.workspace.run_credit_limit ?? 10000}
                  required
                />
              </label>
              <label className="field">
                <span>
                  {t(
                    "Tokenbudget je Auftrag (Eingabe + Ausgabe)",
                    "Token budget per task (input + output)",
                  )}
                </span>
                <input
                  type="number"
                  name="tokens"
                  min={1000}
                  max={10000000}
                  step={1}
                  defaultValue={state.workspace.run_token_limit ?? 100000}
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>{t("Kontextstrategie", "Context strategy")}</span>
              <select
                name="context_strategy"
                defaultValue={state.workspace.context_strategy ?? "compact"}
              >
                <option value="compact">
                  {t(
                    "Kompakt – wiederholte Inhalte reduzieren",
                    "Compact – reduce repeated content",
                  )}
                </option>
                <option value="cache_aware">
                  {t(
                    "Cache bevorzugen – Verlauf erhalten, solange Budget reicht",
                    "Prefer cache – preserve history while budget allows",
                  )}
                </option>
              </select>
              <small>
                {t(
                  "Cache-Rabatte hängen vom Anbieter ab. Bei knappen Grenzen wird weiterhin gekürzt. Verbrauch und gemeldete Kosten werden je Strategie erfasst.",
                  "Cache discounts depend on your provider. Tight limits still trigger compaction. Usage and reported costs are recorded per strategy.",
                )}
              </small>
            </label>
            <p className="form-note">
              {t(
                "Unklare Verbräuche bleiben konservativ reserviert. Reicht das Restbudget nicht, pausiert der Auftrag. Hosting-Minuten sind ein separates Kontingent. Bei BYOK begrenzt die App Tokens und Aufrufe; Kosten beim externen Anbieter bitte zusätzlich dort begrenzen.",
                "Uncertain usage stays conservatively reserved. If the remaining budget is insufficient, the task pauses. Hosted minutes are separate. For BYOK, the app limits tokens and calls; also set a spending cap at your external provider.",
              )}
            </p>
            <fieldset>
              <legend>
                {t(
                  "Erlaubte Ausweichmodelle · höchstens 3",
                  "Approved fallback models · maximum 3",
                )}
              </legend>
              <p>
                {t(
                  "Auswahlreihenfolge ist die Katalogreihenfolge unten. Wechsel nur bei vorübergehenden Anbieterfehlern, nie wegen fehlender Rechte oder leerer Credits. Keine ausgewählten Modelle = kein automatischer Wechsel.",
                  "Order follows the catalog below. Switches only for temporary provider errors, never for missing permissions or depleted credits. No selected models means no automatic failover.",
                )}
              </p>
              {models.map((m) => (
                <label className="check-row" key={m.id}>
                  <input
                    name="models"
                    type="checkbox"
                    value={m.id}
                    defaultChecked={state.workspace.fallback_model_ids?.some(
                      (a) => a.id === m.id,
                    )}
                  />
                  <span>
                    {m.name} · {m.provider_name}{" "}
                    {m.workspace_id === null
                      ? `· ${m.input_rate}/${m.output_rate} Credits / 1k Tokens + ${m.base_credits}`
                      : "· BYOK"}
                  </span>
                </label>
              ))}
              {!models.length && (
                <p>
                  {t(
                    "Zuerst ein Modell einrichten.",
                    "Configure a model first.",
                  )}
                </p>
              )}
            </fieldset>
            <p>
              <button className="primary" disabled={busy}>
                {t(
                  "Grenzen und Modellfreigabe speichern",
                  "Save limits and model approval",
                )}
              </button>
            </p>
          </fieldset>
          {!canManage && (
            <p className="form-note">
              {t(
                "Workspace-Inhaber und Administratoren verwalten diese Standards.",
                "Workspace owners and admins manage these defaults.",
              )}
            </p>
          )}
        </form>
        {notice && (
          <p role="status" className="form-note">
            {notice}
          </p>
        )}
      </section>
    </>
  );
}

export function SkillReview({
  skill,
  changed,
}: {
  skill: Skill;
  changed: () => void;
}) {
  const { t } = useLanguage(),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [receipts, setReceipts] = useState<any[]>([]);
  const review = async (action: string) => {
    setBusy(true);
    setNotice("");
    try {
      await api(`skills/${skill.id}/review`, {
        version: skill.version,
        action,
        note,
      });
      changed();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="skill-review">
      <p>
        <strong>
          {skill.status === "draft"
            ? t(
                "Entwurf · nicht für Agenten verfügbar",
                "Draft · unavailable to agents",
              )
            : skill.status === "rejected"
              ? t("Abgelehnt", "Rejected")
              : t("Freigegeben", "Approved")}
        </strong>
      </p>
      {skill.source_run_id && (
        <a href={`/tasks/${skill.source_run_id}`}>
          {t(
            "Ursprungsauftrag mit Belegen öffnen",
            "Open source task and evidence",
          )}{" "}
          ↗
        </a>
      )}
      <details>
        <summary>
          {t("Anleitung und Prüfnachweise", "Instructions and evidence")}
        </summary>
        <pre className="skill-content">{skill.content}</pre>
        <ul>
          {skill.evidence?.map((e) => (
            <li key={e.id}>
              {e.kind === "artifact" ? (
                <a
                  href={`/api/artifacts/${e.id}/download?workspaceId=${skill.workspace_id}`}
                >
                  {e.name}
                </a>
              ) : (
                e.tool
              )}
              <small className="evidence-hash">
                {e.id} · SHA-256 {e.sha256 ?? "—"}
              </small>
            </li>
          ))}
        </ul>
        <p>
          {t(
            "Belege dokumentieren beobachtete Werkzeugergebnisse; sie beweisen keine fachliche Korrektheit. Die Freigabe ersetzt keine Werkzeugberechtigung.",
            "Evidence records observed tool results; it does not establish domain correctness. Approval does not grant tool permissions.",
          )}
        </p>
      </details>
      {skill.status === "draft" && (
        <>
          <label className="field">
            <span>
              {t(
                "Prüfnotiz: Was hast du geprüft?",
                "Review note: what did you verify?",
              )}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minLength={10}
              maxLength={3000}
              rows={3}
            />
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || note.trim().length < 10}
              onClick={() => void review("approve")}
            >
              {t("Geprüfte Version freigeben", "Approve reviewed version")}
            </button>
            <button
              className="secondary"
              disabled={busy || note.trim().length < 10}
              onClick={() => void review("reject")}
            >
              {t("Entwurf ablehnen", "Reject draft")}
            </button>
          </div>
        </>
      )}
      <button
        className="secondary"
        onClick={() =>
          void api(`skills/${skill.id}/evidence`)
            .then((r) => setReceipts(r.evidence))
            .catch((e) => setNotice(e.message))
        }
      >
        {t(
          "Originalbelege laden und Prüfsummen vergleichen",
          "Load original receipts and compare hashes",
        )}
      </button>
      {receipts.map((r) => (
        <details key={r.id}>
          <summary>
            {r.tool ?? r.name} ·{" "}
            {r.available
              ? r.verified
                ? t("Prüfsumme stimmt", "Hash matches")
                : t("Beleg verändert", "Evidence changed")
              : t("Quelle nicht mehr vorhanden", "Source no longer available")}
          </summary>
          {r.result && (
            <pre className="skill-content">
              {JSON.stringify(r.result, null, 2)}
            </pre>
          )}
        </details>
      ))}
      {skill.review_note && <p>{skill.review_note}</p>}
      <details
        onToggle={(e) => {
          if (e.target === e.currentTarget && e.currentTarget.open)
            void api(`skills/${skill.id}/history`)
              .then((r) => setHistory(r.revisions))
              .catch((err) => setNotice(err.message));
        }}
      >
        <summary>{t("Versionsverlauf", "Version history")}</summary>
        {history.map((r) => (
          <details key={r.version}>
            <summary>
              v{r.version} · {r.status}
            </summary>
            <p>{r.review_note}</p>
            <pre className="skill-content">{r.content}</pre>
          </details>
        ))}
      </details>
      {notice && <p role="alert">{notice}</p>}
    </div>
  );
}

export function CheckpointPanel({
  runId,
  environmentId,
  workspaceId,
}: {
  runId?: string;
  environmentId?: string;
  workspaceId?: string;
}) {
  const { t } = useLanguage(),
    [items, setItems] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [name, setName] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false);
  const request = (action: string, extra: Record<string, unknown> = {}) =>
    environmentId
      ? api("environments/checkpoints", {
          environment_id: environmentId,
          action,
          ...extra,
        })
      : action === "list"
        ? api(`runs/${runId}/checkpoints`)
        : api(`runs/${runId}/checkpoints`, { action, ...extra });
  const act = async (action: string, item?: any) => {
    setBusy(true);
    setNotice("");
    try {
      if (action === "stop") {
        await api("execution/control", { action: "stop" });
        setNotice(
          t(
            "Workspace gestoppt. Jetzt eine neue Vorschau öffnen.",
            "Workspace stopped. Open a fresh preview now.",
          ),
        );
        setPreview(null);
        return;
      }
      const args =
        action === "create"
          ? { name: name || t("Sicherungspunkt", "Checkpoint") }
          : item
            ? environmentId
              ? { checkpoint_id: item.id, preview_token: preview?.token }
              : { id: item.id, token: preview?.token }
            : {};
      const r = await request(action, args);
      if (r.ok === false) throw new Error(r.error ?? "Checkpoint failed");
      if (action === "preview") {
        setPreview({ ...r, item });
        setConfirmed(false);
      } else if (action === "list") {
        setItems(r.checkpoints ?? []);
      } else {
        setPreview(null);
        const list = await request("list");
        if (list.ok === false) throw new Error(list.error);
        setItems(list.checkpoints ?? []);
        setNotice(t("Aktion abgeschlossen.", "Action completed."));
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="panel settings-panel checkpoint-panel"
      onToggle={(e) => {
        if (e.target === e.currentTarget && e.currentTarget.open)
          void act("list");
      }}
    >
      <summary>
        {t("Sicherungspunkte & Zurücksetzen", "Checkpoints & restore")}
      </summary>
      <p>
        {environmentId
          ? t(
              "Lokale Projektdateien: maximal 300 Dateien / 8 MiB, zehn Sicherungen. .env, Schlüsseldateien, .git, Abhängigkeiten und symbolische Links werden ausgelassen. Große Dateien führen zum Abbruch. Browserzustand, Datenbanken und externe Aktionen sind nicht enthalten.",
              "Local project files: up to 300 files / 8 MiB, ten snapshots. .env, key files, .git, dependencies and symbolic links are excluded. Large files abort the snapshot. Browser state, databases and external actions are not included.",
            )
          : t(
              "Sichert veröffentlichte Ergebnisdateien dieses Auftrags. Gespräch, Gedächtnis, Container und externe Aktionen werden hierdurch nicht zurückgesetzt. Alte Dateien bleiben als frühere Versionen erhalten.",
              "Saves this task’s published deliverables. Conversation, memory, containers and external actions are not rewound. Old files remain available as previous versions.",
            )}
      </p>
      <div className="checkpoint-create">
        <label className="field">
          <span>{t("Bezeichnung", "Label")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act("create")}
        >
          {t("Sicherung erstellen", "Create checkpoint")}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void act("list")}
        >
          {t("Aktualisieren", "Refresh")}
        </button>
      </div>
      {!items.length && (
        <p>
          {environmentId
            ? t(
                "Noch keine Sicherungspunkte. Die Umgebung muss laufen und den aktuellen Controller verwenden.",
                "No checkpoints yet. The environment must be running with the current controller.",
              )
            : t(
                "Noch keine Ergebnissicherung.",
                "No deliverable checkpoints yet.",
              )}
        </p>
      )}
      {items.map((item) => (
        <div className="checkpoint-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <p>
              {item.files} {t("Dateien", "files")} ·{" "}
              {new Date(item.created_at).toLocaleString()}
            </p>
            {item.skipped?.length > 0 && (
              <details>
                <summary>{t("Ausgelassene Pfade", "Excluded paths")}</summary>
                <pre>{item.skipped.join("\n")}</pre>
              </details>
            )}
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act("preview", item)}
          >
            {t("Zurücksetzen prüfen", "Preview restore")}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void act("delete", item)}
          >
            {t("Sicherung entfernen", "Remove snapshot")}
          </button>
        </div>
      ))}
      {preview && (
        <div className="form-note restore-preview">
          <h3>
            {t("Änderungsvorschau", "Restore preview")}: {preview.item.name}
          </h3>
          {environmentId ? (
            <ul>
              {preview.changes?.map((c: any) => (
                <li key={c.name}>
                  {c.action} · {c.name}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>
                {t(
                  "Aktuelle Dateien → Dateien der Sicherung",
                  "Current files → checkpoint files",
                )}
              </p>
              <div className="checkpoint-preview-files">
                {[
                  ["current", t("Aktueller Stand", "Current state")],
                  ["target", t("Stand der Sicherung", "Checkpoint state")],
                ].map(([key, label]) => (
                  <section key={key}>
                    <strong>{label}</strong>
                    <ul>
                      {preview[key]?.map((f: any) => (
                        <li key={f.id}>
                          <a
                            href={`/api/artifacts/${encodeURIComponent(f.id)}/download${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`}
                          >
                            {f.name}
                          </a>
                          <small className="evidence-hash">{f.id}</small>
                        </li>
                      ))}
                    </ul>
                    {!preview[key]?.length && (
                      <p>{t("Keine Dateien", "No files")}</p>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
          <p>
            {t(
              "Vorher entsteht automatisch eine zusätzliche Sicherung. Halte einen der zehn Plätze frei. Die Vorschau gilt zwei Minuten; spätere Dateiänderungen blockieren die Wiederherstellung. Editor und andere Dateischreiber währenddessen anhalten.",
              "An additional undo snapshot is created first. Keep one of the ten slots free. The preview lasts two minutes; subsequent file changes block restoration. Stop editors and other file writers during restoration.",
            )}
          </p>
          <p>
            {t(
              "Betroffene offene Agentenaufgaben warten anschließend auf eine neue Nutzeranweisung. Prüfe den wiederhergestellten Stand vor der Fortsetzung.",
              "Affected open agent tasks then wait for a new user instruction. Inspect the restored state before continuing.",
            )}
          </p>
          {environmentId && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void act("stop")}
            >
              {t("Workspace-Agenten stoppen", "Stop workspace agents")}
            </button>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t(
              "Ich habe die Änderungen geprüft. Diese Dateien dürfen ersetzt bzw. entfernt werden.",
              "I reviewed the changes. These files may be replaced or removed.",
            )}
          </label>
          <button
            className="primary"
            disabled={busy || !confirmed}
            onClick={() => void act("restore", preview.item)}
          >
            {t("Geprüften Stand wiederherstellen", "Restore reviewed state")}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="form-note">
          {notice}
        </p>
      )}
    </details>
  );
}
