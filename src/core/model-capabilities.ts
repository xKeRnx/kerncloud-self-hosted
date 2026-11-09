import { reasoningEffortValues } from "./agent-recovery.ts";
import { maxOutputTokens, defaultOutputTokens } from "./model-limits.ts";

export interface ModelCapabilities {
  checked_at?: string;
  source?: "provider_catalog";
  context_window_tokens?: number;
  max_output_tokens?: number;
  reasoning_efforts?: string[] | null;
  reasoning_mandatory?: boolean;
}
const object = (x: any): Record<string, any> =>
  x && typeof x === "object" && !Array.isArray(x) ? x : {};
const positive = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const minimum = (...values: unknown[]) => {
  const valid = values.filter(positive);
  return valid.length ? Math.min(...valid) : undefined;
};
export function parseModelCapabilities(
  value: unknown,
  router = false,
): ModelCapabilities {
  const m = object(value),
    top = object(m.top_provider),
    r = object(m.reasoning);
  const raw = r.supported_efforts ?? m.supported_reasoning_efforts;
  const result: ModelCapabilities = {
    source: "provider_catalog",
    checked_at: new Date().toISOString(),
    context_window_tokens: minimum(
      m.context_length,
      m.context_window_tokens,
      m.context_window,
      m.max_context_tokens,
      top.context_length,
    ),
    max_output_tokens: minimum(
      m.max_output_tokens,
      m.max_completion_tokens,
      top.max_completion_tokens,
    ),
    reasoning_efforts: null,
  };
  const known = reasoningEffortValues.filter((v) => v !== "provider_default");
  if (Array.isArray(raw))
    result.reasoning_efforts = known.filter((v) => raw.includes(v));
  else if (
    router &&
    Object.hasOwn(r, "supported_efforts") &&
    r.supported_efforts === null
  )
    result.reasoning_efforts = [...known];
  else if (
    (Object.hasOwn(r, "supported_efforts") && r.supported_efforts !== null) ||
    (Array.isArray(m.supported_parameters) &&
      !m.supported_parameters.some(
        (v: unknown) => v === "reasoning" || v === "reasoning_effort",
      ))
  )
    result.reasoning_efforts = [];
  if (r.mandatory === true) {
    result.reasoning_mandatory = true;
    result.reasoning_efforts =
      result.reasoning_efforts?.filter((v) => v !== "none") ?? null;
  }
  return result;
}
export function allowedReasoning(
  capabilities?: ModelCapabilities | null,
  verifiedOnly = false,
) {
  const values =
    capabilities?.reasoning_efforts ??
    (verifiedOnly
      ? []
      : reasoningEffortValues.filter((v) => v !== "provider_default"));
  return values.filter(
    (v) => !capabilities?.reasoning_mandatory || v !== "none",
  );
}
export function capabilityIssue(model: {
  reasoning_effort?: string;
  auto_reasoning_effort?: string;
  capabilities?: ModelCapabilities;
}) {
  const allowed = model.capabilities?.reasoning_efforts;
  const effort =
    (model.reasoning_effort ?? "auto") === "auto"
      ? (model.auto_reasoning_effort ?? "provider_default")
      : model.reasoning_effort;
  return (model.capabilities?.reasoning_mandatory && effort === "none") ||
    (Array.isArray(allowed) &&
      effort !== "provider_default" &&
      !allowed.includes(effort!))
    ? "Der gewählte Denkaufwand wird laut Modellkatalog nicht unterstützt. Bitte die Modelleinstellungen prüfen."
    : null;
}
export function applyCapabilityLimits<
  T extends {
    max_output_tokens?: number;
    context_window_tokens?: number | null;
    capabilities?: ModelCapabilities;
  },
>(model: T): T {
  const c = model.capabilities;
  return {
    ...model,
    max_output_tokens: Math.min(
      model.max_output_tokens ?? defaultOutputTokens,
      c?.max_output_tokens ?? maxOutputTokens,
      c?.context_window_tokens ?? Infinity,
    ),
    context_window_tokens: c?.context_window_tokens
      ? Math.min(
          8388608,
          model.context_window_tokens ?? c.context_window_tokens,
          c.context_window_tokens,
        )
      : model.context_window_tokens,
  };
}
