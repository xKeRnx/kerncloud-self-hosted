import { projectFor } from "./organisation.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { workspaceRole } from "./team.ts";
import { HttpError } from "./auth.ts";
import {
  branchName,
  githubRepository,
  projectCommand,
  publishInput,
} from "../core/projects.ts";
import { environmentToolStep } from "./environment-tools.ts";
import { lockTask } from "./store.ts";
import { appFetch } from "./work-apps.ts";
export async function projects(
  actor: string,
  workspace: string,
  body?: unknown,
  projectId?: string,
) {
  const project = await projectFor(pool, workspace, projectId);
  if (body) {
    if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
      throw new HttpError(403, "Workspace administration required");
    const b = z
      .object({
        action: z.enum(["create", "delete"]),
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(100).optional(),
        repo_url: z.string().url().optional(),
        branch: branchName.default("kerncloud/work"),
        environment_id: z.string().uuid().optional(),
        preview_port: z
          .number()
          .int()
          .min(1024)
          .max(65535)
          .nullable()
          .default(null),
      })
      .strict()
      .parse(body);
    if (b.action === "delete") {
      await pool.query(
        "DELETE FROM work_projects WHERE id=$1 AND workspace_id=$2",
        [b.id, workspace],
      );
      return { ok: true };
    }
    if (!b.name || !b.repo_url || !b.environment_id)
      throw new HttpError(
        400,
        "Name, repository and development environment required",
      );
    githubRepository(b.repo_url);
    if (
      !(
        await pool.query(
          "SELECT id FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND template_id='development' AND project_id=$3 AND status<>'deleted'",
          [b.environment_id, workspace, project.id],
        )
      ).rowCount
    )
      throw new HttpError(403, "Development environment missing");
    const count = (
      await pool.query(
        "SELECT count(*) n FROM work_projects WHERE workspace_id=$1",
        [workspace],
      )
    ).rows[0];
    if (Number(count.n) >= 30) throw new HttpError(409, "Project limit: 30");
    await transaction(async (c) => {
      const id = randomUUID();
      await c.query(
        "INSERT INTO work_projects(id,workspace_id,name,repo_url,branch,environment_id,preview_port,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          workspace,
          b.name,
          b.repo_url,
          b.branch,
          b.environment_id,
          b.preview_port,
          project.id,
        ],
      );
      await audit(c, actor, "project.create", id);
    });
  }
  return {
    items: (
      await pool.query(
        "SELECT p.*,e.name environment_name,e.status environment_status FROM work_projects p JOIN customer_environments e ON e.id=p.environment_id WHERE p.workspace_id=$1 AND p.project_id=$2 ORDER BY p.created_at",
        [workspace, project.id],
      )
    ).rows,
    environments: (
      await pool.query(
        "SELECT id,name,status FROM customer_environments WHERE workspace_id=$1 AND project_id=$2 AND template_id='development' AND status<>'deleted'",
        [workspace, project.id],
      )
    ).rows,
  };
}
export async function projectToolStep(
  taskId: string,
  lease: string,
  callId: string,
  input: unknown,
) {
  const b = z
    .object({
      project_id: z.string().uuid(),
      action: z.enum(["clone", "status", "diff", "test", "commit"]),
      input: z.record(z.unknown()).default({}),
    })
    .strict()
    .parse(input);
  const p = await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const p = (
      await c.query(
        "SELECT * FROM work_projects WHERE id=$1 AND workspace_id=$2 AND project_id=(SELECT project_id FROM runs WHERE id=$3)",
        [b.project_id, task.workspace_id, task.run_id],
      )
    ).rows[0];
    if (!p) throw new HttpError(404, "Project unavailable");
    return p;
  });
  const command = projectCommand(p, b.action, b.input);
  return environmentToolStep(taskId, lease, callId, "environment_command", {
    environment_id: p.environment_id,
    ...command,
    background: b.action === "test" || b.action === "clone",
    timeout_seconds: b.action === "test" || b.action === "clone" ? 300 : 30,
  });
}
export async function publishGithub(
  token: string,
  input: unknown,
  signal: AbortSignal,
) {
  const b = publishInput.parse(input),
    base = "https://api.github.com/repos/" + b.repository;
  const ref = await appFetch(
    token,
    base + "/git/ref/heads/" + encodeURIComponent(b.base),
    "GET",
    undefined,
    signal,
  );
  const commit = await appFetch(
    token,
    base + "/git/commits/" + ref.object.sha,
    "GET",
    undefined,
    signal,
  );
  const tree = await appFetch(
    token,
    base + "/git/trees",
    "POST",
    {
      base_tree: commit.tree.sha,
      tree: b.files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    },
    signal,
  );
  const next = await appFetch(
    token,
    base + "/git/commits",
    "POST",
    { message: b.title, tree: tree.sha, parents: [ref.object.sha] },
    signal,
  );
  // Never force-update an existing branch; a conflict requires inspection, not replay.
  await appFetch(
    token,
    base + "/git/refs",
    "POST",
    { ref: "refs/heads/" + b.branch, sha: next.sha },
    signal,
  );
  const pr = await appFetch(
    token,
    base + "/pulls",
    "POST",
    { title: b.title, body: b.body, head: b.branch, base: b.base, draft: true },
    signal,
  );
  return {
    commit: next.sha,
    pull_request: pr.html_url,
    number: pr.number,
    branch: b.branch,
  };
}
