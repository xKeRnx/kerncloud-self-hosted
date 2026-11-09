import { createHash } from "node:crypto";
import type { Message } from "./types.ts";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface InputBasis {
  base: string;
  units: { hash: string; bytes: number }[];
  tokens: number;
}
export function inputBasis(
  messages: Message[],
  tools: unknown[],
  model: string,
): InputBasis {
  const sent = messages.map(({ recovery_code, ...m }) => m);
  return {
    base: hash({
      model,
      tools,
      system: sent.filter((m) => m.role === "system"),
    }),
    units: sent
      .filter((m) => m.role !== "system")
      .map((m) => ({
        hash: hash(m),
        bytes: Buffer.byteLength(JSON.stringify(m)),
      })),
    tokens: 0,
  };
}
// Reuse a measured prompt only with the exact same model/system/tool prefix.
// Never subtract removed history: charge the entire previous measured prompt,
// every new/changed unit at its UTF-8 byte bound, plus framing/boundary reserves.
export function measuredInputBound(
  prior: InputBasis | undefined,
  current: InputBasis,
  byteBound: number,
) {
  if (
    !prior ||
    prior.base !== current.base ||
    !Number.isSafeInteger(prior.tokens) ||
    prior.tokens <= 0 ||
    !Array.isArray(prior.units)
  )
    return byteBound;
  const counts = new Map<string, number>();
  for (const u of prior.units)
    counts.set(u.hash, (counts.get(u.hash) ?? 0) + 1);
  let added = 0,
    newUnits = 0;
  for (const u of current.units) {
    const n = counts.get(u.hash) ?? 0;
    if (n) counts.set(u.hash, n - 1);
    else {
      added += u.bytes;
      newUnits++;
    }
  }
  return Math.min(
    byteBound,
    prior.tokens + added + 1024 + current.units.length * 32 + newUnits * 64,
  );
}
