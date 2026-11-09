import {
  parseProviderCatalog,
  type ProviderModel,
} from "../core/provider-catalog.ts";
import { z } from "zod";
import { pool } from "./db.ts";
import { decrypt } from "./security.ts";
import { HttpError } from "./auth.ts";
import { networkEndpoint } from "./mcp.ts";
import { type ModelCapabilities } from "../core/model-capabilities.ts";

export async function inspectProviderCatalog(endpoint: string, key: string) {
  const empty = (status: string) => ({
    status,
    models: [] as ProviderModel[],
    partial: false,
  });
  try {
    const url = await networkEndpoint(endpoint);
    const response = await fetch(endpoint.replace(/\/$/, "") + "/models", {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return empty(
        [404, 405, 501].includes(response.status)
          ? "unsupported"
          : "unavailable",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) return empty("unsupported");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) return empty("unsupported");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    let data: any;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return empty("unsupported");
    }
    const catalog = parseProviderCatalog(
      data,
      url.hostname.toLowerCase() === "openrouter.ai",
      url.hostname,
    );
    return catalog ? { status: "available", ...catalog } : empty("unsupported");
  } catch {
    return empty("unavailable");
  }
}
export async function inspectModel(
  endpoint: string,
  model: string,
  key: string,
): Promise<{ status: string; capabilities: ModelCapabilities; listing?: ProviderModel }> {
  const result = await inspectProviderCatalog(endpoint, key);
  const found = result.models.find((m) => m.id === model);
  return found
    ? { status: "available", capabilities: found.capabilities, listing: found }
    : {
        status:
          result.status === "available"
            ? result.partial
              ? "unsupported"
              : "unlisted"
            : result.status,
        capabilities: {},
      };
}

export async function listProviderModels(
  workspace: string | null,
  body: unknown,
) {
  const input = z
    .object({
      id: z.string().min(1).max(100).optional(),
      endpoint: z.string().url(),
      key: z.string().max(2000).optional(),
    })
    .parse(body);
  const { key } = await discoveryCredential(workspace, input);
  return inspectProviderCatalog(input.endpoint, key);
}

export async function discoveryCredential(
  workspace: string | null,
  input: { id?: string; endpoint: string; key?: string },
) {
  const old = input.id
    ? (
        await pool.query(
          "SELECT id,endpoint,model,secret FROM model_offerings WHERE id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL",
          [input.id, workspace],
        )
      ).rows[0]
    : null;
  if (input.id && !old) throw new HttpError(404, "Modell nicht gefunden.");
  if (
    old &&
    old.endpoint !== input.endpoint.replace(/\/$/, "") &&
    input.key === undefined
  )
    throw new HttpError(
      400,
      "Bei einem neuen Endpoint bitte den Schlüssel erneut angeben (für lokale Modelle leer bestätigen).",
    );
  return { key: input.key ?? (old ? decrypt(old.secret) : ""), old };
}
export async function discoverModel(workspace: string | null, body: unknown) {
  const b = z
    .object({
      id: z.string().min(1).max(100).optional(),
      endpoint: z.string().url(),
      model: z.string().trim().min(1).max(200),
      key: z.string().max(2000).optional(),
    })
    .parse(body);
  const { key } = await discoveryCredential(workspace, b);
  return inspectModel(b.endpoint, b.model, key);
}
