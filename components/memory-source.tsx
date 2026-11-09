"use client";
import { useState, useEffect } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import type { MemoryEntry } from "../src/core/types";
export function MemoryExclusions({
  workspaceId,
  refresh,
  changed,
}: {
  workspaceId: string;
  refresh: number;
  changed: () => void;
}) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<any>("memory/source")
      .then((v) => {
        if (live) setRows(v.entries);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [workspaceId, refresh]);
  if (!rows.length && !error) return null;
  return (
    <details className="panel settings-panel">
      <summary>
        {t("Ausgeschlossene Gedächtnisquellen", "Excluded memory sources")} (
        {rows.length})
      </summary>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <div className="button-row" key={r.kind + r.source_id}>
          <code>
            {r.kind}: {r.source_id}
          </code>
          <button
            className="secondary small"
            onClick={async () => {
              try {
                await api("memory/source", {
                  source: { kind: r.kind, id: r.source_id },
                  action: "readmit",
                });
                changed();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {t("Quelle wieder zulassen", "Allow source again")}
          </button>
        </div>
      ))}
    </details>
  );
}
export function MemorySource({
  entry,
  changed,
}: {
  entry: MemoryEntry;
  changed: () => void;
}) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(source: any, include_protected = false) {
    setError("");
    try {
      const result = await api<any>("memory/source", {
        source,
        action: "preview",
        include_protected,
      });
      setPreview({ ...result, source, include_protected });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="memory-evidence">
      {entry.stale && (
        <p role="status">
          {t(
            "Wissen möglicherweise veraltet: Gültigkeit oder Originalquelle prüfen.",
            "Knowledge may be outdated: check expiry and original source.",
          )}
        </p>
      )}
      {entry.expires_at && (
        <small>
          {t("Gültig bis", "Valid until")}:{" "}
          {new Date(entry.expires_at).toLocaleString()}
        </small>
      )}
      {entry.sources?.map((s) => (
        <div key={s.kind + s.source_id}>
          <code>
            {s.kind}: {s.source_id}
          </code>{" "}
          ·{" "}
          {s.available
            ? s.stale
              ? t("Geändert", "Changed")
              : t("Unverändert", "Unchanged")
            : t("Nicht mehr vorhanden", "Unavailable")}
          <button
            className="secondary small"
            type="button"
            onClick={() => void load({ kind: s.kind, id: s.source_id })}
          >
            {t("Quelle vergessen …", "Forget source …")}
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <section className="notice">
          <strong>
            {t("Gedächtnisbereinigung prüfen", "Review memory cleanup")}
          </strong>
          <p>
            {t(
              "Entfernt abgeleitete automatische Erinnerungen und sperrt erneute Übernahme. Originalaufträge, Dateien und andere Kopien werden nicht gelöscht. Geschützte und manuelle Einträge bleiben standardmäßig erhalten.",
              "Removes derived automatic memories and excludes re-ingestion. Original tasks, files and other copies are not deleted. Protected and manual entries are kept by default.",
            )}
          </p>
          <ul>
            {preview.entries.map((e: any) => (
              <li key={e.id}>
                {e.title} ·{" "}
                {e.pinned || e.verified || !e.automatic
                  ? t("Geschützt / manuell", "Protected / manual")
                  : t("Automatisch", "Automatic")}
              </li>
            ))}
          </ul>
          <label className="check-row">
            <input
              type="checkbox"
              checked={preview.include_protected}
              onChange={(e) => void load(preview.source, e.target.checked)}
            />
            {t(
              "Geschützte und manuelle Einträge ebenfalls entfernen",
              "Also remove protected and manual entries",
            )}
          </label>
          <div className="button-row">
            <button
              disabled={busy}
              className="danger"
              onClick={async () => {
                setBusy(true);
                try {
                  await api("memory/source", {
                    source: preview.source,
                    action: "forget",
                    include_protected: preview.include_protected,
                    preview_hash: preview.preview_hash,
                  });
                  setPreview(null);
                  changed();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Bereinigung ausführen", "Apply cleanup")}
            </button>
            <button className="secondary" onClick={() => setPreview(null)}>
              {t("Abbrechen", "Cancel")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
