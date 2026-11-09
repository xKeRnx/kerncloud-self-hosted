import { parseToolArguments } from "./core/autonomy.ts";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Message, Task } from "./core/types.ts";
import { modelResultProblem } from "./core/model-result.ts";
import {
  maxWorkerModelWaitMs,
  recoveryCount,
  recoveryLimit,
  mayRetryModel,
} from "./core/agent-recovery.ts";
class WorkerApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public retryable = false,
    public retryAfter = 1,
  ) {
    super(message);
  }
}
const platform = process.env.PLATFORM_URL ?? "http://localhost:3100";
const workerId = process.env.WORKER_ID ?? randomUUID();
const concurrency = Math.min(
  8,
  Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2)),
);
let stopping = false;
async function api(path: string, body: unknown) {
  const response = await fetch(`${platform}/api/worker/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WORKER_TOKEN ?? ""}`,
      ...(["model", "tool"].includes(path)
        ? { "x-kc-worker-stream": "keepalive" }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(
      ["model", "tool"].includes(path) ? maxWorkerModelWaitMs : 115000,
    ),
  });
  const data = await response.json();
  if (!response.ok || data.worker_error) {
    const fault = data.worker_error ?? data;
    throw new WorkerApiError(
      [fault.error ?? `HTTP ${response.status}`, ...(fault.fields ?? [])].join(
        "\n",
      ),
      fault.status ?? response.status,
      fault.code,
      fault.retryable,
      fault.retryAfter,
    );
  }
  return data;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function execute(task: Task) {
  const lease = task.lease_token!;
  let messages: Message[] = task.messages ?? [];
  let pendingModelWaits = 0;
  const beat = setInterval(() => {
    void api("heartbeat", { workerId, taskId: task.id, lease }).catch(
      () => undefined,
    );
  }, 15000);
  try {
    const ctx = await api("context", { taskId: task.id, lease });
    if (!messages.length)
      messages = [
        { role: "system", content: ctx.system },
        { role: "user", content: task.instructions },
      ];
    else
      messages = messages.map((m, i) =>
        i === 0 && m.role === "system" ? { ...m, content: ctx.system } : m,
      );
    await api("checkpoint", { taskId: task.id, lease, messages });
    async function needInput(question: string) {
      const assistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      for (const call of assistant?.tool_calls ?? [])
        if (!messages.some((m) => m.tool_call_id === call.id))
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Nicht ausgeführt: Aufgabe wartet auf Prüfung.",
          });
      await api("checkpoint", {
        taskId: task.id,
        lease,
        messages,
        inputRequired: question,
      });
    }
    // Tool calls are journaled by the platform. Recover unprocessed calls from a saved assistant message.
    for (let turn = 0; turn < 500 && !stopping; turn++) {
      const assistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      const pending =
        assistant?.tool_calls?.filter(
          (call) => !messages.some((m) => m.tool_call_id === call.id),
        ) ?? [];
      if (pending.length) {
        for (const call of pending) {
          const parsed = parseToolArguments(call.function.arguments);
          if (parsed.error) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(parsed.error),
              recovery_code: "TOOL_CORRECTION",
            });
            await api("checkpoint", { taskId: task.id, lease, messages });
            if (recoveryCount(messages) >= recoveryLimit) {
              await needInput(
                "Ungültige Werkzeugantworten trotz begrenzter Reparaturversuche. Dateien bleiben erhalten.",
              );
              return;
            }
            continue;
          }
          const args = parsed.args;
          let output = await api("tool", {
            taskId: task.id,
            lease,
            callId: call.id,
            name: call.function.name,
            args,
            messages,
            mapping: ctx.mapping,
          });
          if (output.await_process) {
            const process = output.await_process;
            let log = JSON.parse(output.result).output ?? "";
            for (
              let poll = 0;
              output.await_process && poll < 100 && !stopping;
              poll++
            ) {
              output = await api("tool", {
                taskId: task.id,
                lease,
                callId: `${call.id}:wait:${poll}`,
                name: "environment_process",
                args: { ...process, action: "wait" },
                messages,
                mapping: ctx.mapping,
              });
              const state = JSON.parse(output.result);
              log = (log + (state.output ?? "")).slice(-20000);
              process.cursor = state.cursor ?? process.cursor;
              if (
                output.requiresReview ||
                output.isError ||
                state.status !== "running"
              ) {
                output = {
                  ...output,
                  result: JSON.stringify({ ...state, output: log }),
                };
                break;
              }
            }
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: output.result,
            ...(output.isError ? { recovery_code: "TOOL_CORRECTION" } : {}),
          });
          if (output.yield) return;
          if (
            output.requiresReview ||
            recoveryCount(messages) >= recoveryLimit
          ) {
            await needInput(
              output.requiresReview
                ? (output.reviewMessage ??
                    "Eine bereits angestoßene externe Aktion hat kein bestätigtes Ergebnis. Bitte deren Zustand prüfen, bevor du die Fortsetzung freigibst.")
                : "Mehrere automatische Korrekturversuche waren erfolglos. Bitte Voraussetzungen oder Auftragsumfang prüfen und weitere Informationen senden.",
            );
            return;
          }
          await api("checkpoint", { taskId: task.id, lease, messages });
        }
        continue;
      }
      if (ctx.automation?.mode?.startsWith("pipeline")) {
        const failure = messages.some(
          (m) => m.role === "tool" && m.recovery_code,
        );
        if (!failure) {
          const completed = await api("checkpoint", {
            taskId: task.id,
            lease,
            messages,
            finish:
              "Nutzerfreigegebene Pipeline abgeschlossen; keine Modellaufrufe.",
          });
          if (completed.needsValidation)
            await needInput(completed.needsValidation);
          return;
        }
        if (ctx.automation.mode === "pipeline") {
          await needInput(
            "Automatische Pipeline hat einen Fehler gemeldet. Kein KI-Aufruf freigegeben; Ergebnis prüfen.",
          );
          return;
        }
      }
      let message: Message;
      try {
        message = await api("model", {
          taskId: task.id,
          lease,
          messages,
          tools: ctx.tools,
        });
      } catch (error) {
        if (
          error instanceof WorkerApiError &&
          error.code === "MODEL_COOLDOWN"
        ) {
          await api("defer", {
            taskId: task.id,
            lease,
            seconds: error.retryAfter,
            messages,
          });
          return;
        }
        if (error instanceof WorkerApiError && error.code === "MODEL_PENDING") {
          if (++pendingModelWaits > 30) {
            await needInput(
              "Der vorherige Modellaufruf ist noch nicht bestätigt. Bitte Anbieter und Verarbeitung prüfen; kein zusätzlicher KI-Aufruf wurde gestartet.",
            );
            return;
          }
          await delay(2000);
          continue;
        }
        if (
          error instanceof WorkerApiError &&
          error.code === "INPUT_REQUIRED"
        ) {
          await needInput(error.message);
          return;
        }
        if (error instanceof WorkerApiError && error.retryable) {
          if (
            recoveryCount(messages) >= recoveryLimit ||
            (error.code !== "MODEL_FALLBACK" && !mayRetryModel(messages))
          ) {
            await needInput(
              `${error.message}\nDer begrenzte automatische Wiederholungsversuch ist ausgeschöpft. Bitte Modell, Zeitlimit oder Anbieter prüfen.`,
            );
            return;
          }
          messages.push({
            role: "user",
            content: `Technischer Modellfehler: ${error.message}\nSetze den Auftrag mit einem kürzeren, gezielten Schritt fort. Für diesen Korrekturversuch gilt ein kleineres Ausgabebudget von höchstens 16.384 Tokens einschließlich Reasoning. Speichere kleine vollständige Ergebnisse statt eines großen Gesamtschritts. Keine externen Aktionen aus früheren Aufrufen wiederholen.`,
            recovery_code: error.code ?? "MODEL_RETRY",
          });
          await api("checkpoint", { taskId: task.id, lease, messages });
          await delay(Math.min(30, Math.max(1, error.retryAfter)) * 1000);
          continue;
        }
        throw error;
      }
      messages.push(message);
      pendingModelWaits = 0;
      const problem = modelResultProblem(message);
      if (problem) throw new Error(problem);
      if (!message.tool_calls?.length) {
        const final = await api("checkpoint", {
          taskId: task.id,
          lease,
          messages,
          finish: message.content,
        });
        if (final?.needsValidation) {
          messages.push({
            role: "user",
            content: final.needsValidation,
            recovery_code: "VALIDATION_REQUIRED",
          });
          await api("checkpoint", { taskId: task.id, lease, messages });
          if (recoveryCount(messages) >= recoveryLimit) {
            await needInput(
              "Aktuelle Dateien konnten nicht erfolgreich geprüft werden; Reparaturbudget ausgeschöpft.",
            );
            return;
          }
          continue;
        }
        return;
      }
      await api("checkpoint", { taskId: task.id, lease, messages });
    }
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) {
      console.error(
        `[Worker] Aufgabe ${task.id}: Verbindung unterbrochen; Wiederaufnahme erfolgt über das gespeicherte Protokoll nach Ablauf der Worker-Lease.`,
      );
      return;
    }
    console.error(
      `[Worker] Aufgabe ${task.id}: ${error instanceof Error ? error.message : "Fehler"}`,
    );
    await api("checkpoint", {
      taskId: task.id,
      lease,
      messages,
      error:
        error instanceof Error ? error.message : "Ausführung fehlgeschlagen",
    }).catch(() => undefined);
  } finally {
    clearInterval(beat);
  }
}
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
console.log(
  `[Worker] ${hostname()} · ${concurrency} Ausführungsplätze · ${platform}`,
);
let active = 0,
  lastHeartbeat = 0,
  lastMaintenance = 0,
  maintaining = false;
while (!stopping) {
  try {
    if (
      process.env.WORKER_MAINTENANCE !== "false" &&
      !maintaining &&
      Date.now() - lastMaintenance > 5000
    ) {
      lastMaintenance = Date.now();
      maintaining = true;
      void api("maintenance", { workerId })
        .catch(() => undefined)
        .finally(() => {
          maintaining = false;
        });
    }
    if (Date.now() - lastHeartbeat > 10000) {
      await api("register", {
        id: workerId,
        name: `${hostname()} · ${workerId.slice(0, 6)}`,
        concurrency,
      });
      lastHeartbeat = Date.now();
    }
    if (active < concurrency) {
      const { task } = await api("claim", { workerId });
      if (task) {
        active++;
        void execute(task).finally(() => active--);
        continue;
      }
    }
  } catch (error) {
    console.error(
      `[Worker] Verbindung: ${error instanceof Error ? error.message : "nicht erreichbar"}`,
    );
  }
  await delay(1500);
}
while (active > 0 || maintaining) await delay(250);
