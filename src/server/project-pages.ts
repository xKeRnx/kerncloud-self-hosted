import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { projectFor } from "./organisation.ts";
import { previewHtml, previewCsp } from "./artifacts.ts";
import { lockTask } from "./store.ts";
export const projectPageTool = {
  type: "function" as const,
  function: {
    name: "save_project_page",
    description:
      "Create or update a durable PRIVATE project page from an existing artifact. Existing public pages require owner review. A page does not grant access or change budgets.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        artifactId: { type: "string" },
        expectedRevision: { type: "integer" },
      },
      required: ["title", "artifactId"],
      additionalProperties: false,
    },
  },
};
export const projectPagesReadTool = {
  type: "function" as const,
  function: {
    name: "list_project_pages",
    description:
      "List private project page IDs, current revisions and titles. Use IDs to update a report rather than creating duplicates.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};
export async function projectPagesListStep(taskId: string, lease: string) {
  return transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease);
    return {
      result: JSON.stringify(
        (
          await c.query(
            "SELECT id,title,revision FROM project_pages WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 100",
            [task.workspace_id, run.project_id],
          )
        ).rows,
      ),
      yield: false,
    };
  });
}
export async function projectPageToolStep(
  taskId: string,
  lease: string,
  callId: string,
  args: unknown,
) {
  return transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease);
    const op = taskId + ":" + callId;
    const prior = (
      await c.query("SELECT status,result FROM operations WHERE id=$1", [op])
    ).rows[0];
    if (prior?.status === "done") return prior.result;
    if (prior)
      throw new HttpError(409, "Review the interrupted page operation");
    await c.query("SELECT id FROM workspace_projects WHERE id=$1 FOR UPDATE", [
      run.project_id,
    ]);
    const page = await writeProjectPage(
        c,
        task.workspace_id,
        run.project_id!,
        args,
        false,
      ),
      output = { result: JSON.stringify(page), yield: false };
    await c.query(
      "INSERT INTO operations(id,task_id,tool_name,status,result) VALUES($1,$2,'save_project_page','done',$3)",
      [op, taskId, JSON.stringify(output)],
    );
    return output;
  });
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const input = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(180),
  artifactId: z.string().uuid(),
  expectedRevision: z.number().int().positive().optional(),
  confirmPublicUpdate: z.boolean().default(false),
});
export async function writeProjectPage(
  c: PoolClient,
  workspace: string,
  project: string,
  body: unknown,
  canPublish: boolean,
) {
  const b = input.parse(body),
    old = b.id
      ? (
          await c.query(
            "SELECT * FROM project_pages WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
            [b.id, workspace, project],
          )
        ).rows[0]
      : null;
  if (b.id && !old) throw new HttpError(404, "Page unavailable");
  if (old && old.revision !== b.expectedRevision)
    throw new HttpError(409, "Page changed. Reload before updating.");
  if (old?.share_hash && (!canPublish || !b.confirmPublicUpdate))
    throw new HttpError(
      409,
      "Review the updated content and confirm that the public link may show it",
    );
  const file = (
    await c.query(
      "SELECT a.id,a.name,a.content,a.run_id FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE a.id=$1 AND a.workspace_id=$2 AND r.project_id=$3 AND NOT a.retired AND a.binary_data IS NULL AND a.binary_object IS NULL",
      [b.artifactId, workspace, project],
    )
  ).rows[0];
  if (!file || typeof file.content !== "string")
    throw new HttpError(
      404,
      "A text or HTML artifact in this project is required",
    );
  const siblings = (
    await c.query(
      "SELECT name,content FROM artifacts WHERE workspace_id=$1 AND run_id=$2 AND NOT retired AND binary_data IS NULL AND binary_object IS NULL",
      [workspace, file.run_id],
    )
  ).rows;
  const html = previewHtml(file, siblings);
  if (Buffer.byteLength(html) > 5_000_000)
    throw new HttpError(413, "Page is too large");
  const id = old?.id ?? randomUUID(),
    revision = (old?.revision ?? 0) + 1;
  if (
    !old &&
    (
      await c.query(
        "SELECT count(*)::int n FROM project_pages WHERE workspace_id=$1 AND project_id=$2",
        [workspace, project],
      )
    ).rows[0].n >= 100
  )
    throw new HttpError(409, "Project page limit reached");
  await c.query(
    "INSERT INTO project_pages(id,workspace_id,project_id,title,artifact_id,preview_html) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET title=$4,artifact_id=$5,preview_html=$6,revision=project_pages.revision+1,updated_at=now()",
    [id, workspace, project, b.title, file.id, html],
  );
  await c.query(
    "INSERT INTO project_page_versions(page_id,revision,artifact_id,preview_html) VALUES($1,$2,$3,$4)",
    [id, revision, file.id, html],
  );
  return { id, revision, preview: "/api/project-pages/" + id + "/preview" };
}
export async function projectPages(
  actor: string,
  workspace: string,
  projectId: string,
  method: string,
  parts: string[],
  body: unknown,
) {
  const project = await projectFor(pool, workspace, projectId),
    role = await workspaceRole(actor, workspace),
    canPublish = ["owner", "admin"].includes(role);
  if (method === "GET" && !parts[1])
    return {
      pages: (
        await pool.query(
          "SELECT id,title,revision,artifact_id,updated_at,(share_hash IS NOT NULL AND share_expires_at>now()) AS shared FROM project_pages WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 100",
          [workspace, project.id],
        )
      ).rows,
    };
  if (method === "GET" && parts[2] === "preview") {
    const p = (
      await pool.query(
        "SELECT preview_html FROM project_pages WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
        [parts[1], workspace, project.id],
      )
    ).rows[0];
    if (!p) throw new HttpError(404, "Page unavailable");
    return pageResponse(p.preview_html);
  }
  if (method === "GET" && parts[2] === "versions" && parts[4] === "preview") {
    const revision = z.coerce.number().int().positive().parse(parts[3]);
    const p = (
      await pool.query(
        "SELECT v.preview_html FROM project_page_versions v JOIN project_pages p ON p.id=v.page_id WHERE p.id=$1 AND p.workspace_id=$2 AND p.project_id=$3 AND v.revision=$4",
        [parts[1], workspace, project.id, revision],
      )
    ).rows[0];
    if (!p) throw new HttpError(404, "Version unavailable");
    return pageResponse(p.preview_html);
  }
  if (method === "GET" && parts[2] === "versions")
    return {
      versions: (
        await pool.query(
          "SELECT v.revision,v.artifact_id,v.created_at FROM project_page_versions v JOIN project_pages p ON p.id=v.page_id WHERE p.id=$1 AND p.workspace_id=$2 AND p.project_id=$3 ORDER BY v.revision DESC LIMIT 100",
          [parts[1], workspace, project.id],
        )
      ).rows,
    };
  if (!["owner", "admin", "editor"].includes(role))
    throw new HttpError(403, "Page editing requires a project editor");
  if (method === "POST" && !parts[1])
    return transaction(async (c) => {
      await c.query(
        "SELECT id FROM workspace_projects WHERE id=$1 FOR UPDATE",
        [project.id],
      );
      const r = await writeProjectPage(
        c,
        workspace,
        project.id,
        body,
        canPublish,
      );
      await audit(c, actor, "project.page.write", r.id);
      return r;
    });
  if (method === "POST" && parts[2] === "sharing") {
    if (!canPublish)
      throw new HttpError(
        403,
        "Only workspace administrators may publish a page",
      );
    const b = z
      .object({
        enabled: z.boolean(),
        expectedRevision: z.number().int().positive(),
        reviewed: z.boolean().default(false),
        days: z.number().int().min(1).max(90).default(7),
      })
      .parse(body);
    if (b.enabled && !b.reviewed)
      throw new HttpError(
        400,
        "Review the page and its bundled assets before sharing",
      );
    return transaction(async (c) => {
      const p = (
        await c.query(
          "SELECT id,revision FROM project_pages WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
          [parts[1], workspace, project.id],
        )
      ).rows[0];
      if (!p) throw new HttpError(404, "Page unavailable");
      if (p.revision !== b.expectedRevision)
        throw new HttpError(409, "Review the current revision");
      const token = b.enabled ? randomBytes(32).toString("base64url") : null;
      await c.query(
        "UPDATE project_pages SET share_hash=$2,share_expires_at=CASE WHEN $2::text IS NULL THEN NULL ELSE now()+$3*interval '1 day' END WHERE id=$1",
        [p.id, token ? hash(token) : null, b.days],
      );
      await audit(c, actor, "project.page.sharing", p.id);
      return { url: token ? "/api/shared-project-pages/" + token : null };
    });
  }
  throw new HttpError(405, "Unsupported page operation");
}
export function pageResponse(html: string) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": previewCsp,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
export async function sharedProjectPage(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new HttpError(404, "Shared page unavailable");
  const p = (
    await pool.query(
      "SELECT p.preview_html FROM project_pages p JOIN workspace_projects pr ON pr.id=p.project_id WHERE p.share_hash=$1 AND p.share_expires_at>now() AND pr.status='active'",
      [hash(token)],
    )
  ).rows[0];
  if (!p) throw new HttpError(404, "Shared page unavailable");
  return pageResponse(p.preview_html);
}
