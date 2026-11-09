import { createHash } from "node:crypto";
import type { Message } from "./types.ts";

export const starterTools = new Set([
  "save_artifact",
  "read_artifact",
  "patch_artifact",
  "validate_artifact",
  "finish_task",
  "propose_skill",
  "request_input",
  "tool_catalog",
  "tool_search",
]);
export function activeTools<T extends { function?: { name: string } }>(
  all: T[],
  loaded: string[] = [],
) {
  const names = new Set([...starterTools, ...loaded]);
  return all.filter((t) => names.has(t.function?.name ?? ""));
}
export function parseToolArguments(raw: string) {
  try {
    const args = JSON.parse(raw);
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new Error();
    return { args };
  } catch {
    return {
      error: {
        ok: false,
        code: "INVALID_TOOL_JSON",
        executed: false,
        guidance:
          "Werkzeugargumente sind unvollständiges/ungültiges JSON. Nichts ausgeführt. Erzeuge einen kleinen vollständigen korrigierten Aufruf anhand des Schemas; keine ganze Datei erneut schreiben. Bereits erfolgreiche Aufrufe nicht wiederholen.",
      },
    };
  }
}
// A deterministic, recoverable provider view. No LLM call, new task or permission.
export function workingState(messages: Message[]) {
  const replies = new Map(
    messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, m]),
  );
  const steps: {
    message_index: number;
    tool: string;
    result: string;
    failed: boolean;
  }[] = [];
  for (const [index, m] of messages.entries())
    for (const call of m.tool_calls ?? []) {
      const reply = replies.get(call.id);
      if (!reply) continue;
      let value: any;
      try {
        value = JSON.parse(reply.content ?? "null");
      } catch {
        value = null;
      }
      const failed = Boolean(
        reply.recovery_code || value?.ok === false || value?.isError,
      );
      const result =
        value && typeof value === "object"
          ? JSON.stringify(
              Object.fromEntries(
                Object.entries(value).filter(([k]) =>
                  [
                    "artifact_id",
                    "previous_artifact_id",
                    "name",
                    "ok",
                    "passed",
                    "code",
                    "error",
                    "guidance",
                    "fingerprint",
                    "report_id",
                    "completed",
                  ].includes(k),
                ),
              ),
            )
          : (reply.content ?? "").slice(0, 180);
      steps.push({
        message_index: index,
        tool: call.function.name,
        result: result.slice(0, 600),
        failed,
      });
    }
  const latest = steps.slice(-8);
  return {
    version: 1,
    steps: latest,
    digest: createHash("sha256").update(JSON.stringify(latest)).digest("hex"),
    guidance:
      "Arbeitsstand aus Originalbelegen; keine neuen Rechte. Fehler gezielt beheben und dieselbe aktuelle Dateiversion erneut prüfen. Originale über read_task_history lesen. Keine bereits erfolgreiche Arbeit wiederholen.",
  };
}
