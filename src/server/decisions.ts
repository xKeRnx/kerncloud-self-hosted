import { bridgeTarget } from "./bridge.ts";
import { bridgeAction, bridgeNeedsApproval } from "../core/bridge.ts";
import {
  hiringTarget,
  createHire,
  restructureTarget,
  applyRestructure,
} from "./organisation.ts";
import {
  budgetDecisionScope,
  fallbackAnswers,
  maximumRunTokens,
} from "../core/decision-answers.ts";
import { workspaceRole } from "./team.ts";
import { budgetDetails, applyBudgetDecision } from "./decision-budgets.ts";
import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction, pool, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { encrypt, decrypt, redact } from "./security.ts";
import { toolArgumentsHash } from "../core/agent-loops.ts";

type Mapping = Record<string, { connectionId: string; toolName: string }>;
type Task = {
  id: string;
  workspace_id: string;
  run_id: string;
  agent_id: string;
};
const clean = (s: string) => redact(s).slice(0, 12000);
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const decisionInput = z.object({
  question: z.string().trim().min(1).max(10000),
  options: z.array(z.string().trim().min(1).max(1000)).max(3).default([]),
  kind: z
    .enum(["information", "access", "approval", "review"])
    .default("information"),
  action: z.string().trim().max(2000).default(""),
  recipient: z.string().trim().max(1000).default(""),
  access_target: z
    .enum(["", "models", "mcp", "environments", "profile"])
    .default(""),
  cost_note: z.string().max(2000).default(""),
  proposal: z
    .object({ tool: z.string().min(1).max(200), args: z.record(z.unknown()) })
    .optional(),
});
async function target(
  c: PoolClient,
  task: Task,
  name: string,
  args: any,
  mapping: Mapping,
) {
  if (name === "bridge_action") {
    const t = await bridgeTarget(c, task, args);
    if (!bridgeNeedsApproval(t.input))
      throw new HttpError(400, "Leseaktion benötigt keine Freigabe.");
    return { key: t.key, scope: t.scope, destination: t.destination };
  }
  if (name === "org_hire" || name === "org_restructure") {
    const t =
      name === "org_hire"
        ? await hiringTarget(c, task, args)
        : await restructureTarget(c, task, args);
    return { key: t.key, scope: t.scope, destination: t.destination };
  }
  if (name === "app_action") {
    const b = (await import("../core/work-apps.ts")).appActionInput.parse(args);
    if (!(await import("../core/work-apps.ts")).appWrites(b.operation))
      throw new HttpError(400, "Read actions do not need approval");
    const row = (
      await c.query(
        "SELECT * FROM work_app_connections WHERE id=$1 AND workspace_id=$2 AND enabled AND write_enabled AND agent_ids ? $3",
        [b.connection_id, task.workspace_id, task.agent_id],
      )
    ).rows[0];
    if (!row) throw new HttpError(403, "Work app write permission unavailable");
    return {
      key: "app:" + row.id + ":" + b.operation,
      scope: digest([row.id, row.provider, row.revision]),
      destination: row.name + " / " + b.operation,
    };
  }
  if (name.startsWith("mcp_")) {
    const spec = mapping[name];
    if (!spec) throw new HttpError(403, "Unbekanntes MCP-Werkzeug.");
    const row = (
      await c.query(
        "SELECT co.id,co.url,co.name,co.secret,co.allowed_tools,co.enabled,a.mcp_ids FROM connections co JOIN agents a ON a.workspace_id=co.workspace_id WHERE co.id=$1 AND co.workspace_id=$2 AND a.id=$3",
        [spec.connectionId, task.workspace_id, task.agent_id],
      )
    ).rows[0];
    if (
      !row?.enabled ||
      !row.mcp_ids.includes(row.id) ||
      !row.allowed_tools.includes(spec.toolName)
    )
      throw new HttpError(403, "MCP-Werkzeug nicht freigegeben.");
    return {
      key: `mcp:${row.id}:${spec.toolName}`,
      scope: digest([row.id, row.url, row.secret, spec.toolName]),
      destination: `${row.name} / ${spec.toolName}`,
    };
  }
  if (
    ![
      "environment_command",
      "environment_browser",
      "environment_write_file",
    ].includes(name)
  )
    throw new HttpError(
      400,
      "Freigaben sind nur für konkrete Container- oder MCP-Aktionen möglich.",
    );
  if (!args || typeof args !== "object")
    throw new HttpError(400, "Werkzeugparameter müssen ein Objekt sein.");
  const id = args.environment_id;
  const e = (
    await c.query(
      "SELECT id,name,generation,endpoint,agent_permissions,agent_ids FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND status<>'deleted'",
      [id, task.workspace_id],
    )
  ).rows[0];
  if (!e) throw new HttpError(404, "Umgebung fehlt in diesem Workspace.");
  return {
    key: `${name}:${e.id}`,
    scope: digest([e.id, e.generation, e.endpoint]),
    destination: e.name,
  };
}

export async function createDecision(
  c: PoolClient,
  task: Task,
  args: unknown,
  requestKey: string,
  mapping: Mapping = {},
) {
  const b = decisionInput.parse(args);
  let bound: Awaited<ReturnType<typeof target>> | undefined;
  if (b.kind === "approval") {
    if (!b.proposal || !b.action.trim())
      throw new HttpError(
        400,
        "Freigabe benötigt eine konkrete Aktion und Werkzeugparameter.",
      );
    if (JSON.stringify(b.proposal).length > 24000)
      throw new HttpError(400, "Aktionsvorschau zu groß.");
    // Approval payloads must never become a channel for credentials in chat or logs.
    if (
      /"(?:password|secret|api[_-]?key|authorization|access[_-]?token|token|credential)"\s*:/i.test(
        JSON.stringify(b.proposal),
      ) ||
      /[?&](?:token|key|secret|password|auth|access_token)=/i.test(
        JSON.stringify(b.proposal),
      ) ||
      redact(JSON.stringify(b.proposal)) !== JSON.stringify(b.proposal)
    )
      throw new HttpError(
        400,
        "Keine Zugangsdaten in Freigaben hinterlegen. Einstellungen verwenden.",
      );
    bound = await target(c, task, b.proposal.tool, b.proposal.args, mapping);
    const denied = await c.query(
      "SELECT id FROM decisions WHERE run_id=$1 AND tool_key=$2 AND arguments_hash=$3 AND status='denied'",
      [task.run_id, bound.key, toolArgumentsHash(b.proposal.args)],
    );
    if (denied.rowCount)
      throw new HttpError(
        403,
        "Diese Aktion wurde abgelehnt. Einen anderen erlaubten Ansatz wählen.",
      );
  } else if (b.proposal)
    throw new HttpError(
      400,
      "Werkzeugvorschläge benötigen eine ausdrückliche Freigabeanfrage.",
    );
  await c.query(
    "UPDATE decisions SET status='stale' WHERE task_id=$1 AND status='pending' AND request_key<>$2",
    [task.id, requestKey],
  );
  const id = randomUUID();
  await c.query(
    `INSERT INTO decisions(id,workspace_id,run_id,task_id,kind,question,action,recipient,access_target,cost_note,tool_key,arguments_hash,scope_hash,proposal_cipher,request_key,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $5='approval' THEN now()+interval '24 hours' ELSE NULL END) ON CONFLICT DO NOTHING`,
    [
      id,
      task.workspace_id,
      task.run_id,
      task.id,
      b.kind,
      clean(b.question),
      clean(b.action),
      clean(b.recipient) || bound?.destination || "",
      b.access_target,
      clean(b.cost_note),
      bound?.key ?? null,
      b.proposal ? toolArgumentsHash(b.proposal.args) : null,
      bound?.scope ?? null,
      b.proposal ? encrypt(JSON.stringify(b.proposal)) : null,
      requestKey,
    ],
  );
  await c.query("UPDATE decisions SET answer_options=$2 WHERE id=$1", [
    id,
    JSON.stringify(b.options.map(clean)),
  ]);
  return id;
}

// Once an action is presented for approval, changing parameters or reusing it under
// another call ID requires a new approval. Current tool permissions still apply.
export async function decisionConsent(
  c: PoolClient,
  task: Task,
  name: string,
  args: unknown,
  operation: string,
  mapping: Mapping,
) {
  if (
    name === "bridge_action" &&
    !bridgeNeedsApproval(bridgeAction.parse(args))
  )
    return;
  if (
    name === "app_action" &&
    !(await import("../core/work-apps.ts")).appWrites((args as any)?.operation)
  )
    return;
  if (
    name !== "app_action" &&
    name !== "bridge_action" &&
    !name.startsWith("mcp_") &&
    ![
      "environment_command",
      "environment_browser",
      "environment_write_file",
    ].includes(name)
  )
    return;
  if (
    !(
      await c.query(
        "SELECT 1 FROM decisions WHERE run_id=$1 AND tool_key IS NOT NULL LIMIT 1",
        [task.run_id],
      )
    ).rowCount
  ) {
    if (name === "app_action" || name === "bridge_action")
      throw new HttpError(
        403,
        "Request exact approval using request_input before external writes",
      );
    return;
  }
  const b = await target(c, task, name, args, mapping);
  const related = (
    await c.query(
      "SELECT status,task_id FROM decisions WHERE run_id=$1 AND tool_key=$2 AND arguments_hash=$3",
      [task.run_id, b.key, toolArgumentsHash(args)],
    )
  ).rows;
  if (related.some((d) => d.status === "denied"))
    throw new HttpError(403, "Diese genaue Aktion wurde im Auftrag abgelehnt.");
  const row = (
    await c.query(
      "SELECT * FROM decisions WHERE task_id=$1 AND tool_key=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [task.id, b.key],
    )
  ).rows[0];
  if (!row) {
    if (name === "app_action" || name === "bridge_action")
      throw new HttpError(
        403,
        "Exact approval required for this external write",
      );
    if (related.length)
      throw new HttpError(
        403,
        "Diese Aktion benötigt eine eigene Freigabe für die anfragende Aufgabe.",
      );
    return;
  } // Existing assigned capabilities are retained; this gates requested one-off approvals.
  if (
    row.status !== "approved" ||
    row.arguments_hash !== toolArgumentsHash(args) ||
    row.scope_hash !== b.scope ||
    Date.parse(row.expires_at) <= Date.now() ||
    (row.consumed_operation && row.consumed_operation !== operation)
  )
    throw new HttpError(
      403,
      "Keine gültige einmalige Freigabe für diese genaue Aktion. Neue Freigabe anfragen oder erlaubte Alternative wählen.",
    );
  await c.query("UPDATE decisions SET consumed_operation=$2 WHERE id=$1", [
    row.id,
    operation,
  ]);
}

async function synchronize(c: PoolClient, workspace: string) {
  // Lock in the same order as workers and user responses: run, then task, then decision.
  const refs = (
    await c.query(
      `SELECT t.id,t.run_id FROM tasks t JOIN runs r ON r.id=t.run_id WHERE t.workspace_id=$1 AND t.status='input_required' AND r.status NOT IN('completed','failed','canceled') AND NOT EXISTS(SELECT 1 FROM decisions d WHERE d.task_id=t.id AND d.status='pending') ORDER BY t.run_id,t.id LIMIT 200`,
      [workspace],
    )
  ).rows;
  for (const ref of refs) {
    const run = (
      await c.query(
        "SELECT status FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [ref.run_id, workspace],
      )
    ).rows[0];
    const task = (
      await c.query(
        "SELECT * FROM tasks WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [ref.id, workspace],
      )
    ).rows[0];
    if (
      !task ||
      task.status !== "input_required" ||
      ["completed", "failed", "canceled"].includes(run?.status)
    )
      continue;
    if (
      (
        await c.query(
          "SELECT 1 FROM decisions WHERE task_id=$1 AND status='pending'",
          [task.id],
        )
      ).rowCount
    )
      continue;
    await createDecision(
      c,
      task,
      {
        kind: "review",
        question: task.error || "Arbeitsstand und Voraussetzungen prüfen.",
      },
      `legacy:${task.id}:${task.attempts}:${digest(task.error)}`,
    );
  }
}

export async function listDecisions(
  workspace: string,
  history = false,
  actor?: string,
) {
  return transaction(async (c) => {
    await synchronize(c, workspace);
    const rows = (
      await c.query(
        `SELECT d.*,t.title,t.status AS task_status,a.name AS agent_name,r.goal,r.status AS run_status,r.credit_limit,r.token_limit,r.tokens_used,EXISTS(SELECT 1 FROM model_calls m WHERE m.run_id=r.id AND NOT m.usage_known) AS usage_uncertain,
   (SELECT coalesce(sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END),0)::int FROM model_calls m WHERE m.run_id=r.id) AS credit_used
   FROM decisions d JOIN tasks t ON t.id=d.task_id JOIN runs r ON r.id=d.run_id LEFT JOIN agents a ON a.id=t.agent_id
   WHERE d.workspace_id=$1 ${history ? "" : "AND d.status='pending' AND t.status='input_required' AND r.status NOT IN('completed','failed','canceled')"} ORDER BY d.created_at DESC LIMIT 200`,
        [workspace],
      )
    ).rows;
    const role = actor ? await workspaceRole(actor, workspace) : "viewer";
    return Promise.all(
      rows.map(
        async ({
          proposal_cipher,
          scope_hash,
          request_key,
          response_data,
          ...row
        }) => ({
          budget:
            row.kind === "review" &&
            !proposal_cipher &&
            budgetDecisionScope(row.question)
              ? await budgetDetails(
                  c,
                  row.run_id,
                  row.task_id,
                  workspace,
                  role,
                  budgetDecisionScope(row.question)!,
                )
              : null,
          ...row,
          answer_options: row.answer_options.length
            ? row.answer_options
            : fallbackAnswers(row.kind),
          status:
            row.status === "pending" &&
            (row.task_status !== "input_required" ||
              ["completed", "failed", "canceled"].includes(row.run_status))
              ? "stale"
              : row.status,
          proposal: proposal_cipher
            ? JSON.parse(decrypt(proposal_cipher))
            : null,
          expired: !!row.expires_at && Date.parse(row.expires_at) <= Date.now(),
        }),
      ),
    );
  });
}

export async function respondDecision(
  actor: string,
  workspace: string,
  body: unknown,
) {
  const b = z
    .object({
      id: z.string().uuid(),
      choice: z.enum([
        "approve",
        "deny",
        "answer",
        "access_ready",
        "budget_increase",
        "budget_pause",
        "budget_stop",
      ]),
      option_index: z.number().int().min(0).max(2).optional(),
      confirm_budget_change: z.boolean().default(false),
      budget: z
        .object({
          token_limit: z.number().int().min(1000).max(maximumRunTokens),
          credit_limit: z.number().int().min(0).max(10000000),
          expected_token_limit: z.number().int(),
          expected_credit_limit: z.number().int(),
        })
        .strict()
        .optional(),
      message: z.string().trim().max(12000).default(""),
      accept_unknown_cost: z.boolean().default(false),
    })
    .strict()
    .parse(body);
  if (b.choice === "answer" && !b.message && b.option_index === undefined)
    throw new HttpError(400, "Bitte eine Antwort ergänzen.");
  if (
    redact(b.message) !== b.message ||
    /\b(?:password|passwort|api[_ -]?key|secret)\s*[:=]/i.test(b.message)
  )
    throw new HttpError(
      400,
      "Keine Zugangsdaten im Antwortfeld eingeben. Einstellungen verwenden.",
    );
  const requestHash = digest(b);
  return transaction(async (c) => {
    const ref = (
      await c.query(
        "SELECT run_id,task_id FROM decisions WHERE id=$1 AND workspace_id=$2",
        [b.id, workspace],
      )
    ).rows[0];
    if (!ref)
      throw new HttpError(404, "Entscheidung fehlt in diesem Workspace.");
    const r = (
      await c.query(
        "SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [ref.run_id, workspace],
      )
    ).rows[0];
    const task = (
      await c.query(
        "SELECT * FROM tasks WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [ref.task_id, workspace],
      )
    ).rows[0];
    const d = (
      await c.query(
        "SELECT * FROM decisions WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [b.id, workspace],
      )
    ).rows[0];
    if (b.choice.startsWith("budget_")) {
      const role = await workspaceRole(actor, workspace);
      if (
        !role ||
        role === "viewer" ||
        (b.choice === "budget_increase" && !["owner", "admin"].includes(role))
      )
        throw new HttpError(403, "Keine Berechtigung für diese Budgetaktion.");
    }
    if (d.status === "stale")
      throw new HttpError(
        409,
        "Entscheidung ist nach geändertem Arbeitsstand nicht mehr aktuell.",
      );
    if (d.status !== "pending") {
      if (
        d.response_data?.request_hash === requestHash ||
        (!d.response_data?.request_hash &&
          d.response_action === b.choice &&
          d.response === b.message &&
          b.option_index === undefined &&
          !b.budget)
      )
        return { ok: true, duplicate: true };
      throw new HttpError(
        409,
        "Entscheidung wurde bereits beantwortet oder ist nicht mehr aktuell.",
      );
    }
    if (
      task.status !== "input_required" ||
      ["completed", "failed", "canceled"].includes(r.status)
    )
      throw new HttpError(
        409,
        "Auftrag wartet nicht mehr auf diese Entscheidung.",
      );
    const budgetScope =
      d.kind === "review" && !d.proposal_cipher
        ? budgetDecisionScope(d.question)
        : null;
    if (budgetScope) {
      if (!b.choice.startsWith("budget_"))
        throw new HttpError(
          409,
          "Eine Textantwort ändert keine Budgetgrenze. Bitte Limit ändern, Auftrag pausieren oder stoppen. Der Auftrag wurde nicht erneut gestartet.",
        );
      return applyBudgetDecision(
        c,
        actor,
        workspace,
        r,
        task,
        d,
        b,
        requestHash,
        budgetScope,
      );
    }
    if (b.choice.startsWith("budget_") || b.budget)
      throw new HttpError(400, "Diese Anfrage ist keine Budgetentscheidung.");
    if (b.option_index !== undefined) {
      const options = d.answer_options.length
        ? d.answer_options
        : fallbackAnswers(d.kind);
      if (!options[b.option_index])
        throw new HttpError(400, "Antwortvorschlag nicht verfügbar.");
      b.message = options[b.option_index] + (b.message ? "\n" + b.message : "");
    }
    if (
      b.choice === "approve" &&
      (d.kind !== "approval" ||
        !d.proposal_cipher ||
        Date.parse(d.expires_at) <= Date.now())
    )
      throw new HttpError(409, "Keine aktuelle Aktionsfreigabe.");
    if (
      b.choice === "approve" &&
      !d.tool_key?.startsWith("org_") &&
      !b.accept_unknown_cost
    )
      throw new HttpError(
        400,
        "Unbekannte externe Kosten bitte ausdrücklich bestätigen.",
      );
    if (b.choice === "access_ready" && d.kind !== "access")
      throw new HttpError(400, "Keine Zugangsanfrage.");
    let organisationResult: any = null;
    if (b.choice === "approve" && d.tool_key?.startsWith("org_")) {
      const proposal = JSON.parse(decrypt(d.proposal_cipher));
      const current = await target(c, task, proposal.tool, proposal.args, {});
      if (current.scope !== d.scope_hash)
        throw new HttpError(
          409,
          "Organisationsregeln wurden geändert. Neue Anfrage erforderlich.",
        );
      organisationResult =
        proposal.tool === "org_hire"
          ? await createHire(c, task, proposal.args, "decision:" + d.id, true)
          : await applyRestructure(c, task, proposal.args);
    }
    const status =
      b.choice === "approve"
        ? "approved"
        : b.choice === "deny"
          ? "denied"
          : "answered";
    const text =
      clean(b.message) +
      (organisationResult
        ? " Organisation umgesetzt: " + JSON.stringify(organisationResult)
        : "");
    const content =
      b.choice === "approve"
        ? `Nutzer hat ausschließlich diese einmalige Aktion freigegeben: ${d.action} (Freigabe ${d.id}, Parameterhash ${d.arguments_hash}). Die unveränderten Parameter deiner Anfrage verwenden. Vorhandene Rechte und Budgetgrenzen gelten weiterhin. ${text}`
        : b.choice === "deny"
          ? `Nutzer hat die Anfrage abgelehnt. Diese Aktion nicht ausführen; einen erlaubten anderen Ansatz wählen oder die Einschränkung erklären. ${text}`
          : b.choice === "access_ready"
            ? `Nutzer meldet Zugang eingerichtet. Aktuelle Verbindung und bestehende Werkzeugrechte selbst prüfen; keine zusätzliche Freigabe ableiten. ${text}`
            : `Antwort des Nutzers auf ${d.question}: ${text}. Dies ist keine Aktionsfreigabe.`;
    await c.query(
      "UPDATE decisions SET status=$2,response=$3,response_action=$4,answered_by=$5,answered_at=now() WHERE id=$1",
      [d.id, status, clean(b.message), b.choice, actor],
    );
    await c.query("UPDATE decisions SET response_data=$2 WHERE id=$1", [
      d.id,
      JSON.stringify({ request_hash: requestHash }),
    ]);
    await c.query(
      "UPDATE tasks SET status='queued',error=NULL,messages=$2,lease_token=NULL,lease_until=NULL,worker_id=NULL,loop_interventions=0,recovery_attempts=0 WHERE id=$1",
      [task.id, JSON.stringify([...task.messages, { role: "user", content }])],
    );
    await c.query(
      "INSERT INTO events(workspace_id,run_id,agent_id,kind,content) VALUES($1,$2,$3,'decision',$4)",
      [workspace, r.id, task.agent_id, `${d.kind}: ${status}. ${text}`],
    );
    await c.query(
      "INSERT INTO chat_messages(workspace_id,run_id,author,content) VALUES($1,$2,'Du',$3)",
      [workspace, r.id, content],
    );
    await audit(c, actor, `decision.${b.choice}`, d.id);
    return { ok: true };
  });
}
