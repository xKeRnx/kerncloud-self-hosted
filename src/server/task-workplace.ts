import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { changeRun } from "./store.ts";
import { z } from "zod";
export async function taskWorkplace(
  actor: string,
  workspace: string,
  runId: string,
  body?: unknown,
) {
  const run = (
    await pool.query(
      "SELECT id,project_id,status FROM runs WHERE id=$1 AND workspace_id=$2",
      [runId, workspace],
    )
  ).rows[0];
  if (!run) throw new HttpError(404, "Task unavailable");
  const owner =
    (
      await pool.query(
        "SELECT owner_id=$2 AS own FROM workspaces WHERE id=$1",
        [workspace, actor],
      )
    ).rows[0]?.own === true;
  if (body) {
    if (!owner)
      throw new HttpError(
        403,
        "The workspace owner controls interactive environments",
      );
    const b = z
      .object({
        action: z.enum(["takeover", "release"]),
        environmentId: z.string().uuid(),
      })
      .parse(body);
    if (
      !(
        await pool.query(
          "SELECT 1 FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND status<>'deleted'",
          [b.environmentId, workspace, run.project_id],
        )
      ).rowCount
    )
      throw new HttpError(404, "Environment is outside this project");
    if (
      b.action === "takeover" &&
      ["completed", "failed", "canceled"].includes(run.status)
    )
      throw new HttpError(
        409,
        "This task is closed. Open an active task to take control of its environment.",
      );
    if (b.action === "takeover") await changeRun(workspace, runId, "pause");
    await transaction(async (c) => {
      const e = (
        await c.query(
          "SELECT * FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND status<>'deleted' FOR UPDATE",
          [b.environmentId, workspace, run.project_id],
        )
      ).rows[0];
      if (!e) throw new HttpError(404, "Environment is outside this project");
      if (
        b.action === "takeover" &&
        (
          await c.query(
            "SELECT 1 FROM environment_jobs WHERE environment_id=$1 AND status NOT IN('done','failed','canceled') UNION ALL SELECT 1 FROM environment_tool_calls WHERE environment_id=$1 AND status NOT IN('done','canceled') LIMIT 1",
            [e.id],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "Task paused. Wait for the current environment operation to settle, then take control.",
        );
      await c.query(
        "UPDATE customer_environments SET human_controlled=$2,control_owner_id=$3 WHERE id=$1",
        [e.id, b.action === "takeover", b.action === "takeover" ? actor : null],
      );
      // Old interactive sessions cannot retain input access after control is handed back.
      await c.query(
        "DELETE FROM environment_sessions WHERE environment_id=$1",
        [e.id],
      );
      await audit(c, actor, "environment.control." + b.action, e.id);
    });
  }
  return {
    canControl: owner,
    run,
    environments: (
      await pool.query(
        "SELECT id,name,status,template_id,human_controlled FROM customer_environments WHERE workspace_id=$1 AND project_id=$2 AND status<>'deleted' ORDER BY name",
        [workspace, run.project_id],
      )
    ).rows,
  };
}
