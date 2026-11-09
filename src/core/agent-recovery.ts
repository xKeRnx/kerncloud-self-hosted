import type { Message } from "./types.ts";
export const defaultModelTimeoutSeconds = 600;
export const maxModelTimeoutSeconds = 1800;
export const maxWorkerModelWaitMs = (maxModelTimeoutSeconds + 60) * 1000;
export const recoveryLimit = 6;
export const modelRetryLimit = 1;
export function recoveryWindow(messages: Message[]) {
  const lastInput = messages.findLastIndex(
    (m) => m.role === "user" && !m.recovery_code,
  );
  return messages.slice(lastInput + 1);
}
export function recoveryCount(messages: Message[]) {
  return recoveryWindow(messages).filter((m) => m.recovery_code).length;
}
export function mayRetryModel(messages: Message[]) {
  return (
    recoveryCount(messages) < recoveryLimit &&
    recoveryWindow(messages).filter((m) =>
      m.recovery_code?.startsWith("MODEL_"),
    ).length < modelRetryLimit
  );
}
export const reasoningEffortValues = [
  "provider_default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export function providerReasoning(
  endpoint: string,
  selection = "auto",
  automaticEffort = "provider_default",
) {
  const effort = selection === "auto" ? automaticEffort : selection;
  if (
    effort === "provider_default" ||
    !reasoningEffortValues.some((value) => value === effort)
  )
    return {};
  // Transport syntax differs by API; effort is exclusively the saved model setting.
  return new URL(endpoint).hostname.toLowerCase() === "openrouter.ai"
    ? { reasoning: { effort } }
    : { reasoning_effort: effort };
}
