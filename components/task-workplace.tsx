"use client";
import { useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import { RunProcesses } from "./run-processes";
export function TaskWorkplace({
  run,
  onResults,
}: {
  run: any;
  onResults: () => void;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => api<any>("runs/" + run.id + "/workplace").then(setData);
  useEffect(() => {
    let live = true;
    const fetchData = () =>
      api<any>("runs/" + run.id + "/workplace")
        .then((d) => {
          if (live) setData(d);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void fetchData();
    const timer = setInterval(() => {
      if (!document.hidden) void fetchData();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [run.id]);
  async function control(e: any, action: string) {
    setBusy(true);
    setError("");
    try {
      await api("runs/" + run.id + "/workplace", {
        action: action === "release-resume" ? "release" : action,
        environmentId: e.id,
      });
      if (action === "release-resume")
        await api("runs/" + run.id, { action: "resume" }, "PATCH");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(e: any) {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const r = await api<any>("environments/launch", { id: e.id });
      if (tab) tab.location.replace(r.url);
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel task-workplace">
      <div className="section-heading">
        <h2>{t("Arbeitsplatz", "Workplace")}</h2>
        <button className="secondary" onClick={onResults}>
          {t("Ergebnis & Dateien", "Result & files")}
        </button>
      </div>
      <p>
        {t(
          "Browser, Editor und Terminal derselben Projektumgebung. Übernehmen pausiert diesen Auftrag; Agenten warten, bis du die Umgebung zurückgibst.",
          "Browser, editor and terminal of this project. Taking control pauses this task; agents wait until you hand the environment back.",
        )}
      </p>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {data?.environments.map((e: any) => (
        <article className="project-result-row" key={e.id}>
          <div>
            <strong>{e.name}</strong>
            <small>
              {e.template_id} · {e.status} ·{" "}
              {e.human_controlled
                ? t("Menschliche Steuerung", "Human control")
                : t(
                    "Agentenzugriff gemäß Freigaben",
                    "Agent access follows grants",
                  )}
            </small>
          </div>
          {data.canControl && (
            <div className="button-row">
              {!e.human_controlled ? (
                <button
                  disabled={busy || e.status !== "running"}
                  onClick={() => void control(e, "takeover")}
                >
                  {t("Pausieren & übernehmen", "Pause & take control")}
                </button>
              ) : (
                <>
                  <button disabled={busy} onClick={() => void open(e)}>
                    {t("Browser / Editor öffnen", "Open browser / editor")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void control(e, "release-resume")}
                  >
                    {t("Zurückgeben & fortsetzen", "Hand back & resume")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void control(e, "release")}
                  >
                    {t("Zurückgeben", "Hand back")}
                  </button>
                </>
              )}
            </div>
          )}
        </article>
      ))}
      {data && !data.environments.length && (
        <p>
          {t(
            "Keine Umgebung zugeordnet. Direkte Ergebnisdateien benötigen keinen zusätzlichen Computer.",
            "No environment assigned. Direct artifact delivery needs no additional computer.",
          )}
        </p>
      )}
      <RunProcesses runId={run.id} active={run.status === "running"} />
    </section>
  );
}
