import pg from "pg";
import { randomUUID, createHash } from "node:crypto";
import { encrypt, decrypt } from "./security.ts";
function config() {
  const endpoint = process.env.OBJECT_STORAGE_URL,
    token = process.env.OBJECT_STORAGE_TOKEN ?? process.env.WORKER_TOKEN;
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !token ||
    token.length < 32
  )
    throw new Error("Invalid private object storage configuration.");
  return { endpoint: url.toString().replace(/\/$/, ""), token };
}
export function objectStorageEnabled() {
  return !!config();
}
function objectUrl(endpoint: string, key: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}\/[a-f0-9-]{36}$/.test(key))
    throw new Error("Invalid object key.");
  return endpoint + "/objects/" + key;
}
let registry: pg.Pool | undefined;
function uploadRegistry() {
  return (registry ??= new pg.Pool({
    connectionString: process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: true,
    application_name: "kerncloud-object-registry",
  }));
}
export async function storeBinary(workspace: string, data: Buffer) {
  const c = config();
  if (!c) return null;
  const key = workspace + "/" + randomUUID();
  // Commit the key independently before upload so a rolled-back business transaction leaves a collectible orphan.
  // This small separate pool avoids waiting for a connection held by the calling transaction.
  await uploadRegistry().query(
    "INSERT INTO object_uploads(object_key,workspace_id) VALUES($1,$2)",
    [key, workspace],
  );
  const body = encrypt(data.toString("base64"));
  const response = await fetch(objectUrl(c.endpoint, key), {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + c.token,
      "Content-Type": "application/octet-stream",
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 201) throw new Error("Private object upload failed.");
  return {
    key,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
export async function readBinary(file: {
  binary_object?: string;
  binary_data?: Buffer;
  binary_sha256?: string;
  binary_bytes?: number;
  workspace_id?: string;
}) {
  if (!file.binary_object)
    return file.binary_data ? Buffer.from(file.binary_data) : null;
  if (
    file.workspace_id &&
    !file.binary_object.startsWith(file.workspace_id + "/")
  )
    throw new Error("Object belongs to another workspace.");
  const c = config();
  if (!c) throw new Error("Private object storage unavailable.");
  const response = await fetch(objectUrl(c.endpoint, file.binary_object), {
    headers: { Authorization: "Bearer " + c.token },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || Number(response.headers.get("content-length")) > 16000000)
    throw new Error("Private object download failed.");
  const reader = response.body!.getReader();
  let body = "",
    bytes = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      bytes += r.value.length;
      if (bytes > 16000000) throw new Error("Object exceeds limit.");
      body += Buffer.from(r.value).toString("utf8");
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const data = Buffer.from(decrypt(body), "base64");
  if (
    data.length !== file.binary_bytes ||
    createHash("sha256").update(data).digest("hex") !== file.binary_sha256
  )
    throw new Error("Private object integrity check failed.");
  return data;
}
export async function deleteBinary(key: string) {
  const c = config();
  if (!c) throw new Error("Private object storage unavailable.");
  const r = await fetch(objectUrl(c.endpoint, key), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + c.token },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok && r.status !== 404)
    throw new Error("Private object deletion failed.");
}
