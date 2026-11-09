import { ensureDb, pool } from "./server/db.ts";
import { runMaintenance } from "./server/scheduled-work.ts";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
await ensureDb();
console.log("[Scheduler] Shared fenced background jobs ready.");
while (!stopping) {
  await runMaintenance();
  await new Promise((r) => setTimeout(r, 2000));
}
await pool.end();
