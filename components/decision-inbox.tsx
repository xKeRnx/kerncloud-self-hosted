"use client";
import { BudgetDecision } from "./budget-decision";
import { StudioReviews } from "./content-research";
import type { DecisionBudget } from "@/src/core/decision-answers";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api-client";
import { useLanguage } from "./language";
import {
  Check,
  ShieldCheck,
  MessageSquare,
  KeyRound,
  X,
  RefreshCw,
} from "lucide-react";
type Item = {
  id: string;
  budget: DecisionBudget | null;
  answer_options: string[];
  kind: string;
  question: string;
  action: string;
  recipient: string;
  access_target: string;
  cost_note: string;
  status: string;
  response: string;
  title: string;
  agent_name: string;
  run_id: string;
  run_status: string;
  credit_limit: number | null;
  token_limit: number | null;
  tokens_used: number;
  usage_uncertain?: boolean;
  credit_used: number;
  created_at: string;
  expired: boolean;
  proposal: { tool: string; args: unknown } | null;
};
export function DecisionInbox({
  workspaceId,
  save,
}: {
  workspaceId: string;
  save: (path: string, body: unknown) => Promise<unknown>;
}) {
  const { t, localeTag } = useLanguage();
  const [items, setItems] = useState<Item[]>([]),
    [history, setHistory] = useState(false),
    [kind, setKind] = useState("all"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const value = await api<{ items: Item[] }>(
      `decisions${history ? "?history=1" : ""}`,
    );
    setItems(value.items);
  }, [workspaceId, history]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api<{ items: Item[] }>(`decisions${history ? "?history=1" : ""}`)
        .then((v) => {
          if (active) setItems(v.items);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [workspaceId, history]);
  const number = (n: number | null | undefined) =>
    n == null
      ? t("Nicht festgelegt", "Not set")
      : new Intl.NumberFormat(localeTag).format(n);
  const label = (value: string) =>
    ({
      information: t("Rückfrage", "Question"),
      access: t("Zugang fehlt", "Access needed"),
      approval: t("Freigabe", "Approval"),
      review: t("Prüfung nötig", "Review needed"),
      pending: t("Offen", "Pending"),
      approved: t("Freigegeben", "Approved"),
      denied: t("Abgelehnt", "Declined"),
      answered: t("Beantwortet", "Answered"),
      stale: t("Nicht mehr aktuell", "No longer current"),
    })[value] ?? value;
  const answerLabel = (value: string) =>
    ({
      "Bitte die Einrichtung Schritt für Schritt erklären.": t(
        value,
        "Explain the setup step by step.",
      ),
      "Einen erlaubten Weg ohne diesen Zugang versuchen.": t(
        value,
        "Try an allowed approach without this access.",
      ),
      "Mit den bereits verfügbaren Informationen weiterarbeiten.": t(
        value,
        "Continue with the information already available.",
      ),
      "Bitte Risiken und Kosten genauer erklären.": t(
        value,
        "Explain the risks and costs in more detail.",
      ),
      "Eine Alternative ohne diese Aktion vorschlagen.": t(
        value,
        "Suggest an alternative without this action.",
      ),
      "Den Umfang auf bereits freigegebene Aktionen begrenzen.": t(
        value,
        "Limit the scope to actions already approved.",
      ),
      "Bitte eine konkrete Empfehlung mit Begründung geben.": t(
        value,
        "Give a specific recommendation with reasons.",
      ),
      "Mit den vorhandenen Informationen weiterarbeiten; Unsicherheiten kennzeichnen.":
        t(value, "Continue with available information and flag uncertainties."),
      "Den Umfang reduzieren und vorhandene Ergebnisse prüfen.": t(
        value,
        "Reduce the scope and review existing results.",
      ),
    })[value] ?? value;
  const act = async (e: React.FormEvent<HTMLFormElement>, item: Item) => {
    e.preventDefault();
    const native = e.nativeEvent as SubmitEvent;
    const choice = (native.submitter as HTMLButtonElement)?.value || "answer";
    const form = new FormData(e.currentTarget);
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      await save("decisions/respond", {
        id: item.id,
        choice,
        message: String(form.get("message") ?? ""),
        accept_unknown_cost: form.get("accept_unknown_cost") === "on",
        ...(/^\d$/.test(String(form.get("answer_option") ?? ""))
          ? { option_index: Number(form.get("answer_option")) }
          : {}),
      });
      setNotice(
        t(
          "Entscheidung gespeichert. Der Agent kann im bisherigen Budget weiterarbeiten; pausierte Aufträge oder Agenten bleiben pausiert.",
          "Decision saved. The agent can continue within the existing budget; paused tasks or agents remain paused.",
        ),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {t("DEINE ENTSCHEIDUNGEN. EIN ORT.", "YOUR DECISIONS. ONE PLACE.")}
          </div>
          <h1>{t("Entscheidungs-Postfach", "Decision inbox")}</h1>
          <p>
            {t(
              "Rückfragen, fehlende Zugänge und konkrete Freigaben für diesen Workspace.",
              "Questions, missing access and specific approvals for this workspace.",
            )}
          </p>
        </div>
        <ShieldCheck size={28} />
      </div>
      <StudioReviews workspaceId={workspaceId} />
      <div className="panel inbox-toolbar">
        <label className="field">
          <span>{t("Typ", "Type")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("Alle Anfragen", "All requests")}</option>
            {["information", "access", "approval", "review"].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />
          {t(
            "Verlauf anzeigen (bis 200 Einträge)",
            "Show history (up to 200 entries)",
          )}
        </label>
        <button
          className="secondary"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={16} />
          {t("Aktualisieren", "Refresh")}
        </button>
      </div>
      <p className="form-note">
        {t(
          "Aktionsfreigaben gelten einmalig für die angezeigten Werkzeugparameter. Sie erweitern keine Rechte und kein Budget. Budgetänderungen benötigen konkrete neue Limits und eine eigene Bestätigung. Empfänger und Kostenhinweise stammen vom Agenten; prüfe die tatsächlichen Parameter. Externe Kosten sind nicht automatisch verifiziert.",
          "Action approvals apply once to the shown tool arguments. They do not expand permissions or budgets. Budget changes require explicit new limits and separate confirmation. Recipient and cost notes come from the agent; check the actual arguments. External costs are not automatically verified.",
        )}
      </p>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}
      <div className="inbox-list">
        {items
          .filter((i) => kind === "all" || i.kind === kind)
          .map((item) => (
            <article className="panel inbox-card" key={item.id}>
              <header>
                <span className="subtle-chip">
                  {item.kind === "access" ? (
                    <KeyRound size={14} />
                  ) : item.kind === "approval" ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <MessageSquare size={14} />
                  )}{" "}
                  {item.budget
                    ? t("Budgetentscheidung", "Budget decision")
                    : label(item.kind)}
                </span>
                <span>
                  {label(item.status)}
                  {item.expired
                    ? t(" · Freigabe abgelaufen", " · Approval expired")
                    : ""}{" "}
                  · {new Date(item.created_at).toLocaleString(localeTag)}
                </span>
              </header>
              <h2>
                {item.budget
                  ? t(
                      "Budget reicht für den nächsten Schritt nicht aus",
                      "Budget does not cover the next step",
                    )
                  : item.question}
              </h2>
              <p>
                {item.agent_name} ·{" "}
                <a href={`/tasks/${item.run_id}`}>{item.title}</a>
              </p>
              {!item.budget && (
                <dl className="inbox-details">
                  <div>
                    <dt>{t("Geplante Aktion", "Proposed action")}</dt>
                    <dd>
                      {item.action ||
                        t(
                          "Weitere Informationen oder Prüfung anfordern",
                          "Request more information or a review",
                        )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t(
                        "Empfänger / Ziel (Agentenangabe)",
                        "Recipient / target (agent supplied)",
                      )}
                    </dt>
                    <dd>
                      {item.recipient ||
                        t("Keine konkrete Angabe", "Not specified")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t(
                        "KI-Credits: verbraucht/reserviert / Limit",
                        "AI credits: spent/reserved / limit",
                      )}
                    </dt>
                    <dd>
                      {number(item.credit_used)} / {number(item.credit_limit)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t(
                        "Tokens: genutzt / Auftragslimit",
                        "Tokens: used / task limit",
                      )}
                    </dt>
                    <dd>
                      {number(item.tokens_used)} / {number(item.token_limit)}
                      {item.usage_uncertain && (
                        <small>
                          {t(
                            "Tokenverbrauch nicht vollständig gemeldet.",
                            "Token usage is not fully reported.",
                          )}
                        </small>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Externe Kosten", "External costs")}</dt>
                    <dd>
                      {item.proposal?.tool.startsWith("org_")
                        ? t(
                            "Interne Organisationsänderung; bestehende KI-Budgets gelten.",
                            "Internal organisation change; existing AI budgets apply.",
                          )
                        : t(
                            "Unbekannt / nicht verifiziert",
                            "Unknown / unverified",
                          )}
                      {item.cost_note && (
                        <small>
                          {t("Hinweis des Agenten: ", "Agent note: ")}
                          {item.cost_note}
                        </small>
                      )}
                    </dd>
                  </div>
                </dl>
              )}
              {item.proposal && (
                <details className="inbox-proposal">
                  <summary>
                    {t(
                      "Genaue Aktion und Parameter prüfen",
                      "Review exact action and arguments",
                    )}{" "}
                    · {item.proposal.tool}
                  </summary>
                  <pre>{JSON.stringify(item.proposal.args, null, 2)}</pre>
                </details>
              )}
              {item.kind === "access" && (
                <p className="form-note">
                  {t(
                    "Dieser Button erteilt keine Werkzeugrechte.",
                    "This button does not grant tool permissions.",
                  )}{" "}
                  {item.access_target && (
                    <a
                      href={
                        item.access_target === "profile"
                          ? "/profile"
                          : `/${item.access_target}`
                      }
                    >
                      {t("Einstellungen öffnen", "Open settings")} →
                    </a>
                  )}
                </p>
              )}
              {item.status === "pending" && item.budget ? (
                <BudgetDecision
                  key={
                    item.id +
                    ":" +
                    item.budget.token_limit +
                    ":" +
                    item.budget.credit_limit
                  }
                  id={item.id}
                  budget={item.budget}
                  save={save}
                  done={(message) => {
                    setNotice(message);
                    void load().catch((e) => setError(e.message));
                  }}
                />
              ) : item.status === "pending" ? (
                <form onSubmit={(e) => void act(e, item)}>
                  <fieldset className="decision-answer-options">
                    <legend>{t("Antwort wählen", "Choose a reply")}</legend>
                    {item.answer_options.map((option, index) => (
                      <label key={index}>
                        <input
                          type="radio"
                          name="answer_option"
                          value={index}
                        />
                        <span>{answerLabel(option)}</span>
                      </label>
                    ))}
                    <label>
                      <input type="radio" name="answer_option" value="other" />
                      <span>{t("Eigene Antwort", "Custom answer")}</span>
                    </label>
                  </fieldset>
                  <label className="field">
                    <span>
                      {t(
                        "Eigene Antwort oder Ergänzung",
                        "Custom answer or additional information",
                      )}
                    </span>
                    <textarea
                      name="message"
                      rows={3}
                      maxLength={12000}
                      disabled={busy === item.id}
                    />
                  </label>
                  {item.kind === "approval" &&
                    !item.proposal?.tool.startsWith("org_") && (
                      <label className="check-row">
                        <input
                          type="checkbox"
                          name="accept_unknown_cost"
                          disabled={busy === item.id}
                        />
                        {t(
                          "Ich habe die genaue Aktion geprüft und bestätige die Freigabe trotz nicht verifizierter externer Kosten.",
                          "I reviewed the exact action and approve it despite unverified external costs.",
                        )}
                      </label>
                    )}
                  <div className="button-row">
                    {item.kind === "approval" && (
                      <button
                        className="primary"
                        name="choice"
                        value="approve"
                        disabled={!!busy || item.expired}
                      >
                        <Check size={15} />
                        {t("Einmal freigeben", "Approve once")}
                      </button>
                    )}
                    {item.kind === "access" && (
                      <button
                        className="primary"
                        name="choice"
                        value="access_ready"
                        disabled={!!busy}
                      >
                        <KeyRound size={15} />
                        {t(
                          "Zugang eingerichtet – erneut prüfen",
                          "Access configured – check again",
                        )}
                      </button>
                    )}
                    <button
                      className="secondary"
                      name="choice"
                      value="answer"
                      disabled={!!busy}
                    >
                      <MessageSquare size={15} />
                      {t("Informationen senden", "Send information")}
                    </button>
                    <button
                      className="secondary"
                      name="choice"
                      value="deny"
                      disabled={!!busy}
                    >
                      <X size={15} />
                      {t("Ablehnen", "Decline")}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="form-note">
                  {item.response || label(item.status)}
                </p>
              )}
            </article>
          ))}
      </div>
      {!items.filter((i) => kind === "all" || i.kind === kind).length && (
        <section className="panel empty">
          <ShieldCheck size={30} />
          <h2>
            {t(
              "Hier wartet gerade nichts auf dich.",
              "Nothing needs your input here.",
            )}
          </h2>
          <p>
            {t(
              "Neue Anfragen deiner Agenten erscheinen hier automatisch.",
              "New requests from your agents appear here automatically.",
            )}
          </p>
        </section>
      )}
    </>
  );
}
