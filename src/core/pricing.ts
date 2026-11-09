export interface CreditPricing {
  input_rate: number;
  output_rate: number;
  base_credits: number;
}
export function creditCost(
  input: number,
  output: number,
  pricing: CreditPricing,
) {
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0
  )
    throw new Error("Ungültige Tokenzahlen.");
  if (Object.values(pricing).some((v) => !Number.isFinite(v) || v < 0))
    throw new Error("Ungültiger Credit-Tarif.");
  const cost = Math.ceil(
    (input * pricing.input_rate + output * pricing.output_rate) / 1000 +
      pricing.base_credits -
      1e-9,
  );
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error("Credit-Kosten außerhalb des gültigen Bereichs.");
  return Math.max(0, cost);
}
