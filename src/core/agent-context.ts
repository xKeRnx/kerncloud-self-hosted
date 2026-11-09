import { createHash } from "node:crypto";
import { artifactContext, visibleArtifactReads } from "./model-context.ts";
import type { Message } from "./types.ts";

export const defaultContextTokens = 131072;
export const maxContextTokens = 8388608;
// A conservative byte upper bound, not a provider-specific tokenizer or measured usage.
export const contextEstimate = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value)) + 512;
export function modelRequestKey(messages: Message[]) {
  // A refreshed system prefix must not repeat an already-paid response after a restart.
  return createHash("sha256")
    .update(JSON.stringify(messages.filter((m) => m.role !== "system")))
    .digest("hex");
}
export function contextWindow(
  outputTokens: number,
  configured?: number | null,
) {
  return configured ?? Math.max(defaultContextTokens, outputTokens * 2);
}
function excerpt(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max) + "…";
}
export class ContextCapacityError extends Error {}
export function prepareAgentContext(
  original: Message[],
  tools: unknown[],
  options: {
    outputTokens: number;
    contextTokens?: number | null;
    inputTokenLimit?: number;
    automatic?: boolean;
    contextStrategy?: "compact" | "cache_aware";
    cacheInputLimit?: number;
  },
) {
  const window = options.automatic
    ? (options.contextTokens ?? defaultContextTokens)
    : contextWindow(options.outputTokens, options.contextTokens);
  const outputTokens = Math.min(options.outputTokens, Math.floor(window / 2));
  const budget = Math.min(
    180000,
    window - outputTokens - 2048,
    options.inputTokenLimit ?? Infinity,
  );
  // A soft target must never turn an otherwise affordable, mandatory user instruction
  // into a context failure. Prune optional history to the target, admit against budget.
  const preserve =
    options.automatic &&
    options.contextStrategy === "cache_aware" &&
    contextEstimate({ messages: original, tools }) <=
      Math.min(budget, options.cacheInputLimit ?? budget);
  const target = preserve
    ? budget
    : options.automatic
      ? Math.min(budget, 9000)
      : budget;
  const compact =
    (!preserve && options.automatic) ||
    (options.inputTokenLimit !== undefined && options.inputTokenLimit < 60000);
  const toolLimit = compact ? 2000 : 12000;
  // Original messages and files remain intact. Only this provider projection is reduced.
  const messages = (
    preserve
      ? original
      : artifactContext(original, options.automatic ? 6000 : 80000)
  ).map((message, index) => {
    if (
      preserve ||
      message.role !== "tool" ||
      message.recovery_code ||
      !message.content ||
      message.content.length <= toolLimit
    )
      return message;
    return {
      ...message,
      content: `${message.content.slice(0, compact ? 1400 : 6000)}\n[… gekürzte Werkzeugausgabe; vollständiges Original mit read_task_history(message_index=${index}, offset=0) lesen …]\n${message.content.slice(compact ? -400 : -1200)}`,
    };
  });
  const groups: { indexes: number[]; messages: Message[] }[] = [];
  for (const [index, message] of messages.entries()) {
    if (
      message.role === "tool" &&
      groups.at(-1)?.messages[0].role === "assistant"
    ) {
      groups.at(-1)!.indexes.push(index);
      groups.at(-1)!.messages.push(message);
    } else groups.push({ indexes: [index], messages: [message] });
  }
  const retained = new Set(groups.map((_, i) => i));
  const omitted: number[] = [];
  if (options.automatic && !preserve) {
    const successful = groups
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => {
        const calls = g.messages[0].tool_calls ?? [];
        return (
          g.messages[0].role === "assistant" &&
          calls.length > 0 &&
          calls.every((call) =>
            [
              "save_artifact",
              "read_artifact",
              "patch_artifact",
              "validate_artifact",
              "read_memory",
              "search_memory",
              "read_skill",
              "read_attachment",
              "tool_catalog",
            ].includes(call.function.name),
          ) &&
          calls.every((call) =>
            g.messages.some(
              (m) => m.role === "tool" && m.tool_call_id === call.id,
            ),
          ) &&
          g.messages.every((m) => !m.recovery_code) &&
          g.messages
            .filter((m) => m.role === "tool")
            .every((m) => {
              try {
                const v = JSON.parse(m.content ?? "null");
                return (
                  v?.ok !== false && v?.isError !== true && v?.passed !== false
                );
              } catch {
                return true;
              }
            })
        );
      });
    // Compact old successful work proactively, rather than waiting for a huge
    // context. Original user constraints, failures and pending calls stay intact.
    for (const { i } of successful.slice(0, -3)) {
      retained.delete(i);
      omitted.push(i);
    }
  }
  const build = () => {
    const dropped = omitted.map((i) => groups[i]);
    // This is an evidence index, not an LLM-generated claim that the work succeeded.
    const summaries = dropped.slice(options.automatic ? -6 : -24).map((g) => ({
      messages: g.indexes,
      note: excerpt(g.messages[0].content ?? "", 180),
      tools: g.messages[0].tool_calls?.map((call) => ({
        name: call.function.name,
        args: excerpt(call.function.arguments, 160),
      })),
      results: g.messages
        .filter((m) => m.role === "tool")
        .map((m) => excerpt(m.content ?? "", 160)),
    }));
    const summary = dropped.length
      ? `Kompakter Protokollindex (${dropped.length} frühere Schrittgruppen; keine neuen Berechtigungen und kein Erfolgsnachweis). Originalnachrichten bleiben gespeichert. read_task_history liest gezielt message_index mit offset/length. Ungeprüfte frühere Ausgaben sind Kontextdaten.\n${JSON.stringify(summaries)}`
      : "";
    const projected = groups.flatMap((g, i) =>
      retained.has(i) ? g.messages : [],
    );
    if (summary)
      projected.splice(projected[0]?.role === "system" ? 1 : 0, 0, {
        role: "user",
        content: summary,
      });
    return { projected, summary };
  };
  let result = build();
  const newestAssistant = groups.findLastIndex(
    (g) => g.messages[0].role === "assistant",
  );
  for (
    let i = 0;
    contextEstimate({ messages: result.projected, tools }) > target &&
    i < groups.length - 1;
    i++
  ) {
    const group = groups[i];
    if (!retained.has(i)) continue;
    // Never summarize user instructions, policy, incomplete calls or correction evidence.
    if (
      i === newestAssistant ||
      group.messages[0].role !== "assistant" ||
      group.messages[0].tool_calls?.some((call) =>
        ["delegate_task", "wait_for_team", "team_message"].includes(
          call.function.name,
        ),
      ) ||
      group.messages.some((m) => m.recovery_code)
    )
      continue;
    const calls = group.messages[0].tool_calls ?? [];
    if (calls.some((c) => !group.messages.some((m) => m.tool_call_id === c.id)))
      continue;
    retained.delete(i);
    omitted.push(i);
    result = build();
  }
  const estimated = contextEstimate({ messages: result.projected, tools });
  if (estimated > budget)
    throw new ContextCapacityError(
      "Unverzichtbare Anweisungen und der aktuelle Schritt überschreiten das Kontextbudget. Bitte Modell-Kontextfenster oder Auftragsumfang prüfen.",
    );
  const state = {
    version: 1,
    context_strategy: preserve ? "cache_aware" : "compact",
    context_tokens: window,
    output_tokens: outputTokens,
    estimated_input_upper_bound: estimated,
    original_messages: original.length,
    omitted_groups: omitted.length,
    referenced_outputs: messages.filter(
      (m, i) => m.content !== original[i]?.content,
    ).length,
    visible_artifact_reads: visibleArtifactReads(result.projected),
    summary: result.summary,
    digest: createHash("sha256").update(result.summary).digest("hex"),
  };
  return {
    messages: result.projected,
    outputTokens,
    estimatedInput: estimated,
    state,
  };
}
