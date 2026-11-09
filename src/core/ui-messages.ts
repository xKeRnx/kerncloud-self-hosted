import en from "./ui-en.json" with { type: "json" };
import type { Locale } from "./languages";
export function messageKey(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
// Only call this for application-owned UI text, never customer/agent content.
export function uiMessage(
  locale: Locale,
  source: string,
  values: unknown[] = [],
): string {
  if (typeof source !== "string") return source;
  const key = messageKey(source);
  const translated =
    locale === "en" ? (en as Record<string, string>)[key] : undefined;
  const text =
    translated === undefined
      ? source
      : source.match(/^\s*/)?.[0] + translated + source.match(/\s*$/)?.[0];
  return text.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)] ?? "") : match,
  );
}
