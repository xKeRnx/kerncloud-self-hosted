export const modelCheckCooldownMs = 5 * 60 * 1000;

/** A catalog check is reusable for five minutes, including a check in progress. */
export function modelCheckWindow(
  checkedAt: string | Date | null | undefined,
  now = Date.now(),
) {
  const checked =
    checkedAt instanceof Date
      ? checkedAt.getTime()
      : checkedAt
        ? Date.parse(checkedAt)
        : NaN;
  if (!Number.isFinite(checked))
    return { remainingSeconds: 0, nextCheckAt: null };
  const next = checked + modelCheckCooldownMs;
  return {
    remainingSeconds: Math.max(0, Math.ceil((next - now) / 1000)),
    nextCheckAt: new Date(next).toISOString(),
  };
}

export function modelCheckCountdown(seconds: number) {
  return (
    Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0") +
    ":" +
    (seconds % 60).toString().padStart(2, "0")
  );
}
