// Missing provider metrics stay unknown. A zero is only recorded when reported.
export function cacheTelemetry(usage: any) {
  const input = usage?.prompt_tokens,
    cached = usage?.prompt_tokens_details?.cached_tokens;
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n < 10000000;
  return valid(input) && valid(cached) && cached <= input
    ? { cached, input }
    : null;
}
