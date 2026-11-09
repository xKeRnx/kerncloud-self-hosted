"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "./api-client";
import { RunAttachments } from "./materials-panel";
import { useLanguage } from "./language";
export function NewTaskForm({
  state,
  cancel,
  created,
}: {
  state: any;
  cancel: () => void;
  created: (id: string) => void;
}) {
  const { t, number } = useLanguage();
  const [project, setProject] = useState(
      state.projects.find(
        (p: any) =>
          p.id === state.workspace.project_id && p.status === "active",
      )?.id ??
        state.projects.find((p: any) => p.status === "active")?.id ??
        "",
    ),
    [draftTitle, setDraftTitle] = useState(""),
    [draftGoal, setDraftGoal] = useState(""),
    [draftResult, setDraftResult] = useState(""),
    [draftTokens, setDraftTokens] = useState(
      String(state.workspace.run_token_limit ?? 100000),
    ),
    [draftCredits, setDraftCredits] = useState(
      String(state.workspace.run_credit_limit ?? 10000),
    ),
    [scope, setScope] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setScope(null);
    setError("");
    void api(
      "state?view=tasks&projectId=" + encodeURIComponent(project),
      undefined,
      "GET",
      { projectScope: false },
    )
      .then((s) => {
        if (live) setScope(s);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [project, state.workspace.id]);
  const maxTokens =
      scope?.workspace.run_token_limit ??
      state.workspace.run_token_limit ??
      100000,
    maxCredits =
      scope?.workspace.run_credit_limit ??
      state.workspace.run_credit_limit ??
      10000;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!scope) return;
    const f = new FormData(e.currentTarget);
    const goal = String(f.get("goal")).trim(),
      title = String(f.get("title") ?? "").trim(),
      result = String(f.get("result") ?? "").trim();
    const prompt =
      (title ? title + "\n\n" : "") +
      goal +
      (result
        ? "\n\n" +
          t("Gewünschtes Ergebnis:", "Expected result:") +
          "\n" +
          result
        : "");
    if (prompt.length > 20000) {
      setError(
        t(
          "Beschreibung und gewünschtes Ergebnis sind zusammen zu lang (max. 20.000 Zeichen).",
          "Description and expected result exceed 20,000 characters.",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api(
        "runs",
        {
          goal: prompt,
          projectId: project,
          agentId: f.get("agentId"),
          attachmentIds: f.getAll("attachments"),
          tokenLimit: Number(f.get("tokens")),
          creditLimit: Number(f.get("credits")),
        },
        "POST",
        { projectId: project },
      );
      created(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="new-task-form">
      <p className="muted">
        {t(
          "Ziel beschreiben, Projekt und Budget prüfen, dann starten.",
          "Describe the goal, review the project and budget, then start.",
        )}
      </p>
      <label className="field">
        <span>{t("Projekt dieses Auftrags", "Project for this task")}</span>
        <select
          value={project}
          disabled={busy}
          onChange={(e) => setProject(e.target.value)}
        >
          {state.projects
            .filter((p: any) => p.status === "active")
            .map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      {scope ? (
        <div key={project} className="new-task-fields">
          <label className="field">
            <span>
              {t("Kurzer Titel (optional)", "Short title (optional)")}
            </span>
            <input
              name="title"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              maxLength={120}
              placeholder={t(
                "Zum Beispiel: Website für mein Café",
                "For example: Website for my café",
              )}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>
              {t(
                "Was soll dein Team erreichen?",
                "What should your team achieve?",
              )}
            </span>
            <textarea
              name="goal"
              value={draftGoal}
              onChange={(e) => setDraftGoal(e.target.value)}
              minLength={5}
              maxLength={20000}
              rows={4}
              required
              autoFocus
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>
              {t(
                "Was möchtest du erhalten? (optional)",
                "What would you like delivered? (optional)",
              )}
            </span>
            <textarea
              name="result"
              value={draftResult}
              onChange={(e) => setDraftResult(e.target.value)}
              maxLength={4000}
              rows={2}
              placeholder={t(
                "Zum Beispiel: Website mit Vorschau und ZIP-Datei",
                "For example: A website with preview and ZIP download",
              )}
              disabled={busy}
            />
          </label>
          <section className="task-budget-preview">
            <h3>
              {t(
                "Festes Budget für diesen Auftrag",
                "Fixed budget for this task",
              )}
            </h3>
            <div className="form-grid">
              <label className="field">
                <span>{t("Tokenlimit insgesamt", "Total token limit")}</span>
                <input
                  name="tokens"
                  type="number"
                  min={1000}
                  max={maxTokens}
                  step={1}
                  value={draftTokens}
                  onChange={(e) => setDraftTokens(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>{t("Creditlimit insgesamt", "Total credit limit")}</span>
                <input
                  name="credits"
                  type="number"
                  min={0}
                  max={maxCredits}
                  step={1}
                  value={draftCredits}
                  onChange={(e) => setDraftCredits(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            </div>
            <p>
              {t(
                "Eingabe, Ausgabe und alle beteiligten Agenten zählen gemeinsam. Maximal die Workspace-Standardlimits:",
                "Input, output and all participating agents count together. At most the workspace defaults:",
              )}{" "}
              {number(maxTokens)} Tokens · {number(maxCredits)} Credits.{" "}
              <Link href="/settings/budgets" target="_blank">
                {t("Standards verwalten", "Manage defaults")} ↗
              </Link>
            </p>
            <small>
              {scope.workspace.ai_mode === "byok"
                ? t(
                    "Eigener KI-Anbieter: Kosten entstehen dort separat; Tokenlimits sind kein Euro-Kostenlimit.",
                    "Your AI provider bills separately; token limits are not a monetary cap.",
                  )
                : t(
                    "KeRnCloud-Nutzung wird nach dem gewählten Modell in Credits abgerechnet.",
                    "KeRnCloud usage is billed in credits according to the selected model.",
                  )}
            </small>
          </section>
          <RunAttachments
            initial={scope.attachments}
            save={(path: string, body: unknown, method?: string) =>
              api(path, body, method ?? "POST", { projectId: project })
            }
          />
          <details className="task-advanced">
            <summary>
              {t(
                "Verantwortlicher Agent & technische Grenzen",
                "Responsible agent & technical limits",
              )}
            </summary>
            <label className="field">
              <span>{t("Verantwortlicher Agent", "Responsible agent")}</span>
              <select name="agentId" disabled={busy}>
                {scope.agents.map((a: any) => (
                  <option value={a.id} key={a.id}>
                    {a.name} · {a.role}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {scope.plan.max_steps}{" "}
              {t(
                "Modellaufrufe maximal. Agenten verwenden ihre freigegebenen Modelle und Werkzeuge.",
                "maximum model calls. Agents use their approved models and tools.",
              )}
            </p>
          </details>
          {!scope.agents.length && (
            <p className="error-box">
              {t(
                "Für dieses Projekt ist noch kein Agent zugelassen. Bitte die Projekteinstellungen prüfen.",
                "No agent is allowed in this project. Check project settings.",
              )}
            </p>
          )}
        </div>
      ) : (
        <p role="status">
          {t(
            "Projektdateien und Agenten werden geladen …",
            "Loading project files and agents …",
          )}
        </p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button
          type="button"
          className="secondary"
          onClick={cancel}
          disabled={busy}
        >
          {t("Abbrechen", "Cancel")}
        </button>
        <button className="primary" disabled={busy || !scope?.agents.length}>
          {busy
            ? t("Wird gestartet …", "Starting …")
            : t("Mit diesem Budget starten", "Start with this budget")}
        </button>
      </footer>
    </form>
  );
}
