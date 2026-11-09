import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { lookup } from "node:dns/promises";
import { validateEndpoint } from "./security.ts";
export async function networkEndpoint(value: string) {
  const url = new URL(validateEndpoint(value));
  if (process.env.ALLOW_LOCAL_ENDPOINTS === "true") return url;
  if (url.protocol !== "https:")
    throw new Error(
      "Außerhalb der lokalen Testumgebung ist HTTPS erforderlich.",
    );
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
  });
  for (const { address } of addresses)
    if (
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::|fc|fd|fe80)/i.test(
        address,
      ) ||
      address.includes(":ffff:")
    )
      throw new Error(
        "Private Netzwerkziele sind nur im ausdrücklich aktivierten lokalen Modus erlaubt.",
      );
  return url;
}
export async function withMcp<T>(
  url: string,
  secret: string,
  fn: (client: Client) => Promise<T>,
  signal?: AbortSignal,
) {
  await networkEndpoint(url);
  const client = new Client({ name: "kerncloud", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      signal,
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    },
  });
  try {
    signal?.throwIfAborted();
    await client.connect(transport);
    signal?.throwIfAborted();
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
