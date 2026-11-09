import { pool } from "./db.ts";
import { HttpError } from "./auth.ts";
export async function runProcesses(workspaceId: string, runId: string) {
  if (
    !(
      await pool.query("SELECT 1 FROM runs WHERE id=$1 AND workspace_id=$2", [
        runId,
        workspaceId,
      ])
    ).rowCount
  )
    throw new HttpError(404, "Auftrag fehlt.");
  const rows = (
    await pool.query(
      "SELECT DISTINCT ON(j.result->>'process_id') e.name environment_name,j.finished_at,j.result FROM environment_tool_calls j JOIN customer_environments e ON e.id=j.environment_id JOIN tasks t ON t.id=j.task_id WHERE e.workspace_id=$1 AND t.workspace_id=$1 AND t.run_id=$2 AND j.status='done' AND j.result ? 'process_id' ORDER BY j.result->>'process_id',j.created_at DESC LIMIT 20",
      [workspaceId, runId],
    )
  ).rows;
  return {
    processes: rows.map((r) => ({
      environment_name: r.environment_name,
      updated_at: r.finished_at,
      process_id: r.result.process_id,
      status: r.result.status,
      exit_code: r.result.exit_code,
      output: String(r.result.output ?? "").slice(-24000),
      truncated: r.result.truncated,
      timed_out: r.result.timed_out,
      canceled: r.result.canceled,
    })),
    output_kind: "latest output section; not a full terminal recording",
  };
}
