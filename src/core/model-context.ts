import type { Message } from "./types.ts";

// Compact only the provider copy. The worker journal and saved files stay intact.
export function artifactContext(
  messages: Message[],
  readByteLimit = 80000,
): Message[] {
  const replies = new Map<string, { message: Message; index: number }>();
  const reads = new Map<
    string,
    { artifactId: string; index: number; range: string; bytes: number }
  >();
  for (const [index, message] of messages.entries()) {
    if (message.role === "tool" && message.tool_call_id)
      replies.set(message.tool_call_id, { message, index });
  }
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.tool_calls ?? []) {
      if (call.function.name !== "read_artifact") continue;
      const reply = replies.get(call.id);
      if (!reply || reply.message.recovery_code) continue;
      try {
        const args = JSON.parse(call.function.arguments);
        const result = JSON.parse(reply.message.content ?? "null");
        if (
          typeof args.artifact_id !== "string" ||
          typeof result?.content !== "string" ||
          typeof result.total_characters !== "number"
        )
          continue;
        reads.set(call.id, {
          artifactId: args.artifact_id,
          index: reply.index,
          range: JSON.stringify([
            args.artifact_id,
            result.offset,
            result.content.length,
          ]),
          bytes: Buffer.byteLength(reply.message.content ?? ""),
        });
      } catch {
        /* Incomplete and failed calls remain verbatim. */
      }
    }
  }
  const retained = new Set<string>(),
    ranges = new Set<string>();
  let readBytes = 0;
  for (const [id, read] of [...reads].sort((a, b) => b[1].index - a[1].index)) {
    if (ranges.has(read.range)) continue;
    ranges.add(read.range);
    if (retained.size === 0 || readBytes + read.bytes <= readByteLimit) {
      retained.add(id);
      readBytes += read.bytes;
    }
  }
  return messages.map((message) => {
    if (message.role === "assistant" && message.tool_calls) {
      return {
        ...message,
        tool_calls: message.tool_calls.map((call) => {
          if (call.function.name === "deliver_artifacts") {
            try {
              const result = JSON.parse(
                replies.get(call.id)?.message.content ?? "null",
              );
              const args = JSON.parse(call.function.arguments);
              // A failed browser check still has confirmed transactional file IDs.
              // Unknown/partial saves have no complete matching file list.
              if (
                !Array.isArray(args.files) ||
                !Array.isArray(result?.files) ||
                args.files.length !== result.files.length ||
                !result.validation
              )
                return call;
              if (
                !result.files.every(
                  (f: any) =>
                    typeof f.artifact_id === "string" &&
                    typeof f.name === "string",
                )
              )
                return call;
              return {
                ...call,
                function: {
                  ...call.function,
                  arguments: JSON.stringify({
                    ...args,
                    files: args.files.map((f: any, i: number) => ({
                      ...f,
                      content: `[Gespeichert: ${result.files[i].name}; artifact_id=${result.files[i].artifact_id}. Original im Protokoll; Fehler gezielt patchen.]`,
                    })),
                  }),
                },
              };
            } catch {
              return call;
            }
          }
          if (!["save_artifact", "patch_artifact"].includes(call.function.name))
            return call;
          const reply = replies.get(call.id)?.message;
          if (!reply || reply.recovery_code) return call;
          try {
            const result = JSON.parse(reply.content ?? "null");
            const args = JSON.parse(call.function.arguments);
            if (
              typeof result?.artifact_id !== "string" ||
              typeof result.name !== "string" ||
              (call.function.name === "save_artifact" &&
                typeof args.content !== "string")
            )
              return call;
            if (call.function.name === "patch_artifact")
              return {
                ...call,
                function: {
                  ...call.function,
                  arguments: JSON.stringify({
                    artifact_id: args.artifact_id,
                    changes: [
                      {
                        find: `[Bereits angewandt; aktuelle artifact_id=${result.artifact_id}]`,
                        replace: "[Vollständiger Patch im Originalprotokoll]",
                      },
                    ],
                  }),
                },
              };
            return {
              ...call,
              function: {
                ...call.function,
                arguments: JSON.stringify({
                  ...args,
                  content: `[Bereits vollständig gespeichert: ${result.name}; artifact_id=${result.artifact_id}; ${args.content.length} Zeichen. Inhalt bei Bedarf mit read_artifact lesen; nicht erneut zum Wiederherstellen speichern.]`,
                }),
              },
            };
          } catch {
            return call;
          }
        }),
      };
    }
    const read = message.tool_call_id
      ? reads.get(message.tool_call_id)
      : undefined;
    if (
      message.role === "tool" &&
      read &&
      !retained.has(message.tool_call_id!)
    ) {
      const result = JSON.parse(message.content!);
      return {
        ...message,
        content: JSON.stringify({
          ...result,
          content: `[Älterer Dateiauszug kompakt referenziert; artifact_id=${read.artifactId}. Bei Bedarf mit read_artifact erneut lesen.]`,
        }),
      };
    }
    return message;
  });
}

// Only reads whose actual text is present in the last provider projection can
// be reused. Evicted, truncated, failed and merely referenced reads never count.
export function visibleArtifactReads(messages: Message[]) {
  const calls = new Map(
    messages
      .flatMap((m) => m.tool_calls ?? [])
      .filter((c) => c.function.name === "read_artifact")
      .map((c) => [c.id, c]),
  );
  const reads: {
    artifact_id: string;
    offset: number;
    length: number;
    call_id: string;
  }[] = [];
  for (const m of messages) {
    const call = m.tool_call_id && calls.get(m.tool_call_id);
    if (!call || m.recovery_code) continue;
    try {
      const args = JSON.parse(call.function.arguments),
        value = JSON.parse(m.content ?? "null");
      if (
        typeof args.artifact_id !== "string" ||
        typeof value?.content !== "string" ||
        !Number.isInteger(value.offset) ||
        typeof value.total_characters !== "number" ||
        value.content.startsWith("[Älterer Dateiauszug")
      )
        continue;
      reads.push({
        artifact_id: args.artifact_id,
        offset: value.offset,
        length: value.content.length,
        call_id: call.id,
      });
    } catch {
      /* Not a complete source excerpt. */
    }
  }
  return reads.slice(-8);
}
