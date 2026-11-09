import type { PoolClient } from "pg";
import type { DecisionBudget } from "../core/decision-answers.ts";
import { maximumRunTokens } from "../core/decision-answers.ts";
import { workspaceRole } from "./team.ts";
import { HttpError } from "./auth.ts";
import { audit } from "./db.ts";
export async function budgetDetails(
  c: PoolClient,
  runId: string,
  taskId: string,
  workspace: string,
  role: string,
  scope: "run" | "project",
): Promise<DecisionBudget> {
  const r = (
    await c.query(
      `SELECT r.token_limit,r.credit_limit,r.project_id,p.name AS project_name,p.token_limit AS project_tokens,p.credit_limit AS project_credits,w.ai_mode,
  coalesce((SELECT sum(CASE WHEN m.usage_known THEN m.tokens ELSE m.budget_tokens END) FROM model_calls m WHERE m.run_id=r.id AND m.workspace_id=r.workspace_id),0) AS spent_tokens,
  coalesce((SELECT sum(m.tokens) FILTER(WHERE m.usage_known) FROM model_calls m WHERE m.run_id=r.id AND m.workspace_id=r.workspace_id),0) AS measured_tokens,
  coalesce((SELECT sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END) FROM model_calls m WHERE m.run_id=r.id AND m.workspace_id=r.workspace_id),0) AS spent_credits,
  coalesce((SELECT sum(CASE WHEN m.usage_known THEN m.tokens ELSE m.budget_tokens END) FROM model_calls m JOIN runs other ON other.id=m.run_id AND other.workspace_id=m.workspace_id WHERE other.project_id=r.project_id AND other.id<>r.id AND other.workspace_id=r.workspace_id),0) AS other_tokens,
  coalesce((SELECT sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END) FROM model_calls m JOIN runs other ON other.id=m.run_id AND other.workspace_id=m.workspace_id WHERE other.project_id=r.project_id AND other.id<>r.id AND other.workspace_id=r.workspace_id),0) AS other_credits,
  (SELECT context_state->>'estimated_input_upper_bound' FROM tasks WHERE id=$2 AND run_id=r.id AND workspace_id=r.workspace_id) AS estimated_input
  FROM runs r JOIN workspaces w ON w.id=r.workspace_id JOIN workspace_projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id WHERE r.id=$1 AND r.workspace_id=$3`,
      [runId, taskId, workspace],
    )
  ).rows[0];
  if (!r) throw new HttpError(404, "Auftrag nicht gefunden.");
  const spent = Number(r.spent_tokens),
    input = Math.max(0, Number(r.estimated_input) || 0);
  return {
    scope,
    can_change: ["owner", "admin"].includes(role),
    can_control: role !== "viewer",
    token_limit: r.token_limit,
    credit_limit: r.credit_limit,
    spent_tokens: spent,
    measured_tokens: Number(r.measured_tokens),
    spent_credits: Number(r.spent_credits),
    minimum_token_limit: Math.max(1000, spent + input + 2048),
    max_token_limit: Math.max(
      0,
      Math.min(
        maximumRunTokens,
        Number(r.project_tokens) - Number(r.other_tokens),
      ),
    ),
    max_credit_limit: Math.max(
      0,
      Math.min(10000000, Number(r.project_credits) - Number(r.other_credits)),
    ),
    project_id: r.project_id,
    project_name: r.project_name,
    byok: r.ai_mode === "byok",
  };
}
export async function applyBudgetDecision(
  c: PoolClient,
  actor: string,
  workspace: string,
  r: any,
  task: any,
  d: any,
  b: any,
  requestHash: string,
  scope: "run" | "project",
) {
  const role = await workspaceRole(actor, workspace);
  if (
    role === "viewer" ||
    (b.choice === "budget_increase" && !["owner", "admin"].includes(role))
  )
    throw new HttpError(
      403,
      "Budgetänderungen sind nur für Workspace-Inhaber und Administratoren erlaubt.",
    );
  let content: string,
    limits: unknown = null;
  if (b.choice === "budget_increase") {
    if (scope !== "run")
      throw new HttpError(
        409,
        "Das Projektbudget muss in den Projekteinstellungen geändert werden.",
      );
    if (!b.confirm_budget_change || !b.budget)
      throw new HttpError(
        400,
        "Neue Limits und ausdrückliche Bestätigung erforderlich.",
      );
    if (
      b.budget.expected_token_limit !== r.token_limit ||
      b.budget.expected_credit_limit !== r.credit_limit
    )
      throw new HttpError(
        409,
        "Auftragslimits wurden inzwischen geändert. Ansicht aktualisieren und erneut prüfen.",
      );
    await c.query(
      "SELECT id FROM workspace_projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [r.project_id, workspace],
    );
    const current = await budgetDetails(
      c,
      r.id,
      task.id,
      workspace,
      role,
      scope,
    );
    if (
      b.budget.token_limit < r.token_limit ||
      b.budget.credit_limit < r.credit_limit ||
      (b.budget.token_limit === r.token_limit &&
        b.budget.credit_limit === r.credit_limit)
    )
      throw new HttpError(
        400,
        "Mindestens ein Limit muss erhöht werden; vorhandene Limits werden hier nicht verringert.",
      );
    if (b.budget.token_limit < current.minimum_token_limit)
      throw new HttpError(
        409,
        `Für Verbrauch, letzten Eingabekontext und eine Ausgabe werden mindestens ${current.minimum_token_limit} Tokens benötigt.`,
      );
    if (
      b.budget.token_limit > current.max_token_limit ||
      b.budget.credit_limit > current.max_credit_limit
    )
      throw new HttpError(
        409,
        "Das neue Auftragslimit überschreitet das verbleibende Projektbudget. Zuerst das Projektbudget prüfen.",
      );
    await c.query(
      "UPDATE runs SET token_limit=$2,credit_limit=$3,updated_at=now() WHERE id=$1",
      [r.id, b.budget.token_limit, b.budget.credit_limit],
    );
    limits = {
      token_limit: b.budget.token_limit,
      credit_limit: b.budget.credit_limit,
    };
    content = `Nutzer hat die festen Limits ausschließlich für diesen Auftrag ausdrücklich geändert: ${r.token_limit} → ${b.budget.token_limit} Tokens und ${r.credit_limit} → ${b.budget.credit_limit} Credits. Alle Projekt-, Plan-, Modell- und Werkzeuggrenzen gelten weiter. Bereits geprüfte Dateien nicht unnötig erneut lesen. Vorhandene Ergebnisse gezielt fertigstellen. ${b.message}`;
  } else {
    const action = b.choice === "budget_pause" ? "pause" : "cancel";
    const { changeRunInTransaction } = await import("./store.ts");
    await changeRunInTransaction(c, workspace, r.id, action);
    content = `Budgetentscheidung des Nutzers: Auftrag ${action === "pause" ? "pausiert" : "gestoppt"}, vorhandene Ergebnisse bleiben erhalten. ${b.message}`;
  }
  await c.query(
    "UPDATE decisions SET status='answered',response=$2,response_action=$3,response_data=$4,answered_by=$5,answered_at=now() WHERE id=$1",
    [
      d.id,
      content,
      b.choice,
      JSON.stringify({ request_hash: requestHash, limits }),
      actor,
    ],
  );
  await c.query(
    "UPDATE tasks SET status=$2,error=NULL,messages=$3,lease_token=NULL,lease_until=NULL,worker_id=NULL,loop_interventions=0,recovery_attempts=0 WHERE id=$1",
    [
      task.id,
      b.choice === "budget_stop" ? "canceled" : "queued",
      JSON.stringify([...task.messages, { role: "user", content }]),
    ],
  );
  await c.query(
    "INSERT INTO events(workspace_id,run_id,agent_id,kind,content) VALUES($1,$2,$3,'decision',$4)",
    [workspace, r.id, task.agent_id, content],
  );
  await c.query(
    "INSERT INTO chat_messages(workspace_id,run_id,author,content) VALUES($1,$2,'Du',$3)",
    [workspace, r.id, content],
  );
  await audit(c, actor, "decision." + b.choice, d.id);
  return {
    ok: true,
    budget_action: b.choice,
    limits,
    run_paused:
      b.choice === "budget_pause" ||
      (b.choice === "budget_increase" && r.status === "paused"),
  };
}
