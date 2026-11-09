import { z } from "zod";
import { HttpError } from "./auth.ts";
import { transaction, pool } from "./db.ts";
import {
  detectToolLoop,
  toolArgumentsHash,
  toolOutcomeHash,
  type ToolOutcome,
} from "../core/agent-loops.ts";
import { lockTask, event } from "./store.ts";
import { toolStep } from "./engine.ts";
import { redact } from "./security.ts";
import { autoValidatePatch } from "./artifact-validation.ts";

export function workerError(error: unknown) {
  if (error instanceof HttpError)
    return {
      error: redact(error.message),
      status: error.status,
      ...error.details,
    };
  if (error instanceof z.ZodError)
    return {
      error: "Werkzeugparameter sind ungültig.",
      status: 400,
      code: "INVALID_ARGUMENTS",
      fields: error.issues
        .slice(0, 10)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  return {
    error: "Interner Ausführungsfehler. Bitte Serverprotokoll prüfen.",
    status: 500,
    code: "INTERNAL_ERROR",
    retryable: false,
  };
}
export async function guardedToolStep(
  ...parameters: Parameters<typeof toolStep>
) {
  const [taskId, lease, callId, name, args] = parameters;
  const operationId = `${taskId}:${callId}`;
  const argsHash = toolArgumentsHash(args);
  const blocked = await transaction(async (c) => {
    const { task } = await lockTask(c, taskId, lease);
    const existing = (
      await c.query("SELECT status,result FROM operations WHERE id=$1", [
        operationId,
      ])
    ).rows[0];
    if (existing) return existing.status === "done" ? existing.result : null;
    const history = (
      await c.query(
        "SELECT o.tool_name,o.arguments_hash,o.outcome_hash,o.failed FROM operations o JOIN tasks t ON t.id=o.task_id WHERE t.run_id=$1 AND o.outcome_hash IS NOT NULL ORDER BY o.recorded_at DESC,o.id DESC LIMIT 60",
        [task.run_id],
      )
    ).rows.reverse() as ToolOutcome[];
    const loop =
      name === "environment_process" && (args as any)?.action === "wait"
        ? null
        : detectToolLoop(history, name, argsHash);
    if (!loop) return null;
    const interventions = Number(
      (
        await c.query(
          "SELECT coalesce(sum(loop_interventions),0) n FROM tasks WHERE run_id=$1",
          [task.run_id],
        )
      ).rows[0].n,
    );
    const review = interventions >= 1;
    const output = {
      result: JSON.stringify({
        ok: false,
        code: "NO_PROGRESS",
        executed: false,
        pattern: loop.kind,
        guidance: review
          ? "Erneute Schleife ohne Fortschritt. Auftrag pausiert; bitte Arbeitsstand und Voraussetzungen prüfen."
          : "Identische Aufrufe liefern keinen neuen Fortschritt. Diese Aktion wurde nicht ausgeführt. Prüfe den gespeicherten Arbeitsstand und wähle einen anderen erlaubten Ansatz; bereits erfolgreiche Schritte nicht wiederholen.",
      }),
      yield: false,
      isError: true,
      requiresReview: review,
      reviewMessage:
        "Mehrere Ansätze wiederholen sich ohne Fortschritt. Der Auftrag wurde angehalten, um weitere Kosten zu vermeiden. Bitte Arbeitsstand und Voraussetzungen prüfen.",
    };
    await c.query(
      "INSERT INTO operations(id,task_id,status,result) VALUES($1,$2,'done',$3)",
      [operationId, taskId, JSON.stringify(output)],
    );
    await c.query(
      "UPDATE tasks SET loop_interventions=loop_interventions+1 WHERE id=$1",
      [taskId],
    );
    await event(
      c,
      task.workspace_id,
      task.run_id,
      task.agent_id,
      "recovery",
      review
        ? "Erneute Schleife gestoppt, um weiteren Verbrauch zu vermeiden."
        : "Schleife ohne Fortschritt erkannt. Agent erhält einen begrenzten Versuch mit einem anderen Ansatz.",
    );
    return output;
  });
  if (blocked) return blocked;
  try {
    let output = await toolStep(...parameters);
    if (name === "patch_artifact")
      output = await autoValidatePatch(taskId, lease, callId, output);
    await record(output);
    return output;
  } catch (error) {
    const correctable =
      error instanceof z.ZodError ||
      (error instanceof HttpError &&
        [400, 403, 404, 409].includes(error.status));
    const output = await transaction(async (c) => {
      const { task } = await lockTask(c, taskId, lease);
      const operationId = `${taskId}:${callId}`;
      const operation = (
        await c.query("SELECT * FROM operations WHERE id=$1 FOR UPDATE", [
          operationId,
        ])
      ).rows[0];
      if (operation?.status === "done") return operation.result;
      const uncertain = Boolean(operation);
      if (!uncertain && !correctable) throw error;
      const detail = workerError(error);
      const output = {
        result: JSON.stringify({
          ok: false,
          error: detail.error,
          code: uncertain
            ? "EXTERNAL_RESULT_UNKNOWN"
            : (detail.code ?? "TOOL_REJECTED"),
          fields: "fields" in detail ? detail.fields : undefined,
          executed: uncertain ? "unknown" : false,
          guidance: uncertain
            ? "Ergebnis einer bereits angestoßenen Aktion ist unklar. Nicht erneut ausführen. Nutzerprüfung erforderlich."
            : "Parameter anhand des Werkzeugschemas korrigieren oder einen erlaubten anderen Weg wählen. Keine Freigaben selbst erteilen. Wenn list_environments leer ist, können eigenständige HTML-/Textdateien direkt mit save_artifact erstellt werden.",
        }),
        yield: false,
        isError: true,
        requiresReview: uncertain,
      };
      if (!uncertain)
        await c.query(
          "INSERT INTO operations(id,task_id,status,result) VALUES($1,$2,'done',$3)",
          [operationId, taskId, JSON.stringify(output)],
        );
      await event(
        c,
        task.workspace_id,
        task.run_id,
        task.agent_id,
        "recovery",
        `${name}: ${uncertain ? "Unklare Aktion benötigt Prüfung" : detail.error}`,
      );
      return output;
    });
    await record(output);
    return output;
  }
  async function record(output: { result: string; isError?: boolean }) {
    let failed = Boolean(output.isError);
    try {
      const parsed = JSON.parse(output.result);
      failed ||= parsed?.ok === false || parsed?.isError === true;
    } catch {}
    await pool.query(
      "UPDATE operations SET tool_name=$2,arguments_hash=$3,outcome_hash=$4,failed=$5,recorded_at=now() WHERE id=$1 AND outcome_hash IS NULL AND status='done'",
      [
        operationId,
        name,
        argsHash,
        toolOutcomeHash(name, output.result),
        failed,
      ],
    );
  }
}
// Leading JSON whitespace keeps long worker requests alive without buffering model text in the response.
export function keepAliveWorkerResult(
  work: Promise<unknown>,
  signal: AbortSignal,
) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval>,
    closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const finish = (value: unknown) => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        signal.removeEventListener("abort", abort);
        try {
          controller.enqueue(encoder.encode(JSON.stringify(value)));
          controller.close();
        } catch {}
      };
      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      controller.enqueue(encoder.encode("\n"));
      timer = setInterval(() => {
        if (!closed)
          try {
            controller.enqueue(encoder.encode("\n"));
          } catch {
            abort();
          }
      }, 10000);
      timer.unref();
      signal.addEventListener("abort", abort, { once: true });
      work.then(finish, (error) =>
        finish({ worker_error: workerError(error) }),
      );
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
