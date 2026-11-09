import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { HttpError } from "./auth.ts";
import {
  memorySource,
  saveMemorySources,
  memoryOrigins,
  attachMemoryOrigins,
} from "./memory-provenance.ts";
export const memoryInput = z.object({
  key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/),
  title: z.string().trim().min(1).max(150),
  content: z.string().trim().min(1).max(8000),
  kind: z.enum(["knowledge", "decision", "work", "history"]),
  status: z.enum(["open", "in_progress", "blocked", "done"]).default("open"),
  evidence: z.string().max(2000).default(""),
  expected_revision: z.number().int().min(1).nullable(),
  pinned: z.boolean().default(false),
  verified: z.boolean().default(false),
  assignee: z.string().uuid().nullable().optional(),
  source_refs: z.array(memorySource).max(12).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});
export type MemoryInput = z.infer<typeof memoryInput>;
export async function listMemory(
  c: PoolClient,
  workspaceId: string,
  query = "",
  full = false,
  projectId?: string | null,
) {
  const rows = (
    await c.query(
      `SELECT id,workspace_id,key,title,${full ? "content," : "substring(content FROM 1 FOR 240) AS preview,"}kind,status,evidence,pinned,verified,automatic,assignee,author,revision,created_at,updated_at,expires_at,(expires_at IS NOT NULL AND expires_at<now()) AS expired FROM memories WHERE workspace_id=$1 AND ($3::text='*' OR project_id=coalesce($3,kc_default_project($1)) OR workspace_shared) AND($2='' OR to_tsvector('simple',title||' '||content) @@ plainto_tsquery('simple',$2) OR title ILIKE '%'||$2||'%') ORDER BY pinned DESC,CASE status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,updated_at DESC LIMIT 100`,
      [workspaceId, query, projectId === null ? "*" : (projectId ?? null)],
    )
  ).rows;
  await attachMemoryOrigins(c, workspaceId, rows);
  return rows;
}
export async function writeMemory(
  c: PoolClient,
  workspaceId: string,
  input: MemoryInput,
  actor: string,
  human = false,
  automatic = false,
  projectId?: string,
) {
  const b = memoryInput.parse(input);
  await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
    workspaceId,
  ]);
  const old = (
    await c.query(
      "SELECT * FROM memories WHERE workspace_id=$1 AND key=$2 AND project_id=coalesce($3,kc_default_project($1)) FOR UPDATE",
      [workspaceId, b.key, projectId ?? null],
    )
  ).rows[0];
  if (
    (old && old.revision !== b.expected_revision) ||
    (!old && b.expected_revision !== null)
  )
    throw new HttpError(
      409,
      "Gedächtniseintrag wurde inzwischen geändert. Aktuelle Version erneut lesen.",
    );
  if (old?.pinned && !human)
    throw new HttpError(
      409,
      "Dieser Eintrag wurde vom Nutzer geschützt. Einen separaten Vorschlag speichern.",
    );
  if (
    !human &&
    old?.kind === "work" &&
    old.status === "in_progress" &&
    old.assignee &&
    old.assignee !== actor
  )
    throw new HttpError(
      409,
      "Diese Arbeit wurde bereits von einem anderen Agenten übernommen. Bitte abstimmen.",
    );
  if (b.kind === "work" && b.status === "done" && b.evidence.trim().length < 10)
    throw new HttpError(
      400,
      "Für abgeschlossene Arbeit bitte einen Beleg angeben (z. B. Datei, Ergebnis oder geprüfter Commit).",
    );
  if (
    !old &&
    Number(
      (
        await c.query("SELECT count(*) FROM memories WHERE workspace_id=$1", [
          workspaceId,
        ])
      ).rows[0].count,
    ) >= 100
  )
    throw new HttpError(
      409,
      "Projektgedächtnis voll (100 Einträge). Bitte nicht mehr benötigte Einträge entfernen.",
    );
  let assignee = human
    ? b.assignee === undefined
      ? (old?.assignee ?? null)
      : b.assignee
    : b.kind === "work" && b.status === "in_progress"
      ? actor
      : (old?.assignee ?? null);
  if (
    assignee &&
    !(
      await c.query("SELECT id FROM agents WHERE id=$1 AND workspace_id=$2", [
        assignee,
        workspaceId,
      ])
    ).rowCount
  )
    throw new HttpError(
      403,
      "Zuständiger Agent gehört nicht zu diesem Workspace.",
    );
  if (old) {
    await c.query(
      "INSERT INTO memory_revisions(memory_id,revision,title,content,kind,status,evidence,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        old.id,
        old.revision,
        old.title,
        old.content,
        old.kind,
        old.status,
        old.evidence,
        old.author,
      ],
    );
    await c.query(
      "DELETE FROM memory_revisions WHERE memory_id=$1 AND revision<$2",
      [old.id, Math.max(0, old.revision - 9)],
    );
  }
  const row = (
    await c.query(
      "INSERT INTO memories(id,workspace_id,key,title,content,kind,status,evidence,pinned,verified,automatic,assignee,author,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(workspace_id,project_id,key) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,kind=EXCLUDED.kind,status=EXCLUDED.status,evidence=EXCLUDED.evidence,pinned=EXCLUDED.pinned,verified=EXCLUDED.verified,automatic=EXCLUDED.automatic,assignee=EXCLUDED.assignee,author=EXCLUDED.author,revision=memories.revision+1,updated_at=now() RETURNING *",
      [
        old?.id ?? randomUUID(),
        workspaceId,
        b.key,
        b.title,
        b.content,
        b.kind,
        b.status,
        b.evidence,
        human ? b.pinned : false,
        human ? b.verified : false,
        automatic,
        assignee,
        actor,
        projectId ?? null,
      ],
    )
  ).rows[0];
  if (b.expires_at !== undefined)
    await c.query("UPDATE memories SET expires_at=$2 WHERE id=$1", [
      row.id,
      b.expires_at,
    ]);
  if (b.source_refs) {
    for (const ref of b.source_refs) {
      const scope =
        ref.kind === "run"
          ? "SELECT 1 FROM runs WHERE id=$1 AND workspace_id=$2 AND project_id=$3"
          : ref.kind === "artifact"
            ? "SELECT 1 FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE a.id=$1 AND a.workspace_id=$2 AND r.project_id=$3"
            : "SELECT 1 FROM attachments WHERE id=$1 AND workspace_id=$2 AND (project_id=$3 OR workspace_shared)";
      if (
        !(await c.query(scope, [ref.id, workspaceId, row.project_id])).rowCount
      )
        throw new HttpError(
          403,
          "Gedächtnisquelle ist nicht für dieses Projekt freigegeben.",
        );
    }
    await saveMemorySources(c, workspaceId, row.id, b.source_refs);
  }
  return {
    ...row,
    expires_at: b.expires_at ?? row.expires_at,
    sources: await memoryOrigins(c, workspaceId, row.id),
  };
}
export async function memoryBrief(
  c: PoolClient,
  workspaceId: string,
  projectId?: string,
) {
  const rows = await listMemory(c, workspaceId, "", false, projectId);
  return JSON.stringify(
    rows.slice(0, 30).map((m) => ({
      key: m.key,
      title: m.title,
      kind: m.kind,
      status: m.status,
      revision: m.revision,
      assignee: m.assignee,
      verified: m.verified,
      pinned: m.pinned,
      stale: m.stale,
      sources: m.sources,
      ...(m.pinned || m.kind === "history" ? { preview: m.preview } : {}),
    })),
  );
}
export async function rememberFinishedRun(
  c: PoolClient,
  workspaceId: string,
  runId: string,
) {
  if (
    (
      await c.query(
        "SELECT 1 FROM memory_exclusions WHERE workspace_id=$1 AND kind='run' AND source_id=$2",
        [workspaceId, runId],
      )
    ).rowCount
  )
    return;
  await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
    workspaceId,
  ]);
  const run = (await c.query("SELECT * FROM runs WHERE id=$1", [runId]))
    .rows[0];
  const old = (
    await c.query("SELECT * FROM memories WHERE workspace_id=$1 AND key=$2", [
      workspaceId,
      `run-${runId}`,
    ])
  ).rows[0];
  if (
    old?.pinned ||
    (old && !old.automatic) ||
    (!old &&
      Number(
        (
          await c.query("SELECT count(*) FROM memories WHERE workspace_id=$1", [
            workspaceId,
          ])
        ).rows[0].count,
      ) >= 100)
  )
    return;
  const tasks = (
    await c.query(
      "SELECT a.name,t.title,t.status,t.result FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.run_id=$1 ORDER BY t.created_at",
      [runId],
    )
  ).rows;
  const content =
    `Ziel: ${run.goal}\n\n${tasks.map((t) => `${t.name}: ${t.title} [${t.status}]\n${t.result ?? ""}`).join("\n\n")}`.slice(
      0,
      8000,
    );
  await writeMemory(
    c,
    workspaceId,
    {
      key: `run-${runId}`,
      title: `Arbeitsstand: ${run.goal}`.slice(0, 150),
      content,
      kind: "history",
      status: run.status === "completed" ? "done" : "blocked",
      evidence: `Auftrag ${runId}; gespeicherte Aufgaben und Ergebnisse. Nicht automatisch als Code- oder Testnachweis geprüft.`,
      expected_revision: old?.revision ?? null,
      pinned: false,
      verified: false,
      source_refs: /^[a-f0-9-]{36}$/i.test(runId)
        ? [{ kind: "run", id: runId }]
        : undefined,
    },
    "system",
    false,
    true,
    run.project_id,
  );
}
export function memoryMarkdown(rows: Record<string, any>[]) {
  return (
    "# Projektgedächtnis\n\nExport aus KeRnCloud. Agentennotizen sind unbestätigt, bis ein Nutzer sie geprüft hat.\n\n" +
    rows
      .map(
        (m) =>
          `## ${m.title}\n\nSchlüssel: ${m.key} · Version: ${m.revision} · ${m.kind} / ${m.status} · ${m.verified ? "Nutzerbestätigt" : "Unbestätigt"}\n\n${m.content}\n\nBelege: ${m.evidence || "Keine"}\n`,
      )
      .join("\n---\n\n")
  );
}
