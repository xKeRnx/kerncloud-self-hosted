import { taskTitle } from "../core/task-labels.ts";
import { z } from "zod";
import { pool } from "./db.ts";
import { projectFor } from "./organisation.ts";
import { redact } from "./security.ts";
import { HttpError } from "./auth.ts";
const short = (s: string, n = 160) =>
  redact(s).replace(/\s+/g, " ").slice(0, n);
const runSelect = `SELECT r.id,r.project_id,p.name project_name,r.status,r.tokens_used,r.token_limit,r.steps_used,r.max_steps,r.created_at,r.updated_at,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at,
left(r.goal,1000) title,
(SELECT count(*)::int FROM tasks t WHERE t.run_id=r.id AND t.workspace_id=r.workspace_id AND t.status='input_required') blockers,
(SELECT left(t.title,500) FROM tasks t WHERE t.run_id=r.id AND t.workspace_id=r.workspace_id ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'input_required' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 1) current_step,
(SELECT max(e.created_at) FROM events e WHERE e.run_id=r.id AND e.workspace_id=r.workspace_id) last_activity
FROM runs r JOIN workspace_projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id`;
function cleanRun(r: any) {
  return {
    ...r,
    title: short(taskTitle(r.title), 110),
    current_step: r.current_step ? short(r.current_step, 160) : null,
  };
}
export async function workspaceHome(workspace: string) {
  const q = (sql: string) => pool.query(sql, [workspace]).then((r) => r.rows);
  const [stats, running, results, attention, projects, agents] =
    await Promise.all([
      q(`SELECT (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND status IN('running','paused','input_required')) open,
 (SELECT count(*)::int FROM runs WHERE workspace_id=$1 AND status='completed') completed,
 (SELECT count(*)::int FROM tasks t JOIN runs r ON r.id=t.run_id AND r.workspace_id=t.workspace_id WHERE t.workspace_id=$1 AND t.status='input_required' AND r.status NOT IN('completed','failed','canceled')) attention,
 (SELECT count(*)::int FROM workspace_projects WHERE workspace_id=$1) projects`),
      q(
        runSelect +
          ` WHERE r.workspace_id=$1 AND r.status IN('running','paused','input_required') ORDER BY r.updated_at DESC,r.id DESC LIMIT 12`,
      ),
      q(
        `SELECT * FROM(SELECT DISTINCT ON(a.run_id) a.id,a.name,a.run_id,a.created_at,r.project_id,p.name project_name,left(r.goal,1000) title,r.status FROM artifacts a JOIN runs r ON r.id=a.run_id AND r.workspace_id=a.workspace_id JOIN workspace_projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id WHERE a.workspace_id=$1 AND NOT a.retired AND a.name NOT LIKE 'validation/%' ORDER BY a.run_id,CASE WHEN lower(a.name) LIKE '%.html' THEN 0 WHEN lower(a.name) LIKE '%.md' THEN 1 ELSE 2 END,a.created_at DESC,a.id DESC) latest ORDER BY created_at DESC,id DESC LIMIT 8`,
      ),
      q(
        `SELECT t.id,t.run_id,t.agent_id,r.project_id,p.name project_name,a.name agent_name,left(coalesce(d.question,t.error,'Rückmeldung erforderlich'),1000) question FROM tasks t JOIN runs r ON r.id=t.run_id AND r.workspace_id=t.workspace_id JOIN workspace_projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id JOIN agents a ON a.id=t.agent_id AND a.workspace_id=t.workspace_id LEFT JOIN LATERAL (SELECT question FROM decisions WHERE task_id=t.id AND workspace_id=t.workspace_id AND status='pending' ORDER BY created_at DESC LIMIT 1) d ON true WHERE t.workspace_id=$1 AND t.status='input_required' AND r.status NOT IN('completed','failed','canceled') ORDER BY t.created_at LIMIT 12`,
      ),
      q(
        `SELECT p.id,p.name,p.status,p.created_at,(SELECT count(*)::int FROM runs r WHERE r.project_id=p.id AND r.workspace_id=p.workspace_id AND r.status IN('running','paused','input_required')) open FROM workspace_projects p WHERE p.workspace_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 8`,
      ),
      q(
        `SELECT a.id,a.name,a.role,a.execution_paused, (SELECT count(*)::int FROM tasks t WHERE t.agent_id=a.id AND t.workspace_id=a.workspace_id AND t.status='running') running FROM agents a WHERE a.workspace_id=$1 ORDER BY a.name LIMIT 50`,
      ),
    ]);
  return {
    scope: "workspace",
    workspace_id: workspace,
    stats: stats[0],
    running: running.map(cleanRun),
    results: results.map((r) => ({
      ...r,
      title: short(taskTitle(r.title), 110),
    })),
    attention: attention.map((r) => ({
      ...r,
      question: short(r.question, 300),
    })),
    projects,
    agents,
    generated_at: new Date().toISOString(),
  };
}
export async function workspaceTasks(
  workspace: string,
  params: URLSearchParams,
) {
  const p = z
    .object({
      project: z.string().max(100).optional(),
      status: z
        .enum([
          "all",
          "running",
          "paused",
          "input_required",
          "completed",
          "failed",
          "canceled",
        ])
        .default("all"),
      q: z.string().trim().max(200).default(""),
      before: z.string().max(500).optional(),
    })
    .parse(Object.fromEntries(params));
  if (p.project) await projectFor(pool, workspace, p.project);
  const values: unknown[] = [workspace],
    where = ["r.workspace_id=$1"];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replace("?", "$" + values.length));
  };
  if (p.project) add("r.project_id=?", p.project);
  if (p.status === "input_required")
    where.push(
      "(r.status='input_required' OR EXISTS(SELECT 1 FROM tasks t WHERE t.run_id=r.id AND t.workspace_id=r.workspace_id AND t.status='input_required'))",
    );
  else if (p.status !== "all") add("r.status=?", p.status);
  if (p.q)
    add(
      "r.goal ILIKE ? ESCAPE E'\\\\'",
      "%" + p.q.replace(/[\\%_]/g, "\\$&") + "%",
    );
  if (p.before) {
    let c;
    try {
      c = z
        .object({ at: z.string().datetime(), id: z.string().min(1).max(100) })
        .strict()
        .parse(JSON.parse(Buffer.from(p.before, "base64url").toString()));
    } catch {
      throw new HttpError(400, "Ungültiger Seitencursor.");
    }
    values.push(c.at, c.id);
    where.push(
      "(r.created_at,r.id)<($" +
        (values.length - 1) +
        "::timestamptz,$" +
        values.length +
        "::text)",
    );
  }
  const rows = (
    await pool.query(
      runSelect +
        " WHERE " +
        where.join(" AND ") +
        " ORDER BY r.created_at DESC,r.id DESC LIMIT 26",
      values,
    )
  ).rows;
  const more = rows.length > 25,
    items = rows.slice(0, 25);
  const last = items.at(-1);
  return {
    scope: "workspace",
    workspace_id: workspace,
    items: items.map(cleanRun),
    next: more
      ? Buffer.from(
          JSON.stringify({ at: last.cursor_created_at, id: last.id }),
        ).toString("base64url")
      : null,
  };
}
