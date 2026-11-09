import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { HttpError } from "./auth.ts";
// Operator-authored continuation metadata. Original goals, events and journals are never rewritten.
const input = z
  .object({
    kind: z.literal("operator_repair_brief"),
    parent_task_id: z.string().uuid(),
    source_goal_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    after_event_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    summary: z.string().trim().min(40).max(2000),
    allowed_tools: z
      .array(
        z.enum([
          "read_artifact",
          "save_artifact",
          "patch_artifact",
          "propose_skill",
          "finish_task",
          "request_input",
        ]),
      )
      .min(1)
      .max(6),
  })
  .strict();
export async function contextHandoff(c: PoolClient, task: any, run: any) {
  const raw = task.context_state?.handoff;
  if (!raw) return null;
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(409, "Ungültiges Fortsetzungsbriefing.");
  const h = parsed.data;
  if (
    h.parent_task_id !== task.parent_id ||
    h.source_goal_sha256 !== createHash("sha256").update(run.goal).digest("hex")
  )
    throw new HttpError(
      409,
      "Fortsetzungsbriefing passt nicht zum unveränderten Hauptauftrag.",
    );
  const origin = await c.query(
    "SELECT 1 FROM tasks p JOIN events e ON e.run_id=p.run_id AND e.workspace_id=p.workspace_id JOIN tasks child ON child.id=$5 AND child.parent_id=p.id AND child.run_id=p.run_id WHERE p.id=$1 AND p.run_id=$2 AND p.workspace_id=$3 AND e.id=$4 AND e.created_at<=child.created_at",
    [task.parent_id, task.run_id, task.workspace_id, h.after_event_id, task.id],
  );
  if (!origin.rowCount)
    throw new HttpError(
      409,
      "Fortsetzungsbriefing verweist auf fremde oder spätere Ereignisse.",
    );
  return h;
}
