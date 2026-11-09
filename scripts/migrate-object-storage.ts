import { ensureDb, pool } from "../src/server/db.ts";
import { migrateBinaryBatch } from "../src/server/object-migration.ts";
await ensureDb();
let total = 0;
try {
  while (true) {
    const n = await migrateBinaryBatch();
    total += n;
    if (n < 10) break;
  }
  console.log(JSON.stringify({ verified_and_migrated: total }));
} finally {
  await pool.end();
}
