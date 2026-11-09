"use client";
import { useState, type FormEvent } from "react";
import { useLanguage } from "./language";
import {
  requestedTokens,
  type DecisionBudget,
} from "@/src/core/decision-answers";
export function BudgetDecision({
  id,
  budget,
  save,
  done,
}: {
  id: string;
  budget: DecisionBudget;
  save: (path: string, body: unknown) => Promise<unknown>;
  done: (notice: string) => void;
}) {
  const { t, number } = useLanguage();
  const [choice, setChoice] = useState(""),
    [tokens, setTokens] = useState(
      String(
        Math.min(
          budget.max_token_limit,
          Math.max(budget.token_limit * 2, budget.minimum_token_limit),
        ),
      ),
    ),
    [credits, setCredits] = useState(String(budget.credit_limit)),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const increase = choice === "budget_increase" || choice === "other";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!choice) {
      setError(t("Bitte eine Aktion auswählen.", "Choose an action."));
      return;
    }
    if (choice === "other" && requestedTokens(message) === null) {
      setError(
        t(
          "Bitte ein konkretes Tokenlimit nennen, z. B. „Limit auf 100 Mio. Tokens“. Prüfe anschließend die Zahl und bestätige die Änderung.",
          "Specify a token limit, e.g. “Set limit to 100 million tokens”. Then review the number and confirm the change.",
        ),
      );
      return;
    }
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const result = (await save("decisions/respond", {
        id,
        choice: increase ? "budget_increase" : choice,
        message,
        confirm_budget_change:
          increase && form.get("confirm_budget_change") === "on",
        ...(increase
          ? {
              budget: {
                token_limit: Number(tokens),
                credit_limit: Number(credits),
                expected_token_limit: budget.token_limit,
                expected_credit_limit: budget.credit_limit,
              },
            }
          : {}),
      })) as { run_paused?: boolean };
      done(
        increase
          ? t(
              `Auftragslimit gespeichert: ${number(Number(tokens))} Tokens und ${number(Number(credits))} Credits. ${result.run_paused ? "Der Auftrag bleibt pausiert." : "Der Agent kann innerhalb dieser Grenzen weiterarbeiten."}`,
              `Task limits saved: ${number(Number(tokens))} tokens and ${number(Number(credits))} credits. ${result.run_paused ? "The task remains paused." : "The agent can continue within these limits."}`,
            )
          : choice === "budget_pause"
            ? t(
                "Auftrag pausiert. Ergebnisse und Limits bleiben erhalten.",
                "Task paused. Results and limits are preserved.",
              )
            : t(
                "Auftrag gestoppt. Ergebnisse bleiben erhalten.",
                "Task stopped. Results are preserved.",
              ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="budget-decision-form">
      <p className="form-note">
        {t(
          "Dies ist eine Budgetblockade. Eine Textantwort allein verändert keine Limits und startet den Auftrag nicht erneut.",
          "This is a budget block. A text reply alone does not change limits or restart the task.",
        )}
      </p>
      <dl className="inbox-details">
        <div>
          <dt>{t("Projekt", "Project")}</dt>
          <dd>{budget.project_name}</dd>
        </div>
        <div>
          <dt>
            {t(
              "Credits verbraucht / reserviert / Limit",
              "Credits used / reserved / limit",
            )}
          </dt>
          <dd>
            {number(budget.spent_credits)} / {number(budget.credit_limit)}
          </dd>
        </div>
        <div>
          <dt>
            {t("Tokens verbraucht / reserviert", "Tokens used / reserved")}
          </dt>
          <dd>
            {number(budget.spent_tokens)} / {number(budget.token_limit)}
          </dd>
        </div>
        <div>
          <dt>
            {t(
              "Höchstes Auftragslimit im verbleibenden Projektbudget",
              "Maximum task limit within remaining project budget",
            )}
          </dt>
          <dd>{number(budget.max_token_limit)} Tokens</dd>
        </div>
      </dl>
      {budget.scope === "project" && (
        <p className="form-note">
          {t(
            "Hier blockiert das Projektbudget. Ein höheres Auftragslimit allein hilft nicht.",
            "The project budget is blocking this task. Raising only the task limit will not resolve it.",
          )}{" "}
          <a href={`/projects/${budget.project_id}`}>
            {t("Projektbudget verwalten", "Manage project budget")}
          </a>
        </p>
      )}
      <fieldset className="decision-answer-options">
        <legend>
          {t("Wie soll es weitergehen?", "How should we proceed?")}
        </legend>
        <label>
          <input
            type="radio"
            name="budget_choice"
            value="budget_increase"
            checked={choice === "budget_increase"}
            disabled={!budget.can_change || budget.scope !== "run"}
            onChange={() => {
              setChoice("budget_increase");
              setConfirmed(false);
            }}
          />
          <span>
            <b>{t("Auftragslimit ändern", "Change task limits")}</b>
            <small>
              {t(
                "Neue Zahlen prüfen und ausdrücklich bestätigen.",
                "Review the new numbers and explicitly confirm.",
              )}
            </small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="budget_choice"
            value="budget_pause"
            checked={choice === "budget_pause"}
            disabled={!budget.can_control}
            onChange={() => {
              setChoice("budget_pause");
              setConfirmed(false);
            }}
          />
          <span>
            <b>{t("Auftrag pausieren", "Pause task")}</b>
            <small>
              {t(
                "Kein neuer Modellschritt, bis du den Auftrag fortsetzt.",
                "No new model step until you resume the task.",
              )}
            </small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="budget_choice"
            value="budget_stop"
            checked={choice === "budget_stop"}
            disabled={!budget.can_control}
            onChange={() => {
              setChoice("budget_stop");
              setConfirmed(false);
            }}
          />
          <span>
            <b>
              {t("Stoppen und Ergebnisse behalten", "Stop and keep results")}
            </b>
            <small>
              {t(
                "Alle offenen Teilaufgaben dieses Auftrags beenden.",
                "End all unfinished subtasks of this task.",
              )}
            </small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="budget_choice"
            value="other"
            checked={choice === "other"}
            disabled={!budget.can_change || budget.scope !== "run"}
            onChange={() => {
              setChoice("other");
              setConfirmed(false);
            }}
          />
          <span>
            <b>
              {t(
                "Eigene Antwort / anderes Limit",
                "Custom answer / different limit",
              )}
            </b>
            <small>
              {t(
                "Zum Beispiel: „Limit auf 100 Mio. Tokens erhöhen“.",
                "For example: “Raise the limit to 100 million tokens”.",
              )}
            </small>
          </span>
        </label>
      </fieldset>
      {(!budget.can_change || !budget.can_control) && (
        <p className="muted">
          {t(
            "Nur Workspace-Inhaber und Administratoren können Budgets erhöhen.",
            "Only workspace owners and admins can raise budgets.",
          )}
        </p>
      )}
      <label className="field">
        <span>
          {choice === "other"
            ? t(
                "Eigene Antwort mit gewünschtem Tokenlimit",
                "Custom answer with the requested token limit",
              )
            : t(
                "Zusätzlicher Hinweis (optional)",
                "Additional note (optional)",
              )}
        </span>
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setConfirmed(false);
            if (choice === "other") {
              const amount = requestedTokens(e.target.value);
              if (amount !== null) setTokens(String(amount));
            }
          }}
          maxLength={12000}
          rows={3}
          disabled={busy}
        />
      </label>
      {increase && (
        <>
          <div className="decision-budget-fields">
            <label className="field">
              <span>
                {t("Neues gesamtes Tokenlimit", "New total token limit")}
              </span>
              <input
                type="number"
                min={Math.max(budget.token_limit, budget.minimum_token_limit)}
                max={budget.max_token_limit}
                step="1"
                required
                value={tokens}
                onChange={(e) => {
                  setTokens(e.target.value);
                  setConfirmed(false);
                }}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>
                {t("Neues gesamtes Creditlimit", "New total credit limit")}
              </span>
              <input
                type="number"
                min={budget.credit_limit}
                max={budget.max_credit_limit}
                step="1"
                required
                value={credits}
                onChange={(e) => {
                  setCredits(e.target.value);
                  setConfirmed(false);
                }}
                disabled={busy}
              />
            </label>
          </div>
          <p className="form-note">
            {t("Nur dieser Auftrag:", "This task only:")}{" "}
            <b>
              {number(budget.token_limit)} → {number(Number(tokens))} Tokens
            </b>{" "}
            ·{" "}
            <b>
              {number(budget.credit_limit)} → {number(Number(credits))} Credits
            </b>
            .{" "}
            {t(
              "Projektbudgets, Guthaben, Modellgrenzen und neue Aufträge bleiben unverändert.",
              "Project budgets, balance, model limits and new tasks remain unchanged.",
            )}{" "}
            {budget.byok
              ? t(
                  "BYOK-Verbrauch wird weiterhin direkt vom Anbieter abgerechnet.",
                  "BYOK usage continues to be billed directly by the provider.",
                )
              : ""}
          </p>
          <label className="check-row">
            <input
              name="confirm_budget_change"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              type="checkbox"
              required
              disabled={busy}
            />
            {t(
              "Ich bestätige diese höheren Limits und den dadurch möglichen zusätzlichen KI-Verbrauch.",
              "I confirm these higher limits and the possible additional AI usage.",
            )}
          </label>
        </>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          className={choice === "budget_stop" ? "danger" : "primary"}
          disabled={busy || !choice}
        >
          {busy
            ? t("Wird gespeichert …", "Saving …")
            : increase
              ? t("Limit verbindlich speichern", "Confirm and save limits")
              : choice === "budget_stop"
                ? t("Auftrag stoppen", "Stop task")
                : t("Auftrag pausieren", "Pause task")}
        </button>
        <a className="secondary" href={`/projects/${budget.project_id}`}>
          {t("Projekt öffnen", "Open project")}
        </a>
      </div>
    </form>
  );
}
