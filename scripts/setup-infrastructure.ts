import { readFile, writeFile } from "node:fs/promises";
import { ensureDb, pool } from "../src/server/db.ts";
import { newInfraHost } from "../src/server/infrastructure.ts";
const file = ".env.infrastructure";
try {
  let exists = false;
  try {
    await readFile(file);
    exists = true;
  } catch {}
  if (exists) {
    console.log(
      ".env.infrastructure existiert bereits und bleibt unverändert. Server-Zugang im Adminpanel verwalten.",
    );
  } else {
    await ensureDb();
    const host = await newInfraHost("Docker Desktop lokal", "docker");
    await writeFile(
      file,
      `INFRA_HOST_ID=${host.id}\nINFRA_HOST_TOKEN=${host.token}\nINFRA_ALLOW_COMMANDS=false\nINFRA_DOCKER_SUBNET_POOL=10.240.0.0/16\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Lokaler Betreiber-Connector registriert. Zugang ausschließlich in .env.infrastructure gespeichert; nicht ins Repository übernehmen.",
    );
    console.log(
      "Start: docker compose --profile infrastructure up -d --no-build infrastructure",
    );
  }
} finally {
  await pool.end();
}
