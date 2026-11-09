import { createHash } from "node:crypto";

export interface ToolOutcome {
  tool_name: string;
  arguments_hash: string;
  outcome_hash: string;
  failed: boolean;
}
function ordered(value: unknown, omitMetadata = false): unknown {
  if (Array.isArray(value)) return value.map((v) => ordered(v, omitMetadata));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(
          ([key]) =>
            !omitMetadata ||
            ![
              "duration_ms",
              "elapsed_ms",
              "timestamp",
              "request_id",
              "session_id",
              "pid",
            ].includes(key),
        )
        .map(([key, v]) => [key, ordered(v, omitMetadata)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex");
export const toolArgumentsHash = (args: unknown) => digest(ordered(args));
export function toolOutcomeHash(name: string, result: string) {
  let value: unknown = result;
  try {
    value = JSON.parse(result);
  } catch {
    /* Plain output stays byte-for-byte significant. */
  }
  if (
    name === "delegate_task" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const { task_id: _taskId, ...rest } = value as Record<string, unknown>;
    value = rest;
  }
  return digest(ordered(value, true));
}
// Syntactic detection only. Changing meaningful arguments or outcomes counts as progress.
// Volatile transport metadata does not make an otherwise identical result new work.
export function detectToolLoop(
  history: ToolOutcome[],
  name: string,
  argsHash: string,
) {
  const records = history.slice(-30);
  const last = records.at(-1);
  if (!last) return null;
  let streak = 0;
  for (const row of [...records].reverse()) {
    if (
      row.tool_name !== name ||
      row.arguments_hash !== argsHash ||
      row.outcome_hash !== last.outcome_hash
    )
      break;
    streak++;
  }
  if (streak >= (last.failed ? 2 : 3))
    return {
      kind: last.failed ? "identical_errors" : "no_progress",
      count: streak,
    };
  // A/B/A/B followed by A, with unchanged results, is a bounded ping-pong loop.
  const tail = records.slice(-4);
  if (
    tail.length === 4 &&
    tail[0].tool_name === name &&
    tail[0].arguments_hash === argsHash &&
    tail[0].tool_name === tail[2].tool_name &&
    tail[0].arguments_hash === tail[2].arguments_hash &&
    tail[0].outcome_hash === tail[2].outcome_hash &&
    tail[1].tool_name === tail[3].tool_name &&
    tail[1].arguments_hash === tail[3].arguments_hash &&
    tail[1].outcome_hash === tail[3].outcome_hash
  )
    return { kind: "ping_pong", count: 4 };
  return null;
}
