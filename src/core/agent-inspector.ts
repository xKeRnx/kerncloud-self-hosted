// Display-only projection. Never return provider reasoning fields or credential values.
const privateKey =
  /^(?:password|passwort|secret|client[_-]?secret|private[_-]?key|api[_-]?key|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|session[_-]?token|token|credential|credentials|lease[_-]?token|reasoning(?:_content|_details)?|chain_of_thought)$/i;
export function inspectorText(value: unknown, limit = 6000): string {
  return String(value ?? "")
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(
      /([?&](?:token|key|secret|password|auth|access_token)=)[^&#\s"']+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:["']?(?:password|passwort|secret|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token)["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .slice(0, limit);
}
export function inspectorValue(value: unknown, depth = 0): unknown {
  if (depth > 7) return "[depth limit]";
  if (typeof value === "string") return inspectorText(value);
  if (Array.isArray(value))
    return value.slice(0, 40).map((v) => inspectorValue(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 60)
        .map(([k, v]) => [
          inspectorText(k, 100),
          privateKey.test(k) ? "[redacted]" : inspectorValue(v, depth + 1),
        ]),
    );
  return value;
}
export function inspectorPayload(value: unknown): string {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return inspectorText(value);
    }
  }
  return (JSON.stringify(inspectorValue(parsed), null, 2) ?? "").slice(0, 6000);
}
export type InspectionEntry = {
  index: number;
  role: string;
  content: string;
  truncated: boolean;
  tool_call_id?: string;
  tools: { id: string; name: string; arguments: string; truncated: boolean }[];
};
export function inspectionEntry(index: number, message: any): InspectionEntry {
  const raw = String(message?.content ?? "");
  return {
    index,
    role: message.role,
    content:
      message.role === "tool" ? inspectorPayload(raw) : inspectorText(raw),
    truncated: raw.length > 6000,
    tool_call_id:
      message.role === "tool"
        ? inspectorText(message.tool_call_id, 150)
        : undefined,
    tools:
      message.role === "assistant" && Array.isArray(message.tool_calls)
        ? message.tool_calls.slice(0, 20).map((t: any) => ({
            id: inspectorText(t.id, 150),
            name: inspectorText(t.function?.name, 150),
            arguments: inspectorPayload(t.function?.arguments ?? ""),
            truncated: String(t.function?.arguments ?? "").length > 6000,
          }))
        : [],
  };
}
