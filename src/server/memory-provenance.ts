import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
export const memorySource = z
  .object({
    kind: z.enum(["run", "artifact", "attachment"]),
    id: z.string().uuid(),
  })
  .strict();
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
async function source(
  c: PoolClient,
  workspaceId: string,
  kind: string,
  id: string,
) {
  const sql =
    kind === "run"
      ? "SELECT goal AS content FROM runs WHERE workspace_id=$1 AND id=$2"
      : kind === "artifact"
        ? "SELECT content||':'||retired::text AS content FROM artifacts WHERE workspace_id=$1 AND id=$2"
        : "SELECT content FROM attachments WHERE workspace_id=$1 AND id=$2";
  const row = (await c.query(sql, [workspaceId, id])).rows[0];
  return row ? hash(row.content) : null;
}
export async function saveMemorySources(
  c: PoolClient,
  workspaceId: string,
  memoryId: string,
  refs: z.infer<typeof memorySource>[],
) {
  for (const ref of refs) {
    if (
      (
        await c.query(
          "SELECT 1 FROM memory_exclusions WHERE workspace_id=$1 AND kind=$2 AND source_id=$3",
          [workspaceId, ref.kind, ref.id],
        )
      ).rowCount
    )
      throw new HttpError(
        409,
        "Diese Quelle ist vom Gedächtnis ausgeschlossen.",
      );
    const fingerprint = await source(c, workspaceId, ref.kind, ref.id);
    if (!fingerprint)
      throw new HttpError(403, "Gedächtnisquelle fehlt in diesem Workspace.");
    await c.query(
      "INSERT INTO memory_sources(memory_id,workspace_id,kind,source_id,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(memory_id,kind,source_id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint",
      [memoryId, workspaceId, ref.kind, ref.id, fingerprint],
    );
  }
}
export async function memoryOrigins(
  c: PoolClient,
  workspaceId: string,
  memoryId: string,
) {
  const rows = (
    await c.query(
      "SELECT kind,source_id,fingerprint,created_at FROM memory_sources WHERE memory_id=$1 AND workspace_id=$2",
      [memoryId, workspaceId],
    )
  ).rows;
  return Promise.all(
    rows.map(async (row) => {
      const current = await source(c, workspaceId, row.kind, row.source_id);
      return {
        ...row,
        available: current !== null,
        stale: current !== row.fingerprint,
      };
    }),
  );
}
export async function attachMemoryOrigins(
  c: PoolClient,
  workspaceId: string,
  rows: any[],
) {
  if (!rows.length) return;
  const sources = (
    await c.query(
      "SELECT s.*,CASE WHEN s.kind='run' AND r.id IS NOT NULL THEN encode(sha256(convert_to(r.goal,'UTF8')),'hex') WHEN s.kind='artifact' AND a.id IS NOT NULL THEN encode(sha256(convert_to(a.content||':'||a.retired::text,'UTF8')),'hex') WHEN s.kind='attachment' AND x.id IS NOT NULL THEN encode(sha256(convert_to(x.content,'UTF8')),'hex') END current FROM memory_sources s LEFT JOIN runs r ON s.kind='run' AND r.id=s.source_id AND r.workspace_id=s.workspace_id LEFT JOIN artifacts a ON s.kind='artifact' AND a.id=s.source_id AND a.workspace_id=s.workspace_id LEFT JOIN attachments x ON s.kind='attachment' AND x.id=s.source_id AND x.workspace_id=s.workspace_id WHERE s.workspace_id=$1 AND s.memory_id=ANY($2::text[])",
      [workspaceId, rows.map((r) => r.id)],
    )
  ).rows;
  for (const row of rows) {
    row.sources = sources
      .filter((s) => s.memory_id === row.id)
      .map(({ current, ...s }) => ({
        ...s,
        available: current !== null,
        stale: current !== s.fingerprint,
      }));
    row.stale = row.expired || row.sources.some((s: any) => s.stale);
  }
}
export async function forgetMemorySource(
  actor: string,
  workspaceId: string,
  body: unknown,
) {
  const b = z
    .object({
      source: memorySource,
      action: z.enum(["preview", "forget", "readmit"]),
      preview_hash: z.string().max(64).optional(),
      include_protected: z.boolean().default(false),
    })
    .strict()
    .parse(body);
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ]);
    if (b.action === "readmit") {
      await c.query(
        "DELETE FROM memory_exclusions WHERE workspace_id=$1 AND kind=$2 AND source_id=$3",
        [workspaceId, b.source.kind, b.source.id],
      );
      await audit(c, actor, "memory.source.readmit", b.source.id);
      return { ok: true };
    }
    const entries = (
      await c.query(
        "SELECT m.id,m.key,m.title,m.revision,m.pinned,m.verified,m.automatic FROM memories m JOIN memory_sources s ON s.memory_id=m.id WHERE s.workspace_id=$1 AND m.workspace_id=$1 AND s.kind=$2 AND s.source_id=$3 ORDER BY m.id",
        [workspaceId, b.source.kind, b.source.id],
      )
    ).rows;
    const digest = hash(
      JSON.stringify([workspaceId, b.source, b.include_protected, entries]),
    );
    if (b.action === "preview")
      return { entries, preview_hash: digest, source_data_deleted: false };
    if (b.preview_hash !== digest)
      throw new HttpError(
        409,
        "Gedächtnis wurde geändert. Vorschau erneut laden.",
      );
    const remove = entries
      .filter(
        (e) => b.include_protected || (!e.pinned && !e.verified && e.automatic),
      )
      .map((e) => e.id);
    await c.query(
      "DELETE FROM memories WHERE workspace_id=$1 AND id=ANY($2::text[])",
      [workspaceId, remove],
    );
    await c.query(
      "INSERT INTO memory_exclusions(workspace_id,kind,source_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [workspaceId, b.source.kind, b.source.id],
    );
    await audit(c, actor, "memory.source.forget", b.source.id);
    return {
      ok: true,
      deleted: remove.length,
      protected_retained: entries.length - remove.length,
      source_data_deleted: false,
    };
  });
}
