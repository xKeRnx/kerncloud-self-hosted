import { readBinary } from "./object-storage.ts";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { zipSync, strToU8 } from "fflate";
import { pool } from "./db.ts";
import { HttpError } from "./auth.ts";
import { event } from "./store.ts";
import { applyArtifactPatch } from "../core/artifact-patch.ts";
import {
  artifactPath,
  downloadPath,
  previewKind,
  resultFiles,
} from "../core/artifacts.ts";
import type { Task } from "../core/types.ts";

export async function saveArtifact(
  c: PoolClient,
  task: Task,
  name: string,
  content: string,
) {
  if (
    !name.split("/").at(-1)!.includes(".") &&
    /^\s*(?:<!doctype\s+html|<html)/i.test(content)
  )
    name += ".html";
  let path: string;
  try {
    path = artifactPath(name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  if (
    !content.trim() ||
    content.length > 200000 ||
    Buffer.byteLength(content) > 500000
  )
    throw new HttpError(
      400,
      "Eine Ergebnisdatei muss Inhalt enthalten und darf höchstens 200.000 Zeichen bzw. 500 KB umfassen.",
    );
  const existing = await c.query(
    "SELECT id FROM artifacts WHERE task_id=$1 AND name=$2 AND content=$3 AND NOT retired",
    [task.id, path, content],
  );
  if (existing.rowCount)
    return { artifact_id: existing.rows[0].id, name: path };
  const quota = (
    await c.query(
      "SELECT count(*)::int AS count,coalesce(sum(octet_length(content)+coalesce(octet_length(binary_data),0)+binary_bytes),0)::int AS bytes FROM artifacts WHERE run_id=$1",
      [task.run_id],
    )
  ).rows[0];
  if (quota.count >= 100 || quota.bytes + Buffer.byteLength(content) > 5000000)
    throw new HttpError(
      409,
      "Ergebnislimit erreicht: maximal 100 Dateien und 5 MB pro Auftrag.",
    );
  // Preserve all versions if separate agents publish the same relative file name.
  if (
    (
      await c.query("SELECT id FROM artifacts WHERE run_id=$1 AND name=$2", [
        task.run_id,
        path,
      ])
    ).rowCount
  )
    path = `version-${randomUUID().slice(0, 8)}/${path}`;
  const id = randomUUID();
  await c.query(
    "INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content) VALUES($1,$2,$3,$4,$5,$6)",
    [id, task.workspace_id, task.run_id, task.id, path, content],
  );
  await event(
    c,
    task.workspace_id,
    task.run_id,
    task.agent_id,
    "artifact",
    `Ergebnis gespeichert: ${path}`,
  );
  return {
    artifact_id: id,
    name: path,
    download: `/api/artifacts/${id}/download`,
    preview: `/api/artifacts/${id}/preview`,
  };
}
export async function patchArtifact(
  c: PoolClient,
  task: Task,
  artifactId: string,
  changes: { find: string; replace: string }[],
) {
  const source = (
    await c.query(
      "SELECT id,name,content FROM artifacts WHERE id=$1 AND workspace_id=$2 AND run_id=$3 AND NOT retired",
      [artifactId, task.workspace_id, task.run_id],
    )
  ).rows[0];
  if (!source)
    throw new HttpError(
      404,
      "Aktive Ergebnisdatei dieses Auftrags nicht gefunden.",
    );
  let content: string;
  try {
    content = applyArtifactPatch(source.content, changes);
  } catch (error) {
    throw new HttpError(409, (error as Error).message);
  }
  if (content === source.content)
    return { artifact_id: source.id, name: source.name, unchanged: true };
  const saved = await saveArtifact(c, task, downloadPath(source.name), content);
  // Keep immutable old downloads, but make the repaired file the current path in previews and ZIPs.
  await c.query("UPDATE artifacts SET retired=true WHERE id=$1", [source.id]);
  await c.query("UPDATE artifacts SET name=$2 WHERE id=$1", [
    saved.artifact_id,
    source.name,
  ]);
  return { ...saved, name: source.name, previous_artifact_id: source.id };
}
export async function saveAnswerFiles(
  c: PoolClient,
  task: Task,
  answer: string,
) {
  if (
    (
      await c.query("SELECT id FROM artifacts WHERE task_id=$1 LIMIT 1", [
        task.id,
      ])
    ).rowCount
  )
    return;
  for (const file of resultFiles(answer))
    await saveArtifact(c, task, file.name, file.content);
}
export const previewCsp =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function previewHtml(
  file: { name: string; content: string },
  siblings: { name: string; content: string }[],
) {
  const kind = previewKind(file.name);
  if (kind === "text")
    return `<!doctype html><meta charset="utf-8"><style>body{margin:24px;background:#fff;color:#17212b;font:14px/1.6 ui-monospace,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escapeHtml(file.content)}</pre>`;
  if (kind === "svg")
    return `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;min-height:100vh}img{max-width:100%;height:auto}</style><img alt="SVG" src="data:image/svg+xml;base64,${Buffer.from(file.content).toString("base64")}">`;
  const directory = downloadPath(file.name).split("/").slice(0, -1);
  function asset(ref: string) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref)) return undefined;
    try {
      const parts = ref.startsWith("/") ? [] : [...directory];
      for (const p of decodeURIComponent(ref.split(/[?#]/)[0]).split("/")) {
        if (p === "..") {
          if (!parts.length) return undefined;
          parts.pop();
        } else if (p && p !== ".") parts.push(p);
      }
      return siblings.find((f) => downloadPath(f.name) === parts.join("/"));
    } catch {
      return undefined;
    }
  }
  function attr(tag: string, name: string) {
    return tag
      .match(
        new RegExp(
          "\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
          "i",
        ),
      )
      ?.slice(1)
      .find((v) => v !== undefined);
  }
  const html = file.content
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const href = attr(tag, "href"),
        found = href && asset(href);
      return attr(tag, "rel")?.toLowerCase() === "stylesheet" &&
        found &&
        /\.css$/i.test(found.name)
        ? `<style>${found.content.replace(/<\/style/gi, "<\\/style")}</style>`
        : tag;
    })
    .replace(
      /<script\b([^>]*)>\s*<\/script\s*>/gi,
      (tag, attributes: string) => {
        const src = attr(attributes, "src"),
          found = src && asset(src);
        return found && /\.(?:js|mjs)$/i.test(found.name)
          ? `<script${attr(attributes, "type") === "module" ? ' type="module"' : ""}>${found.content.replace(/<\/script/gi, "<\\/script")}</script>`
          : tag;
      },
    );
  return '<!doctype html><meta charset="utf-8">' + html;
}
function attachment(content: BodyInit, filename: string, type: string) {
  const safe = downloadPath(filename).split("/").at(-1)!;
  return new Response(content, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${safe.replace(/[^a-zA-Z0-9_.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
export async function artifactResponse(
  workspaceId: string,
  id: string,
  mode: string,
) {
  const file = (
    await pool.query(
      "SELECT id,workspace_id,run_id,name,content,binary_data,binary_object,binary_bytes,binary_sha256,binary_preview FROM artifacts WHERE id=$1 AND workspace_id=$2",
      [id, workspaceId],
    )
  ).rows[0];
  if (!file) throw new HttpError(404, "Ergebnisdatei nicht gefunden.");
  if (mode === "source")
    return Response.json(
      { content: file.content },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  if (mode === "download")
    return attachment(
      (await readBinary(file)) ?? file.content,
      file.name,
      "application/octet-stream",
    );
  const siblings = (
    await pool.query(
      "SELECT name,content FROM artifacts WHERE workspace_id=$1 AND run_id=$2 AND NOT retired ORDER BY created_at",
      [workspaceId, file.run_id],
    )
  ).rows;
  return new Response(file.binary_preview ?? previewHtml(file, siblings), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": previewCsp,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=()",
    },
  });
}
export async function runArchive(workspaceId: string, runId: string) {
  const run = (
    await pool.query("SELECT goal FROM runs WHERE id=$1 AND workspace_id=$2", [
      runId,
      workspaceId,
    ])
  ).rows[0];
  if (!run) throw new HttpError(404, "Auftrag nicht gefunden.");
  const files = (
    await pool.query(
      "SELECT id,workspace_id,name,content,binary_data,binary_object,binary_bytes,binary_sha256 FROM artifacts WHERE run_id=$1 AND workspace_id=$2 AND NOT retired ORDER BY created_at",
      [runId, workspaceId],
    )
  ).rows;
  const tasks = (
    await pool.query(
      "SELECT id,title,status,result,error FROM tasks WHERE run_id=$1 AND workspace_id=$2",
      [runId, workspaceId],
    )
  ).rows;
  const zip: Record<string, Uint8Array> = Object.create(null);
  let bytes = 0;
  for (const f of files) {
    const name = downloadPath(f.name),
      path = zip[name] ? `version-${f.id}/${name}` : name;
    const binary = await readBinary(f);
    bytes += binary?.length ?? Buffer.byteLength(f.content);
    if (bytes > 10000000)
      throw new HttpError(
        413,
        "Ergebnisarchiv zu groß. Bitte Dateien einzeln herunterladen.",
      );
    zip[path] = binary ? new Uint8Array(binary) : strToU8(f.content);
  }
  let metadata = "_kerncloud";
  while (
    Object.keys(zip).some((k) => k === metadata || k.startsWith(metadata + "/"))
  )
    metadata += "_";
  zip[metadata + "/auftrag.md"] = strToU8("# Auftrag\n\n" + run.goal);
  for (const task of tasks)
    zip[`${metadata}/task-${task.id}.md`] = strToU8(
      `# ${task.title}\n\nStatus: ${task.status}\n\n${task.result ?? task.error ?? "Noch kein Ergebnis."}`,
    );
  return attachment(
    new Uint8Array(zipSync(zip, { level: 6 })),
    `kerncloud-${runId.slice(0, 8)}.zip`,
    "application/zip",
  );
}
