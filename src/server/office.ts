import { storeBinary } from "./object-storage.ts";
import { createOffice } from "../core/office.ts";
import { saveArtifact } from "./artifacts.ts";
import type { PoolClient } from "pg";
import type { Task } from "../core/types.ts";
export async function officeArtifact(
  c: PoolClient,
  task: Task,
  input: unknown,
) {
  const file = createOffice(input);
  const quota = (
    await c.query(
      "SELECT coalesce(sum(octet_length(content)+coalesce(octet_length(binary_data),0)+binary_bytes),0) n FROM artifacts WHERE run_id=$1",
      [task.run_id],
    )
  ).rows[0];
  if (Number(quota.n) + file.data.length > 5000000)
    throw new Error("Office binary quota exceeded");
  const saved = await saveArtifact(c, task, file.name, JSON.stringify(input));
  const stored = await storeBinary(task.workspace_id, Buffer.from(file.data));
  await c.query(
    "UPDATE artifacts SET binary_data=$2,binary_preview=$3,binary_object=$4,binary_bytes=$5,binary_sha256=$6 WHERE id=$1",
    [
      saved.artifact_id,
      stored ? null : Buffer.from(file.data),
      file.preview,
      stored?.key ?? null,
      stored?.bytes ?? 0,
      stored?.sha256 ?? null,
    ],
  );
  return { ...saved, validation: file.validation, bytes: file.data.length };
}
