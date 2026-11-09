import { ensureDb, pool, transaction } from "../src/server/db.ts";

// Explicit local-lab setup; never change customer subscriptions or balances.
const db = new URL(process.env.DATABASE_URL ?? "");
if (
  !["localhost", "127.0.0.1"].includes(db.hostname) ||
  db.pathname !== "/kerncloud"
) {
  throw new Error(
    "Diese Freigabe ist ausschließlich für die lokale kerncloud-Datenbank bestimmt.",
  );
}
const hostId = process.env.INFRA_HOST_ID;
if (!hostId) throw new Error(".env.infrastructure mit INFRA_HOST_ID laden.");
try {
  await ensureDb();
  await transaction(async (c) => {
    const host = await c.query(
      "SELECT id FROM infrastructure_hosts WHERE id=$1 AND kind='docker' FOR UPDATE",
      [hostId],
    );
    if (!host.rowCount)
      throw new Error("Registrierter lokaler Docker-Host fehlt.");
    await c.query(
      "UPDATE infrastructure_hosts SET enabled=true,provisioning=true,self_service=true,max_running=2,cpu_limit=4,memory_limit_mb=2560 WHERE id=$1",
      [hostId],
    );
    await c.query(
      "UPDATE environment_templates SET enabled=true WHERE id IN('browser','development')",
    );
  });
  console.log(
    "Lokaler Docker-Kundenzugang freigegeben: 2 gleichzeitig, 4 CPU, 2560 MiB. Konten, Pläne und Guthaben unverändert.",
  );
} finally {
  await pool.end();
}
