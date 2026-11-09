// Keep consumption when a paid plan changes during its billing period.
export function runtimePlanBalance(
  previousAllowance: number,
  included: number,
  nextAllowance: number,
) {
  return Math.max(0, nextAllowance - Math.max(0, previousAllowance - included));
}
