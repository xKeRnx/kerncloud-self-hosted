import type { Message } from "./types.ts";
export const engineKinds = [
  "openai-chat",
  "openai-responses",
  "anthropic",
] as const;
export type EngineKind = (typeof engineKinds)[number];
export function engineRequest(
  kind: EngineKind,
  p: {
    model: string;
    messages: Message[];
    tools: any[];
    output: number;
    secret: string;
    stream: boolean;
    reasoning: object;
  },
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (kind === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (p.secret) headers["x-api-key"] = p.secret;
    const messages: any[] = [];
    for (const m of p.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool")
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: m.content ?? "",
            },
          ],
        });
      else {
        const content: any[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const c of m.tool_calls ?? [])
          content.push({
            type: "tool_use",
            id: c.id,
            name: c.function.name,
            input: JSON.parse(c.function.arguments),
          });
        if (content.length) messages.push({ role: m.role, content });
      }
    }
    return {
      path: "/messages",
      headers,
      body: {
        model: p.model,
        max_tokens: p.output,
        system: p.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content ?? "")
          .join("\n"),
        messages,
        tools: p.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        })),
        stream: false,
      },
    };
  }
  if (p.secret) headers.Authorization = "Bearer " + p.secret;
  if (kind === "openai-responses") {
    const input: any[] = [];
    for (const m of p.messages) {
      if (m.role === "tool")
        input.push({
          type: "function_call_output",
          call_id: m.tool_call_id,
          output: m.content ?? "",
        });
      else {
        if (m.engine_state?.model === p.model)
          input.push(...m.engine_state.reasoning);
        if (m.content) input.push({ role: m.role, content: m.content });
        for (const c of m.tool_calls ?? [])
          input.push({
            type: "function_call",
            call_id: c.id,
            name: c.function.name,
            arguments: c.function.arguments,
          });
      }
    }
    return {
      path: "/responses",
      headers,
      body: {
        model: p.model,
        input,
        tools: p.tools.map((t) => ({ type: "function", ...t.function })),
        max_output_tokens: p.output,
        parallel_tool_calls: false,
        stream: false,
        store: false,
        include: ["reasoning.encrypted_content"],
        ...((p.reasoning as any).reasoning
          ? { reasoning: (p.reasoning as any).reasoning }
          : (p.reasoning as any).reasoning_effort
            ? { reasoning: { effort: (p.reasoning as any).reasoning_effort } }
            : {}),
      },
    };
  }
  return {
    path: "/chat/completions",
    headers,
    body: {
      model: p.model,
      messages: p.messages.map(({ recovery_code, engine_state, ...m }) => m),
      tools: p.tools,
      parallel_tool_calls: false,
      max_completion_tokens: p.output,
      ...p.reasoning,
      ...(p.stream
        ? { stream: true, stream_options: { include_usage: true } }
        : {}),
    },
  };
}
export function normalizeEngineResponse(kind: EngineKind, value: any) {
  if (kind === "openai-chat") return value;
  const content: string[] = [],
    calls: any[] = [];
  for (const block of kind === "anthropic"
    ? (value.content ?? [])
    : (value.output ?? [])) {
    if (block.type === "text") content.push(block.text);
    if (block.type === "message")
      for (const part of block.content ?? [])
        if (part.type === "output_text") content.push(part.text);
    if (block.type === "tool_use")
      calls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    if (block.type === "function_call")
      calls.push({
        id: block.call_id,
        type: "function",
        function: { name: block.name, arguments: block.arguments },
      });
  }

  const reasoning =
    kind === "openai-responses"
      ? (value.output ?? [])
          .filter(
            (b: any) =>
              b.type === "reasoning" &&
              typeof b.id === "string" &&
              typeof b.encrypted_content === "string",
          )
          .map((b: any) => ({
            type: "reasoning",
            id: b.id,
            summary: [],
            encrypted_content: b.encrypted_content,
          }))
      : [];
  const stop = kind === "anthropic" ? value.stop_reason : value.status;
  const complete =
    !value.error &&
    ["end_turn", "tool_use", "stop_sequence", "completed"].includes(stop);
  const usage = value.usage;
  return {
    choices: [
      {
        finish_reason: complete
          ? calls.length
            ? "tool_calls"
            : "stop"
          : ["max_tokens", "incomplete"].includes(stop)
            ? "length"
            : "content_filter",
        message: {
          role: "assistant",
          ...(reasoning.length
            ? { engine_state: { model: value.model, reasoning } }
            : {}),
          content: content.join("\n") || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
      },
    ],
    ...(usage &&
    Number.isSafeInteger(usage.input_tokens) &&
    Number.isSafeInteger(usage.output_tokens)
      ? {
          usage: {
            prompt_tokens:
              usage.input_tokens +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0),
            completion_tokens: usage.output_tokens,
            prompt_tokens_details: {
              cached_tokens:
                usage.cache_read_input_tokens ??
                usage.input_tokens_details?.cached_tokens ??
                0,
            },
          },
        }
      : {}),
  };
}
