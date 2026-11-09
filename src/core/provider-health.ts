export function retryAfterSeconds(value: string | null, now = Date.now()) {
  const seconds =
    value && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : value
        ? (Date.parse(value) - now) / 1000
        : 1;
  return Number.isFinite(seconds)
    ? Math.min(86400, Math.max(1, Math.ceil(seconds)))
    : 1;
}
export function providerBackoff(
  reason: string,
  failures: number,
  retryAfter = 1,
) {
  const minimum =
    reason === "auth"
      ? 300
      : reason === "billing"
        ? 600
        : Math.min(60, 2 ** Math.min(6, Math.max(0, failures - 1)));
  return Math.min(86400, Math.max(minimum, retryAfter));
}
