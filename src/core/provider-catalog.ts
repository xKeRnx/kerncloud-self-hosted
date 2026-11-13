import { parseProviderPrices, type ProviderPrices } from "./model-tariff.ts";
import {
  parseModelCapabilities,
  type ModelCapabilities,
} from "./model-capabilities.ts";

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  prices: ProviderPrices | null;
  capabilities: ModelCapabilities;
}

// Provider responses are untrusted. Only expose fields needed by the picker.
export function parseProviderCatalog(
  value: unknown,
  router = false,
  provider = "",
) {
  const body = value as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.data)) return null;
  const models: ProviderModel[] = [],
    seen = new Set<string>();
  let partial =
    body.has_more === true || !!body.next_page || !!body.next_cursor;
  for (const entry of body.data) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string")
      continue;
    const id = entry.id.trim();
    if (
      !id ||
      id.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(id) ||
      seen.has(id)
    )
      continue;
    if (models.length >= 5000) {
      partial = true;
      break;
    }
    seen.add(id);
    const name =
      typeof (entry.name ?? entry.display_name) === "string"
        ? (entry.name ?? entry.display_name)
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, 200) || id
        : id;
    models.push({
      id,
      name,
      provider,
      prices: parseProviderPrices(entry.pricing, router),
      capabilities: parseModelCapabilities(entry, router),
    });
  }
  models.sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"),
  );
  return { models, partial };
}

export function filterProviderModels(models: ProviderModel[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) =>
    words.every((word) => `${m.name} ${m.id}`.toLowerCase().includes(word)),
  );
}
