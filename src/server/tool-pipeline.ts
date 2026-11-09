import {
  pipelineInput,
  resolveStepArgs,
  selectStepResult,
} from "../core/tool-pipeline.ts";
import { toolArgumentsHash } from "../core/agent-loops.ts";
import { pool, transaction } from "./db.ts";
import { lockTask } from "./store.ts";
import { HttpError } from "./auth.ts";
import type { Message } from "../core/types.ts";
export async function runToolPipeline(
  taskId: string,
  lease: string,
  callId: string,
  args: unknown,
  messages: Message[],
  mapping: Record<string, { connectionId: string; toolName: string }>,
): Promise<{
  result: string;
  yield: boolean;
  isError?: boolean;
  requiresReview?: boolean;
}> {
  const input = pipelineInput.parse(args),
    id = `${taskId}:${callId}`,
    hash = toolArgumentsHash(input);
  if (Buffer.byteLength(JSON.stringify(input)) > 120000)
    throw new HttpError(400, "Pipeline zu groß.");
  const prior = await transaction(async (c) => {
    await lockTask(c, taskId, lease);
    const old = (
      await c.query("SELECT * FROM operations WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (old && old.arguments_hash !== hash)
      throw new HttpError(409, "Pipeline-ID hat andere Parameter.");
    if (!old)
      await c.query(
        "INSERT INTO operations(id,task_id,tool_name,arguments_hash) VALUES($1,$2,'tool_pipeline',$3)",
        [id, taskId, hash],
      );
    return old;
  });
  if (prior?.status === "done") return prior.result;
  const { guardedToolStep } = await import("./worker-recovery.ts");
  const results: any[] = [],
    summary: any[] = [];
  let review = false,
    failed = false;
  for (const [index, step] of input.steps.entries()) {
    let resolved;
    try {
      resolved = resolveStepArgs(step.args, results);
    } catch {
      throw new HttpError(
        400,
        "Pipeline-Verweis ungültig; abgeschlossene Schritte bleiben journalisiert.",
      );
    }
    const output = await guardedToolStep(
      taskId,
      lease,
      `${callId}:step:${index}`,
      step.tool,
      resolved,
      messages,
      mapping,
    );
    let value: any;
    try {
      value = JSON.parse(output.result);
    } catch {
      value = { text: output.result };
    }
    results.push(value);
    summary.push({
      step: index,
      tool: step.tool,
      result: selectStepResult(value, step.select),
      receipt: `${taskId}:${callId}:step:${index}`,
    });
    failed = !!output.isError || value?.ok === false || value?.passed === false;
    review = !!(output as any).requiresReview;
    if ((output as any).await_process) {
      failed = true;
      summary.push({
        guidance:
          "Prozess läuft; environment_process wait mit process_id verwenden. Befehl nicht erneut starten.",
      });
    }
    if (failed || review) break;
  }
  // Full receipts stay in the operations journal; the model gets selected results only.
  let content = JSON.stringify({
    ok: !failed,
    steps: summary,
    completed_steps: results.length,
  });
  if (content.length > 24000)
    content = JSON.stringify({
      ok: !failed,
      completed_steps: results.length,
      receipts: summary.map((s) => s.receipt).filter(Boolean),
      last_result: JSON.stringify(summary.at(-1)).slice(-16000),
      truncated: true,
      guidance: "Vollständige Schrittbelege über read_pipeline lesen.",
    });
  const output = {
    result: content,
    yield: false,
    isError: failed,
    requiresReview: review,
  };
  await transaction(async (c) => {
    await lockTask(c, taskId, lease);
    await c.query("UPDATE operations SET status='done',result=$2 WHERE id=$1", [
      id,
      JSON.stringify(output),
    ]);
  });
  return output;
}
