"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
export function RunProcesses({
  runId,
  active,
}: {
  runId: string;
  active: boolean;
}) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      api<any>("runtime/processes?runId=" + encodeURIComponent(runId))
        .then((v) => {
          if (live) setRows(v.processes);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const interval = active ? setInterval(() => void load(), 5000) : undefined;
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [runId, active]);
  if (!rows.length && !error) return null;
  return (
    <section className="panel settings-panel">
      <h2>{t("Containerprozesse", "Environment processes")}</h2>
      <small>
        {t(
          "Letzter Ausgabeabschnitt; Statusabfragen lösen keine KI-Aufrufe aus.",
          "Latest output section; status checks do not trigger AI calls.",
        )}
      </small>
      {error && <p role="alert">{error}</p>}
      {rows.map((p) => (
        <details key={p.process_id}>
          <summary>
            {p.environment_name} · {p.status} ·{" "}
            {p.exit_code !== null && p.exit_code !== undefined
              ? "Exit " + p.exit_code
              : ""}{" "}
            {p.canceled
              ? t("Abgebrochen", "Canceled")
              : p.timed_out
                ? t("Zeitlimit", "Timed out")
                : ""}
          </summary>
          <code>{p.process_id}</code>
          <pre className="process-output">
            {p.output || t("Noch keine Ausgabe.", "No output yet.")}
          </pre>
        </details>
      ))}
    </section>
  );
}
