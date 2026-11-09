import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { accessSql, validParent } from "./environment-access.ts";
const fingerprint = (files: unknown) =>
  createHash("sha256").update(JSON.stringify(files)).digest("hex");
async function requireRestoreReview(
  c: PoolClient,
  workspace: string,
  run: string | null,
) {
  const tasks = (
    await c.query(
      "SELECT id,messages FROM tasks WHERE workspace_id=$1 AND ($2::text IS NULL OR run_id=$2) AND status NOT IN('completed','failed','canceled') FOR UPDATE",
      [workspace, run],
    )
  ).rows;
  const note =
    "Sicherung wird zurückgesetzt. Der Datei-Arbeitsstand hat sich geändert. Vor Fortsetzen aktuelle Dateien und unklare externe Aktionen prüfen und eine neue Nutzeranweisung einholen. Frühere Werkzeugaktionen nicht erneut abspielen.";
  for (const task of tasks) {
    await c.query("UPDATE decisions SET status='stale' WHERE task_id=$1 AND status IN('pending','approved')", [task.id]);
    const messages = [...task.messages];
    const assistant = messages.findLast((m: any) => m.role === "assistant");
    for (const call of assistant?.tool_calls ?? [])
      if (!messages.some((m: any) => m.tool_call_id === call.id))
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "Nicht ausgeführt: Arbeitsstand wird zurückgesetzt; neue Nutzeranweisung erforderlich.",
        });
    messages.push({
      role: "user",
      content: note,
      recovery_code: "CHECKPOINT_RESTORE",
    });
    await c.query(
      "UPDATE tasks SET status='input_required',messages=$2,error=$3,lease_token=null,worker_id=null,lease_until=null WHERE id=$1",
      [task.id, JSON.stringify(messages), note],
    );
  }
  await c.query(
    "INSERT INTO events(workspace_id,run_id,kind,content) VALUES($1,$2,'user_message',$3)",
    [workspace, run, note],
  );
}
async function activeFiles(
  c: Pick<PoolClient, "query">,
  workspace: string,
  run: string,
) {
  return (
    await c.query(
      "SELECT id,task_id,name,content FROM artifacts WHERE workspace_id=$1 AND run_id=$2 AND NOT retired ORDER BY id",
      [workspace, run],
    )
  ).rows;
}
export async function captureRunCheckpoint(
  c: PoolClient,
  workspace: string,
  run: string,
  name: string,
) {
  const count = Number(
    (
      await c.query("SELECT count(*) FROM run_checkpoints WHERE run_id=$1", [
        run,
      ])
    ).rows[0].count,
  );
  if (count >= 10)
    throw new HttpError(409, "Maximal zehn Ergebnissicherungen pro Auftrag.");
  const id = randomUUID();
  const files = await activeFiles(c, workspace, run);
  await c.query(
    "INSERT INTO run_checkpoints(id,workspace_id,run_id,name,files) VALUES($1,$2,$3,$4,$5)",
    [id, workspace, run, name, JSON.stringify(files)],
  );
  return { id, files: files.length };
}
export async function runCheckpoints(
  actor: string,
  workspace: string,
  run: string,
  body?: unknown,
) {
  if (!body)
    return {
      checkpoints: (
        await pool.query(
          "SELECT id,name,created_at,jsonb_array_length(files) AS files FROM run_checkpoints WHERE workspace_id=$1 AND run_id=$2 ORDER BY created_at DESC",
          [workspace, run],
        )
      ).rows,
    };
  const b = z
    .object({
      action: z.enum(["create", "preview", "restore", "delete"]),
      name: z.string().trim().min(1).max(100).optional(),
      id: z.string().uuid().optional(),
      token: z.string().uuid().optional(),
    })
    .strict()
    .parse(body);
  return transaction(async (c) => {
    const r = (
      await c.query(
        "SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [run, workspace],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Auftrag fehlt.");
    if (b.action === "create")
      return captureRunCheckpoint(c, workspace, run, b.name ?? "Checkpoint");
    const s = (
      await c.query(
        "SELECT * FROM run_checkpoints WHERE id=$1 AND run_id=$2 AND workspace_id=$3",
        [b.id, run, workspace],
      )
    ).rows[0];
    if (!s) throw new HttpError(404, "Sicherungspunkt fehlt.");
    if (b.action === "delete") {
      await c.query("DELETE FROM run_checkpoints WHERE id=$1", [s.id]);
      return { ok: true };
    }
    const files = await activeFiles(c, workspace, run),
      previewHash = fingerprint(files);
    if (b.action === "preview") {
      const token = randomUUID();
      await c.query(
        "INSERT INTO checkpoint_restores(id,checkpoint_id,workspace_id,preview_hash) VALUES($1,$2,$3,$4)",
        [token, s.id, workspace, previewHash],
      );
      return {
        token,
        current: files.map((f) => ({ id: f.id, name: f.name })),
        target: s.files.map((f: any) => ({ id: f.id, name: f.name })),
      };
    }
    if (r.status === "running")
      throw new HttpError(409, "Auftrag vor dem Zurücksetzen pausieren.");
    const confirmed = (
      await c.query(
        "SELECT 1 FROM checkpoint_restores WHERE id=$1 AND checkpoint_id=$2 AND workspace_id=$3 AND preview_hash=$4 AND created_at>now()-interval '2 minutes' FOR UPDATE",
        [b.token, s.id, workspace, previewHash],
      )
    ).rowCount;
    if (!confirmed)
      throw new HttpError(
        409,
        "Ergebnisse wurden geändert oder Vorschau ist abgelaufen. Neu prüfen.",
      );
    const undo = await captureRunCheckpoint(
      c,
      workspace,
      run,
      "Vor Zurücksetzen",
    );
    await requireRestoreReview(c, workspace, run);
    await c.query(
      "UPDATE artifacts SET retired=true WHERE workspace_id=$1 AND run_id=$2",
      [workspace, run],
    );
    // New immutable copies preserve the old downloads and the automatic undo point.
    for (const f of s.files)
      await c.query(
        "INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), workspace, run, f.task_id, f.name, f.content],
      );
    await c.query("DELETE FROM checkpoint_restores WHERE id=$1", [b.token]);
    await audit(c, actor, "checkpoint.restore", s.id);
    return { ok: true, undo_checkpoint: undo.id };
  });
}
export async function authorizeCheckpointJob(
  c: Pick<PoolClient, "query">,
  job: any,
) {
  const e = (await c.query(accessSql, [job.environment_id, job.generation]))
    .rows[0];
  if (
    !e ||
    e.owner_id !== job.requested_by ||
    job.tool !== "environment_checkpoint" ||
    !(await validParent(c, job.parent_session, e)) ||
    Date.now() - Date.parse(job.created_at) > 120000
  )
    throw new HttpError(403, "Checkpoint-Zugang abgelaufen.");
  if (job.args.action === "restore") {
    const w = (
      await c.query("SELECT execution_paused FROM workspaces WHERE id=$1", [
        e.workspace_id,
      ])
    ).rows[0];
    if (!w.execution_paused)
      throw new HttpError(409, "Workspace vor dem Zurücksetzen stoppen.");
  }
  return e;
}
export async function environmentCheckpoints(
  actor: string,
  parent: string,
  workspace: string,
  body: unknown,
) {
  const b = z
    .object({
      environment_id: z.string().uuid(),
      action: z.enum(["list", "create", "preview", "restore", "delete"]),
      name: z.string().trim().min(1).max(100).optional(),
      checkpoint_id: z.string().uuid().optional(),
      preview_token: z.string().uuid().optional(),
    })
    .strict()
    .parse(body);
  const id = randomUUID();
  await transaction(async (c) => {
    const e = (
      await c.query(
        "SELECT * FROM customer_environments WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [b.environment_id, workspace],
      )
    ).rows[0];
    if (!e) throw new HttpError(404, "Umgebung fehlt.");
    const job = {
      environment_id: e.id,
      generation: e.generation,
      requested_by: actor,
      parent_session: parent,
      tool: "environment_checkpoint",
      args: b,
      created_at: new Date().toISOString(),
    };
    await authorizeCheckpointJob(c, job);
    if (b.action === "restore") await requireRestoreReview(c, workspace, null);
    await c.query(
      "INSERT INTO environment_tool_calls(id,environment_id,generation,permission,tool,args,requested_by,parent_session) VALUES($1,$2,$3,'files','environment_checkpoint',$4,$5,$6)",
      [id, e.id, e.generation, JSON.stringify(b), actor, parent],
    );
    await audit(c, actor, `environment.checkpoint.${b.action}`, e.id);
  });
  for (let i = 0; i < 200; i++) {
    const job = (
      await pool.query(
        "SELECT status,result FROM environment_tool_calls WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (job.status === "done") return job.result;
    if (["canceled", "uncertain"].includes(job.status))
      throw new HttpError(
        409,
        "Aktion unterbrochen. Projektstand prüfen; nicht ungeprüft wiederholen.",
      );
    await new Promise((r) => setTimeout(r, 200));
  }
  await pool.query(
    "UPDATE environment_tool_calls SET status=CASE WHEN status='queued' THEN 'canceled' ELSE 'uncertain' END WHERE id=$1 AND status IN('queued','running')",
    [id],
  );
  throw new HttpError(
    409,
    "Sicherungskanal nicht rechtzeitig bestätigt. Umgebung und Controller prüfen.",
  );
}
