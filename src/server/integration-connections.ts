import { randomUUID } from "node:crypto";
import { z } from "zod";
import { integrationById } from "../core/integration-catalog.ts";
import { appConnectionPlan, appAccess, appFetch } from "./work-apps.ts";
import { transaction, pool, audit } from "./db.ts";
import { encrypt } from "./security.ts";
import { workspaceRole } from "./team.ts";
import { HttpError } from "./auth.ts";

const credential = z
  .string()
  .min(8)
  .max(4096)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
export async function saveTokenIntegration(
  actor: string,
  workspace: string,
  body: unknown,
) {
  if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
    throw new HttpError(403, "Workspace administration required");
  const b = z
    .object({
      id: z.string().uuid().optional(),
      service_id: z.string().max(60),
      name: z.string().trim().min(1).max(100),
      token: credential,
      project_ids: z.array(z.string().uuid()).max(100).default([]),
    })
    .strict()
    .parse(body);
  const service = integrationById(b.service_id);
  if (!service || service.auth !== "token")
    throw new HttpError(400, "Token integration required");
  const id = b.id ?? randomUUID();
  await transaction(async (c) => {
    const projects = await c.query(
      "SELECT id FROM workspace_projects WHERE workspace_id=$1 AND id=ANY($2::text[])",
      [workspace, b.project_ids],
    );
    if (projects.rowCount !== new Set(b.project_ids).size)
      throw new HttpError(400, "Foreign project");
    const secret = encrypt(
      JSON.stringify({ access_token: b.token, expires_at: null }),
    );
    if (b.id) {
      const changed = await c.query(
        "UPDATE work_app_connections SET credential=$4,name=$5,health='unchecked',health_message=NULL,checked_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND service_id=$3",
        [id, workspace, service.id, secret, b.name],
      );
      if (!changed.rowCount)
        throw new HttpError(404, "Integration connection not found");
    } else
      await c.query(
        "INSERT INTO work_app_connections(id,workspace_id,provider,service_id,name,credential,scopes,project_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          workspace,
          service.provider,
          service.id,
          b.name,
          secret,
          [
            "service_read",
            ...(service.actions.some((a) => a.write) ? ["service_write"] : []),
          ],
          JSON.stringify(b.project_ids),
        ],
      );
    await audit(
      c,
      actor,
      b.id ? "integration.rotate" : "integration.connect",
      id,
    );
  });
  return { id, saved: true };
}
export async function checkIntegration(
  actor: string,
  workspace: string,
  body: unknown,
) {
  if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
    throw new HttpError(403, "Workspace administration required");
  const { id } = z.object({ id: z.string().uuid() }).strict().parse(body);
  const row = await transaction(async (c) => {
    const row = (
      await c.query(
        "SELECT * FROM work_app_connections WHERE id=$1 AND workspace_id=$2 AND enabled FOR UPDATE",
        [id, workspace],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Integration connection not found");
    if (
      row.checked_at &&
      Date.now() - new Date(row.checked_at).getTime() < 60000
    )
      throw new HttpError(
        429,
        "Wait one minute before checking this connection again",
      );
    await c.query(
      "UPDATE work_app_connections SET checked_at=now() WHERE id=$1",
      [id],
    );
    return row;
  });
  const service = integrationById(row.service_id);
  const test = service?.test ?? {
    operation: row.provider === "github" ? "repos_list" : "files_list",
    input: {},
  };
  let health = "ok",
    message =
      "Provider accepted the read-only test. Other operations depend on scopes and resource permissions.";
  try {
    const { row: current, token } = await appAccess(id, workspace);
    if (current.revision !== row.revision)
      throw new Error("Connection changed");
    const plan = appConnectionPlan(row, test)!;
    await appFetch(
      token,
      plan.url,
      plan.method,
      plan.body,
      undefined,
      row.provider,
    );
  } catch (error) {
    health = "error";
    // Do not store upstream bodies or errors that could contain credentials/URLs.
    message =
      error instanceof HttpError
        ? error.message
        : "Connection test failed. Check token, provider availability, scopes and shared resources.";
  }
  await pool.query(
    "UPDATE work_app_connections SET health=$4,health_message=$5 WHERE id=$1 AND workspace_id=$2 AND revision=$3",
    [id, workspace, row.revision, health, message],
  );
  return { health, message };
}
