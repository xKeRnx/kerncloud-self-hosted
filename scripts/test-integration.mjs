import pg from "pg";
import { spawn } from "node:child_process";
if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
  throw new Error(
    "Bitte zuerst npm run setup und docker compose up -d postgres ausführen.",
  );
const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
if (!process.env.TEST_DATABASE_URL) {
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error(
      "Automatische Testdatenbank nur auf localhost. TEST_DATABASE_URL explizit setzen.",
    );
  url.pathname = "/kerncloud_test";
}
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(name))
  throw new Error(
    "Testdatenbank muss ein separater Name mit Endung _test sein.",
  );
const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";
const pool = new pg.Pool({ connectionString: adminUrl.toString() });
try {
  const result = await pool.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!result.rowCount) await pool.query(`CREATE DATABASE "${name}"`);
} finally {
  await pool.end();
}
const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "tests/integration/saas.test.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, TEST_DATABASE_URL: url.toString() },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
