import { z } from "zod";
import { pool } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { projectFor } from "./organisation.ts";
import {
  inspectionEntry,
  inspectorText,
  inspectorPayload,
} from "../core/agent-inspector.ts";
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
async function agentFor(actor: string, workspace: string, agent: string) {
  await workspaceRole(actor, workspace);
  identifier.parse(agent);
  const row = (
    await pool.query(
      `SELECT a.id,a.name,a.role,a.execution_paused,w.execution_paused AS workspace_paused,mo.name AS assigned_model,mo.provider_name AS assigned_provider FROM agents a JOIN workspaces w ON w.id=a.workspace_id LEFT JOIN model_offerings mo ON mo.id=coalesce(a.model_id,w.default_model_id) AND (mo.workspace_id IS NULL OR mo.workspace_id=w.id) WHERE a.id=$1 AND a.workspace_id=$2`,
      [agent, workspace],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(404, "Agent in diesem Workspace nicht gefunden.");
  return row;
}
const taskColumns = `t.id,t.run_id,t.parent_id,t.title,t.status,t.error,t.result,t.created_at,r.project_id,p.name AS project_name,r.status AS run_status,
 (SELECT m.model_name FROM model_calls m WHERE m.task_id=t.id AND m.workspace_id=t.workspace_id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_model_name,
 (SELECT m.status FROM model_calls m WHERE m.task_id=t.id AND m.workspace_id=t.workspace_id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_call_status`;
const cleanTask = (row: any) => ({
  ...row,
  title: inspectorText(row.title, 500),
  project_name: inspectorText(row.project_name, 200),
  error: row.error ? inspectorText(row.error) : null,
  result: row.result ? inspectorText(row.result) : null,
});
export async function inspectAgent(
  actor: string,
  workspace: string,
  agent: string,
  params: URLSearchParams,
) {
  const person = await agentFor(actor, workspace, agent);
  const filter = z
    .object({
      project: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,100}$/)
        .optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .parse({
      project: params.get("filterProject") || undefined,
      page: params.get("page") ?? undefined,
    });
  if (filter.project) await projectFor(pool, workspace, filter.project);
  const args = [workspace, agent, filter.project ?? null];
  const [projects, tasks, total, usage] = await Promise.all([
    pool.query(
      "SELECT id,name FROM workspace_projects WHERE workspace_id=$1 ORDER BY name",
      [workspace],
    ),
    pool.query(
      `SELECT ${taskColumns} FROM tasks t JOIN runs r ON r.id=t.run_id AND r.workspace_id=t.workspace_id JOIN workspace_projects p ON p.id=r.project_id AND p.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND t.agent_id=$2 AND ($3::text IS NULL OR r.project_id=$3) ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'input_required' THEN 1 WHEN 'waiting' THEN 2 WHEN 'queued' THEN 3 WHEN 'paused' THEN 4 ELSE 5 END,t.created_at DESC,t.id DESC LIMIT 25 OFFSET $4`,
      [...args, (filter.page - 1) * 25],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM tasks t JOIN runs r ON r.id=t.run_id AND r.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND t.agent_id=$2 AND ($3::text IS NULL OR r.project_id=$3)`,
      args,
    ),
    pool.query(
      `SELECT count(*)::int AS calls,coalesce(sum(m.tokens) FILTER(WHERE m.usage_known),0)::bigint AS tokens,count(*) FILTER(WHERE NOT m.usage_known)::int AS unknown_calls,coalesce(sum(CASE WHEN m.status IN('reserved','uncertain') THEN m.reserved ELSE m.charged_credits END),0)::bigint AS credits,coalesce(sum(m.budget_tokens) FILTER(WHERE NOT m.usage_known),0)::bigint AS unconfirmed_tokens FROM model_calls m JOIN tasks t ON t.id=m.task_id AND t.workspace_id=m.workspace_id JOIN runs r ON r.id=t.run_id AND r.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND t.agent_id=$2 AND ($3::text IS NULL OR r.project_id=$3)`,
      args,
    ),
  ]);
  return {
    agent: {
      ...person,
      name: inspectorText(person.name, 200),
      role: inspectorText(person.role, 500),
    },
    projects: projects.rows,
    tasks: tasks.rows.map(cleanTask),
    total: total.rows[0].n,
    page: filter.page,
    usage: usage.rows[0],
    generated_at: new Date().toISOString(),
  };
}
export async function inspectAgentTask(
  actor: string,
  workspace: string,
  agent: string,
  taskId: string,
  params: URLSearchParams,
) {
  await agentFor(actor, workspace, agent);
  identifier.parse(taskId);
  const before = params.has("before")
    ? z.coerce.number().int().min(0).max(1000000).parse(params.get("before"))
    : null;
  const task = (
    await pool.query(
      `SELECT ${taskColumns},left(t.instructions,6000) AS instructions,jsonb_array_length(t.messages) AS message_count,t.context_state->'estimated_input_upper_bound' AS estimated_input,t.context_state->'omitted_groups' AS compacted_groups,r.goal,r.token_limit,r.credit_limit FROM tasks t JOIN runs r ON r.id=t.run_id AND r.workspace_id=t.workspace_id JOIN workspace_projects p ON p.id=r.project_id AND p.workspace_id=t.workspace_id WHERE t.id=$3 AND t.workspace_id=$1 AND t.agent_id=$2`,
      [workspace, agent, taskId],
    )
  ).rows[0];
  if (!task)
    throw new HttpError(
      404,
      "Aufgabe gehört nicht zu diesem Agenten und Workspace.",
    );
  const [
    messages,
    calls,
    callTotal,
    budget,
    relations,
    events,
    plan,
    runningTools,
  ] = await Promise.all([
    pool.query(
      `SELECT (n-1)::int AS index,message FROM tasks t CROSS JOIN LATERAL jsonb_array_elements(t.messages) WITH ORDINALITY AS m(message,n) WHERE t.id=$1 AND t.workspace_id=$2 AND t.agent_id=$3 AND message->>'role' IN('user','assistant','tool') AND ($4::int IS NULL OR n-1<$4) ORDER BY n DESC LIMIT 21`,
      [taskId, workspace, agent, before],
    ),
    pool.query(
      `SELECT id,status,model_name,provider_name,managed,tokens,input_tokens,output_tokens,usage_known,budget_tokens,charged_credits,reserved,created_at,duration_ms,outcome FROM model_calls WHERE workspace_id=$1 AND task_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20`,
      [workspace, taskId],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM model_calls WHERE workspace_id=$1 AND task_id=$2`,
      [workspace, taskId],
    ),
    pool.query(
      `SELECT coalesce(sum(tokens) FILTER(WHERE usage_known),0)::bigint AS measured_tokens,coalesce(sum(CASE WHEN usage_known THEN tokens ELSE budget_tokens END),0)::bigint AS accounted_tokens,coalesce(sum(CASE WHEN status IN('reserved','uncertain') THEN reserved ELSE charged_credits END),0)::bigint AS credits,count(*) FILTER(WHERE NOT usage_known)::int AS unknown_calls FROM model_calls WHERE workspace_id=$1 AND run_id=$2`,
      [workspace, task.run_id],
    ),
    pool.query(
      `SELECT t.id,t.agent_id,a.name AS agent_name,t.title,t.status,t.parent_id,left(t.instructions,6000) AS instructions,left(t.result,6000) AS result,t.error FROM tasks t JOIN agents a ON a.id=t.agent_id AND a.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND t.run_id=$2 AND (t.parent_id=$3 OR t.id=$4) ORDER BY t.created_at LIMIT 50`,
      [workspace, task.run_id, taskId, task.parent_id],
    ),
    pool.query(
      `SELECT e.id,e.agent_id,a.name AS agent_name,e.kind,left(e.content,6000) AS content,e.created_at FROM events e LEFT JOIN agents a ON a.id=e.agent_id AND a.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND e.run_id=$2 AND (e.agent_id=$3 OR e.kind IN('message','delegated','decision')) ORDER BY e.id DESC LIMIT 40`,
      [workspace, task.run_id, agent],
    ),
    pool.query(
      `SELECT id,title,status,planned_start,target_at,estimate_min,estimate_max,confidence,dependencies,run_id FROM project_plan_items WHERE workspace_id=$1 AND project_id=$2 AND agent_id=$3 AND (run_id IS NULL OR run_id=$4) AND status NOT IN('done','canceled') ORDER BY planned_start NULLS LAST,created_at LIMIT 10`,
      [workspace, task.project_id, agent, task.run_id],
    ),
    pool.query(
      "SELECT j.id,j.tool,j.status,j.created_at,j.args,j.result,e.name AS environment_name FROM environment_tool_calls j JOIN customer_environments e ON e.id=j.environment_id WHERE j.task_id=$1 AND e.workspace_id=$2 AND j.status IN('queued','running','uncertain') ORDER BY j.created_at DESC LIMIT 10",
      [taskId, workspace],
    ),
  ]);
  const raw = messages.rows.slice(0, 20).reverse();
  return {
    task: {
      ...cleanTask(task),
      instructions: inspectorText(task.instructions),
      goal: inspectorText(task.goal, 1000),
    },
    entries: raw.map((r) => inspectionEntry(r.index, r.message)),
    next_before: messages.rows.length > 20 ? raw[0].index : null,
    running_tools: runningTools.rows.map(({ args, result, ...r }) => ({
      ...r,
      arguments: inspectorPayload(args),
      result: result == null ? null : inspectorPayload(result),
      environment_name: inspectorText(r.environment_name, 200),
    })),
    calls: calls.rows,
    calls_total: callTotal.rows[0].n,
    budget: budget.rows[0],
    relations: relations.rows.map((r) => ({
      ...cleanTask(r),
      agent_name: inspectorText(r.agent_name, 200),
      instructions: inspectorText(r.instructions),
    })),
    events: events.rows.map((e) => ({
      ...e,
      content: inspectorText(e.content),
      agent_name: inspectorText(e.agent_name, 200),
    })),
    plan: plan.rows.map((p) => ({ ...p, title: inspectorText(p.title, 500) })),
    generated_at: new Date().toISOString(),
  };
}
