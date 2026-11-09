import { transaction, pool } from "./db.ts";
import {
  objectStorageEnabled,
  storeBinary,
  readBinary,
  deleteBinary,
} from "./object-storage.ts";
export async function migrateBinaryBatch() {
  if (!objectStorageEnabled()) return 0;
  return transaction(async (c) => {
    const rows = (
      await c.query(
        "SELECT id,workspace_id,binary_data FROM artifacts WHERE binary_data IS NOT NULL AND binary_object IS NULL ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const f of rows) {
      const stored = (await storeBinary(f.workspace_id, f.binary_data))!;
      const copy = await readBinary({
        workspace_id: f.workspace_id,
        binary_object: stored.key,
        binary_bytes: stored.bytes,
        binary_sha256: stored.sha256,
      });
      if (!copy?.equals(f.binary_data))
        throw new Error("Binary migration verification failed.");
      await c.query(
        "UPDATE artifacts SET binary_object=$2,binary_bytes=$3,binary_sha256=$4,binary_data=NULL WHERE id=$1",
        [f.id, stored.key, stored.bytes, stored.sha256],
      );
    }
    return rows.length;
  });
}
export async function collectDeletedObjects() {
  if (!objectStorageEnabled()) return;
  const rows = (
    await pool.query(
      "SELECT object_key FROM object_deletions WHERE created_at<now()-interval '30 days' LIMIT 100",
    )
  ).rows;
  for (const row of rows) {
    if (
      (
        await pool.query("SELECT 1 FROM artifacts WHERE binary_object=$1", [
          row.object_key,
        ])
      ).rowCount
    )
      continue;
    await deleteBinary(row.object_key);
    await pool.query("DELETE FROM object_uploads WHERE object_key=$1", [
      row.object_key,
    ]);
    await pool.query("DELETE FROM object_deletions WHERE object_key=$1", [
      row.object_key,
    ]);
  }
}

export async function collectOrphanObjects() {
  if (!objectStorageEnabled()) return;
  const rows = (
    await pool.query(
      "SELECT u.object_key FROM object_uploads u WHERE u.created_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM artifacts a WHERE a.binary_object=u.object_key) AND NOT EXISTS(SELECT 1 FROM object_deletions d WHERE d.object_key=u.object_key) ORDER BY u.created_at LIMIT 100",
    )
  ).rows;
  for (const row of rows) {
    await deleteBinary(row.object_key);
    await pool.query("DELETE FROM object_uploads WHERE object_key=$1", [
      row.object_key,
    ]);
  }
}
