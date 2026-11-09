// Isolated protocol/infrastructure fixtures, never a real model acceptance test.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import { NextRequest } from "next/server";
const source = process.env.TEST_DATABASE_URL;
if (!source || !new URL(source).pathname.endsWith("_test"))
  throw new Error("Dedicated _test database required");
const url = new URL(source);
url.pathname = "/kerncloud_runtime_tools_test";
const admin = new URL(url);
admin.pathname = "/postgres";
const bootstrap = new pg.Pool({ connectionString: admin.toString() });
try {
  if (
    !(
      await bootstrap.query(
        "SELECT 1 FROM pg_database WHERE datname='kerncloud_runtime_tools_test'",
      )
    ).rowCount
  )
    await bootstrap.query("CREATE DATABASE kerncloud_runtime_tools_test");
} finally {
  await bootstrap.end();
}
const isolated = new pg.Pool({ connectionString: url.toString() });
try {
  if (new URL(url).pathname !== "/kerncloud_runtime_tools_test")
    throw new Error("Unexpected fixture database");
  await isolated.query("DROP SCHEMA public CASCADE");
  await isolated.query("CREATE SCHEMA public");
} finally {
  await isolated.end();
}
for (const key of Object.keys(process.env))
  if (/KEY|TOKEN|SECRET|PASSWORD/.test(key)) delete process.env[key];
delete process.env.ADMIN_EMAIL;
process.env.DATABASE_URL = url.toString();
process.env.TEST_DATABASE_URL = url.toString();
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.WORKER_TOKEN = randomBytes(32).toString("hex");
process.env.ALLOW_LOCAL_ENDPOINTS = "true";
const { ensureDb, pool } = await import("../src/server/db.ts");
const { handle } = await import("../src/server/api.ts");
const { runtimeImprovementTests } =
  await import("../tests/integration/runtime-improvements.ts");
test(
  "Runtime improvement fixtures on a separate database",
  { timeout: 60000 },
  async (t) => {
    await ensureDb();
    const server = createServer(async (req, res) => {
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const path = (req.url ?? "/").replace(/^\/api\//, "");
        const request = new NextRequest("http://localhost:3100/api/" + path, {
          method: req.method,
          headers: {
            "content-type": "application/json",
            authorization: req.headers.authorization ?? "",
          },
          ...(req.method === "POST" ? { body: body || "{}" } : {}),
        });
        const result = await handle(request, path);
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(await result.text());
      } catch (e) {
        res.writeHead(500).end(JSON.stringify({ error: String(e) }));
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No fixture port");
    const platformUrl = `http://127.0.0.1:${address.port}`;
    try {
      await runtimeImprovementTests(t, platformUrl, platformUrl);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
    }
  },
);
