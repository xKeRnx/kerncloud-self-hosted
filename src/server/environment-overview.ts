import { z } from "zod";
import { pool } from "./db.ts";
import { workspaceRole } from "./team.ts";
import { HttpError } from "./auth.ts";
import { customerEnvironment } from "./runtime.ts";
import { assignEnvironment, projectFor } from "./organisation.ts";
import type { Workspace } from "../core/types.ts";
const filterInput = z.object({
  project: z.string().uuid().optional(),
  status: z
    .enum([
      "all",
      "booked",
      "running",
      "stopped",
      "pending",
      "failed",
      "uncertain",
      "exited",
    ])
    .default("all"),
  query: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export async function environmentOverview(
  actor: string,
  workspace: Workspace,
  params: URLSearchParams,
) {
  const access = await workspaceRole(actor, workspace.id);
  const f = filterInput.parse({
    project: params.get("filterProject") || undefined,
    status: params.get("status") || undefined,
    query: params.get("query") || undefined,
    page: params.get("page") || undefined,
  });
  if (f.project) await projectFor(pool, workspace.id, f.project);
  const values = [
    workspace.id,
    f.project ?? null,
    f.status,
    "%" + f.query + "%",
  ];
  const where =
    "e.workspace_id=$1 AND e.status<>'deleted' AND ($2::text IS NULL OR e.project_id=$2) AND ($3='all' OR e.status=$3) AND (e.name ILIKE $4 OR p.name ILIKE $4)";
  const [rows, total, projects, summary] = await Promise.all([
    pool.query(
      "SELECT e.id,e.name,e.project_id,p.name project_name,p.status project_status,e.status,e.template_id,t.name template_name,t.cpu,t.memory_mb,t.runtime_rate current_rate,e.runtime_rate,e.self_service,e.billing_source,e.billing_active,(e.reservation IS NOT NULL) reserved_minute,e.access_blocked,e.updated_at,e.last_error,h.name host_name,(e.resource_id IS NOT NULL) has_resource,EXISTS(SELECT 1 FROM environment_jobs j WHERE j.environment_id=e.id AND j.status IN('queued','running','uncertain')) pending_job,EXISTS(SELECT 1 FROM environment_tool_calls c WHERE c.environment_id=e.id AND c.status IN('queued','running','uncertain')) pending_tools FROM customer_environments e JOIN workspace_projects p ON p.id=e.project_id AND p.workspace_id=e.workspace_id JOIN environment_templates t ON t.id=e.template_id JOIN infrastructure_hosts h ON h.id=e.host_id WHERE " +
        where +
        " ORDER BY e.created_at DESC,e.id DESC LIMIT 25 OFFSET $5",
      [...values, (f.page - 1) * 25],
    ),
    pool.query(
      "SELECT count(*)::int total FROM customer_environments e JOIN workspace_projects p ON p.id=e.project_id AND p.workspace_id=e.workspace_id WHERE " +
        where +
        "",
      values,
    ),
    pool.query(
      "SELECT id,name,status FROM workspace_projects WHERE workspace_id=$1 ORDER BY is_default DESC,name,id",
      [workspace.id],
    ),
    pool.query(
      "SELECT count(*)::int total,count(*) FILTER(WHERE status='running')::int running,count(*) FILTER(WHERE status IN('booked','stopped','exited'))::int stopped,count(*) FILTER(WHERE status='pending')::int pending FROM customer_environments WHERE workspace_id=$1 AND status<>'deleted'",
      [workspace.id],
    ),
  ]);
  return {
    environments: rows.rows,
    total: total.rows[0].total,
    page: f.page,
    page_size: 25,
    projects: projects.rows,
    summary: summary.rows[0],
    can_manage: ["owner", "admin"].includes(access),
  };
}
export async function manageOverviewEnvironment(
  actor: string,
  workspace: Workspace,
  input: unknown,
) {
  const access = await workspaceRole(actor, workspace.id);
  if (!["owner", "admin"].includes(access))
    throw new HttpError(403, "Workspace-Administration erforderlich.");
  const b = z
    .object({
      id: z.string().uuid(),
      action: z.enum(["start", "stop", "assign"]),
      expectedProjectId: z.string().uuid(),
      targetProjectId: z.string().uuid().optional(),
      expectedRate: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .parse(input);
  const e = (
    await pool.query(
      "SELECT id,project_id FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND status<>'deleted'",
      [b.id, workspace.id],
    )
  ).rows[0];
  if (!e) throw new HttpError(404, "Umgebung fehlt in diesem Workspace.");
  if (e.project_id !== b.expectedProjectId)
    throw new HttpError(
      409,
      "Die Projektzuordnung wurde geändert. Bitte Ansicht aktualisieren.",
    );
  if (b.action === "assign") {
    if (!b.targetProjectId) throw new HttpError(400, "Zielprojekt fehlt.");
    return assignEnvironment(actor, workspace.id, {
      id: b.id,
      project_id: b.targetProjectId,
      expected_project_id: b.expectedProjectId,
    });
  }
  return customerEnvironment(
    actor,
    { ...workspace, project_id: e.project_id },
    { id: b.id, action: b.action, expectedRate: b.expectedRate },
  );
}
