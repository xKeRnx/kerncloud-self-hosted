"use client";
import Link from "next/link";
import { useLanguage } from "./language";
export function TaskWorkflow({
  run,
  tasks,
  events,
  agents,
  files,
}: {
  run: any;
  tasks: any[];
  events: any[];
  agents: any[];
  files: number;
}) {
  const { t, date } = useLanguage();
  const blocker = tasks.find((x) => x.status === "input_required"),
    active = tasks.find((x) => x.status === "running"),
    last = events.find((x) => x.run_id === run.id);
  const current = blocker ?? active;
  return (
    <section
      className={"panel task-workflow" + (blocker ? " needs-attention" : "")}
    >
      <div>
        <span className="scope-label">
          {blocker
            ? t("BRAUCHT DICH", "NEEDS YOU")
            : run.status === "completed"
              ? t("ERGEBNIS BEREIT", "RESULT READY")
              : t("AKTUELLER STAND", "CURRENT STATUS")}
        </span>
        <h2>
          {blocker
            ? t("Deine Rückmeldung wird benötigt", "Your input is needed")
            : run.status === "completed"
              ? t("Auftrag abgeschlossen", "Task completed")
              : run.status === "paused"
                ? t("Auftrag ist pausiert", "Task is paused")
                : run.status === "failed"
                  ? t(
                      "Auftrag konnte nicht abgeschlossen werden",
                      "Task could not be completed",
                    )
                  : run.status === "canceled"
                    ? t("Auftrag wurde gestoppt", "Task was stopped")
                    : active
                      ? t(
                          "Dein Team arbeitet am Auftrag",
                          "Your team is working on the task",
                        )
                      : t(
                          "Wartet auf den nächsten Arbeitsschritt",
                          "Waiting for the next step",
                        )}
        </h2>
        {current && (
          <p>
            <b>{agents.find((a) => a.id === current.agent_id)?.name}</b> ·{" "}
            {current.title.slice(0, 200)}
          </p>
        )}
        {blocker?.error && <p className="warning-text">{blocker.error}</p>}
        <small>
          {last
            ? t("Letzte Aktivität: ", "Last activity: ") + date(last.created_at)
            : t(
                "Noch keine Aktivität protokolliert.",
                "No activity recorded yet.",
              )}{" "}
          · {files} {t("Ergebnisdateien", "result files")}
        </small>
      </div>
      <div className="button-row">
        {blocker && (
          <Link className="button primary" href="/decisions">
            {t("Im Postfach beantworten", "Reply in inbox")} →
          </Link>
        )}
        {current && (
          <Link
            className="button secondary"
            href={"/agents/" + current.agent_id + "?task=" + current.id}
          >
            {t("Agenteneinblick", "Inspect agent")} →
          </Link>
        )}
      </div>
    </section>
  );
}
