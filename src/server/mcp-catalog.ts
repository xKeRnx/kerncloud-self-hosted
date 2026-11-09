import { createHash } from "node:crypto";
import { withMcp } from "./mcp.ts";
import { decrypt } from "./security.ts";
const catalog = new Map<string, { until: number; tools: any[] }>();
export async function cachedMcpCatalog(connection: any) {
  const key = createHash("sha256")
    .update(JSON.stringify([connection.id, connection.url, connection.secret]))
    .digest("hex");
  const hit = catalog.get(key);
  if (hit && hit.until > Date.now()) return hit.tools;
  const listed = await withMcp(
    connection.url,
    decrypt(connection.secret),
    (c) => c.listTools(),
  );
  if (catalog.size >= 64) catalog.delete(catalog.keys().next().value!);
  const tools = listed.tools.slice(0, 300);
  catalog.set(key, { until: Date.now() + 60000, tools });
  return tools;
}
