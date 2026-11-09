export const maximumRunTokens = 100_000_000;
export function budgetDecisionScope(
  question: string,
): "run" | "project" | null {
  if (
    question.startsWith(
      "Das feste Auftragslimit reicht für keinen weiteren sinnvollen Modellschritt.",
    ) ||
    question.startsWith(
      "Festes Auftragslimit erreicht oder die nächste Reservierung passt nicht mehr hinein.",
    )
  )
    return "run";
  if (
    question.startsWith(
      "Projektbudget erreicht. Keine weitere Modellreservierung.",
    )
  )
    return "project";
  return null;
}
export function fallbackAnswers(kind: string): string[] {
  if (kind === "access")
    return [
      "Bitte die Einrichtung Schritt für Schritt erklären.",
      "Einen erlaubten Weg ohne diesen Zugang versuchen.",
      "Mit den bereits verfügbaren Informationen weiterarbeiten.",
    ];
  if (kind === "approval")
    return [
      "Bitte Risiken und Kosten genauer erklären.",
      "Eine Alternative ohne diese Aktion vorschlagen.",
      "Den Umfang auf bereits freigegebene Aktionen begrenzen.",
    ];
  return [
    "Bitte eine konkrete Empfehlung mit Begründung geben.",
    "Mit den vorhandenen Informationen weiterarbeiten; Unsicherheiten kennzeichnen.",
    "Den Umfang reduzieren und vorhandene Ergebnisse prüfen.",
  ];
}
// This is a form convenience only. The server accepts explicit numeric limits, never commands parsed from prose.
export function requestedTokens(text: string): number | null {
  const matches = [
    ...text.matchAll(
      /\b(\d+(?:[.,_ ]\d+)*)(?:\s*)(mio\.?|millionen?|millions?|m|tausend|k)?\b/gi,
    ),
  ];
  if (matches.length !== 1) return null;
  const [, raw, suffix] = matches[0];
  if (text.slice(0, matches[0].index).trimEnd().endsWith("-")) return null;
  if (!suffix && !/^\d+$/.test(raw) && !/^\d{1,3}(?:[.,_ ]\d{3})+$/.test(raw))
    return null;
  const magnitude = /^(?:mio\.?|millionen?|millions?|m)$/i.test(suffix ?? "")
    ? 1_000_000
    : /^(?:tausend|k)$/i.test(suffix ?? "")
      ? 1000
      : 1;
  const value =
    magnitude === 1
      ? Number(raw.replace(/[.,_ ]/g, ""))
      : Number(raw.replace(/[_ ]/g, "").replace(",", ".")) * magnitude;
  return Number.isSafeInteger(value) &&
    value >= 1000 &&
    value <= maximumRunTokens
    ? value
    : null;
}
export type DecisionBudget = {
  scope: "run" | "project";
  can_change: boolean;
  can_control: boolean;
  token_limit: number;
  credit_limit: number;
  spent_tokens: number;
  measured_tokens: number;
  spent_credits: number;
  minimum_token_limit: number;
  max_token_limit: number;
  max_credit_limit: number;
  project_id: string;
  project_name: string;
  byok: boolean;
};
