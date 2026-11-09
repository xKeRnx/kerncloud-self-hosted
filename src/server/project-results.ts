import { z } from "zod";
import { pool } from "./db.ts";
import { projectFor } from "./organisation.ts";
import { HttpError } from "./auth.ts";
export async function projectResults(
  workspace: string,
  project: string,
  params: URLSearchParams,
) {
  await projectFor(pool, workspace, project);
  const values: unknown[] = [workspace, project];
  let cursor = "";
  if (params.has("before")) {
    try {
      if (params.get("before")!.length > 500) throw new Error();
      const p = z
        .object({ at: z.string().datetime(), id: z.string().min(1).max(100) })
        .strict()
        .parse(
          JSON.parse(
            Buffer.from(params.get("before")!, "base64url").toString(),
          ),
        );
      values.push(p.at, p.id);
      cursor = " AND (a.created_at,a.id)<($3::timestamptz,$4::text)";
    } catch {
      throw new HttpError(400, "Ungültiger Seitencursor.");
    }
  }
  const rows = (
    await pool.query(
      `SELECT a.id,a.name,a.run_id,a.created_at,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at,r.status,left(r.goal,120) title FROM artifacts a JOIN runs r ON r.id=a.run_id AND r.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND r.project_id=$2 AND NOT a.retired` +
        cursor +
        " ORDER BY a.created_at DESC,a.id DESC LIMIT 26",
      values,
    )
  ).rows;
  const items = rows.slice(0, 25),
    last = items.at(-1);
  return {
    project_id: project,
    items,
    next:
      rows.length > 25
        ? Buffer.from(
            JSON.stringify({ at: last.cursor_created_at, id: last.id }),
          ).toString("base64url")
        : null,
  };
}
