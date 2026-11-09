import { projectFor, assertProjectAgent } from "./organisation.ts";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { transaction, pool } from "./db.ts";
import { HttpError } from "./auth.ts";
import { mentionedAgents } from "../core/mentions.ts";
import { bindAttachments, createRun, event } from "./store.ts";
import type { Workspace } from "../core/types.ts";
type Material = {
  name: string;
  mime: string;
  source: string;
  content: string;
  bytes: number;
};
let parsingDocuments = 0;
const textExtensions =
  /\.(txt|md|mdx|csv|tsv|json|jsonl|xml|html|css|scss|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|cpp|h|hpp|cs|php|sh|sql|yaml|yml|toml|ini|log|svg|rst)$/i;
function extractDocument(kind: string, buffer: Buffer): Promise<string> {
  if (parsingDocuments >= 2)
    throw new HttpError(
      429,
      "Zwei Dokumente werden bereits verarbeitet. Bitte kurz erneut versuchen.",
    );
  parsingDocuments++;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        join(process.cwd(), "src/server/extract-document.mjs"),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
        },
        windowsHide: true,
      },
    );
    let output = "",
      done = false;
    const finish = (error?: Error, text?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(text!);
    };
    const timer = setTimeout(
      () =>
        finish(
          new HttpError(
            422,
            "Dokumentverarbeitung hat zu lange gedauert. Bitte Datei verkleinern.",
          ),
        ),
      20000,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1500000)
        finish(new HttpError(413, "Zu viel Text im Dokument."));
    });
    child.stderr.resume();
    child.on("error", () =>
      finish(new HttpError(422, "Dokumentverarbeitung nicht verfügbar.")),
    );
    child.on("exit", () => {
      try {
        const result = JSON.parse(output);
        if (result.error) throw new Error(result.error);
        finish(undefined, result.text);
      } catch {
        finish(
          new HttpError(
            422,
            "Dokument konnte nicht gelesen werden. Maximal 100 PDF-Seiten / 500 KB Text; gescannte PDFs benötigen OCR.",
          ),
        );
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ kind, data: buffer.toString("base64") }));
  }).finally(() => {
    parsingDocuments--;
  }) as Promise<string>;
}
async function storeMaterials(
  workspaceId: string,
  materials: Material[],
  projectId?: string,
) {
  return transaction(async (c) => {
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ]);
    const stats = (
      await c.query(
        "SELECT count(*)::int AS count,coalesce(sum(bytes),0)::int AS bytes FROM attachments WHERE workspace_id=$1",
        [workspaceId],
      )
    ).rows[0];
    if (
      stats.count + materials.length > 100 ||
      stats.bytes + materials.reduce((n, m) => n + m.bytes, 0) > 20000000
    )
      throw new HttpError(
        413,
        "Dateibibliothek voll (100 Dateien / 20 MB). Bitte nicht mehr benötigte Dateien löschen.",
      );
    const project = await projectFor(c, workspaceId, projectId);
    const ids = [];
    for (const m of materials) {
      const id = randomUUID();
      ids.push(id);
      await c.query(
        "INSERT INTO attachments(id,workspace_id,name,mime,source,content,bytes,project_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          workspaceId,
          m.name,
          m.mime,
          m.source,
          m.content,
          m.bytes,
          project.id,
        ],
      );
    }
    return { ids };
  });
}
export async function uploadFiles(
  workspaceId: string,
  form: FormData,
  projectId?: string,
) {
  const files = form.getAll("files");
  if (!files.length || files.length > 10)
    throw new HttpError(400, "Bitte ein bis zehn Dateien wählen.");
  const materials: Material[] = [];
  for (const item of files) {
    if (typeof item === "string" || item.size > 5000000 || !item.size)
      throw new HttpError(
        413,
        "Dateien müssen zwischen 1 Byte und 5 MB groß sein.",
      );
    const name = item.name
      .replaceAll("\\", "/")
      .split("/")
      .pop()!
      .slice(0, 200);
    if (
      !textExtensions.test(name) &&
      !/(^Dockerfile$|^Makefile$|\.pdf$|\.docx$)/i.test(name)
    )
      throw new HttpError(
        415,
        `Dateityp nicht unterstützt: ${name}. Text, Code, PDF oder DOCX verwenden.`,
      );
    const buffer = Buffer.from(await item.arrayBuffer());
    let content: string;
    if (/\.(pdf|docx)$/i.test(name))
      content = await extractDocument(
        name.endsWith(".pdf") ? "pdf" : "docx",
        buffer,
      );
    else {
      if (buffer.includes(0))
        throw new HttpError(415, "Binärdateien werden hier nicht eingelesen.");
      content = buffer.toString("utf8");
    }
    if (!content.trim())
      throw new HttpError(422, `${name} enthält keinen lesbaren Text.`);
    if (Buffer.byteLength(content) > 500000)
      throw new HttpError(413, `${name}: maximal 500 KB Text pro Datei.`);
    materials.push({
      name,
      mime: item.type || "text/plain",
      source: "Upload",
      content,
      bytes: Buffer.byteLength(content),
    });
  }
  return storeMaterials(workspaceId, materials, projectId);
}
export function githubLocation(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "Bitte eine GitHub-Repository-URL eingeben.");
  }
  const parts = url.pathname
    .replace(/\.git\/?$/, "")
    .split("/")
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    parts.length !== 2 ||
    !parts.every((x) => /^[\w.-]+$/.test(x))
  )
    throw new HttpError(
      400,
      "Erwartet: https://github.com/owner/repository. Branch separat angeben.",
    );
  return { owner: parts[0], repo: parts[1] };
}
export async function importRepository(
  workspaceId: string,
  body: unknown,
  projectId?: string,
) {
  const b = z
    .object({
      url: z.string().max(500),
      branch: z.string().max(150).optional(),
      token: z.string().max(2000).optional(),
    })
    .parse(body);
  const { owner, repo } = githubLocation(b.url);
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  async function request(path: string) {
    const res = await fetch(`${base}${path}`, {
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "KeRnCloud-local",
        ...(b.token ? { Authorization: `Bearer ${b.token}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
      throw new HttpError(
        422,
        `GitHub meldet HTTP ${res.status}. Repository-Zugang, Branch und API-Limit prüfen.`,
      );
    const raw = await res.text();
    if (raw.length > 8000000)
      throw new HttpError(413, "Repository-Struktur zu groß.");
    return JSON.parse(raw);
  }
  const metadata = await request("");
  const branch = b.branch?.trim() || metadata.default_branch;
  const commit = await request(`/commits/${encodeURIComponent(branch)}`);
  const tree = await request(
    `/git/trees/${commit.commit.tree.sha}?recursive=1`,
  );
  if (tree.truncated)
    throw new HttpError(
      413,
      "Repository-Struktur zu groß für den lokalen Import.",
    );
  const candidates = (
    tree.tree as { path: string; type: string; sha: string; size: number }[]
  ).filter(
    (f) =>
      f.type === "blob" &&
      f.size < 100000 &&
      (textExtensions.test(f.path) ||
        /(^|\/)(Dockerfile|Makefile)$/.test(f.path)) &&
      !/(^|\/)(node_modules|vendor|dist|build|\.git)(\/|$)/.test(f.path) &&
      !/(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f.path),
  );
  candidates.sort(
    (a, b) =>
      Number(!/readme/i.test(a.path)) - Number(!/readme/i.test(b.path)) ||
      a.path.localeCompare(b.path),
  );
  const selected = candidates.slice(0, 12),
    materials: Material[] = [];
  let bytes = 0;
  for (const f of selected) {
    const blob = await request(`/git/blobs/${f.sha}`);
    if (blob.encoding !== "base64") continue;
    const buffer = Buffer.from(blob.content, "base64");
    if (buffer.includes(0) || bytes + buffer.length > 750000) continue;
    bytes += buffer.length;
    const content = buffer.toString("utf8");
    materials.push({
      name: `${repo}/${f.path}`.slice(0, 200),
      mime: "text/plain",
      source: `GitHub ${owner}/${repo}@${commit.sha}`,
      content,
      bytes: Buffer.byteLength(content),
    });
  }
  const manifest = `Repository: ${b.url}\nBranch: ${branch}\nCommit: ${commit.sha}\nImportierte Dateien: ${materials.map((m) => m.name).join(", ")}\nBegrenzter Text-Snapshot: maximal 12 Dateien / 750 KB; kein Git-Checkout, keine Ausführung oder Schreibberechtigung.\nDateibaum:\n${tree.tree
    .slice(0, 2000)
    .map((f: { path: string }) => f.path)
    .join("\n")}`;
  materials.unshift({
    name: `${repo}/REPOSITORY-IMPORT.txt`,
    mime: "text/plain",
    source: `GitHub ${owner}/${repo}@${commit.sha}`,
    content: manifest,
    bytes: Buffer.byteLength(manifest),
  });
  return {
    ...(await storeMaterials(workspaceId, materials, projectId)),
    commit: commit.sha,
    imported: materials.length - 1,
    available: candidates.length,
  };
}
export async function sendChat(workspace: Workspace, body: unknown) {
  const b = z
    .object({
      message: z.string().trim().min(1).max(12000),
      agentIds: z.array(z.string().uuid()).max(10).default([]),
      attachmentIds: z.array(z.string().uuid()).max(20).default([]),
      informationOnly: z.boolean().default(false),
      runId: z.string().uuid().optional(),
    })
    .parse(body);
  if (b.informationOnly) {
    return transaction(async (c) => {
      if (b.runId) {
        const r = (
          await c.query(
            "SELECT id FROM runs WHERE id=$1 AND workspace_id=$2 AND status IN('running','paused','input_required') FOR UPDATE",
            [b.runId, workspace.id],
          )
        ).rows[0];
        if (!r) throw new HttpError(404, "Offener Auftrag fehlt.");
        await bindAttachments(c, workspace.id, b.runId, b.attachmentIds);
        await event(c, workspace.id, b.runId, null, "user_message", b.message);
      }
      if (
        b.attachmentIds.length &&
        (
          await c.query(
            "SELECT id FROM attachments WHERE id=ANY($1::text[]) AND workspace_id=$2",
            [b.attachmentIds, workspace.id],
          )
        ).rowCount !== new Set(b.attachmentIds).size
      )
        throw new HttpError(403, "Fremder Anhang.");
      await c.query(
        "INSERT INTO chat_messages(workspace_id,run_id,author,content,attachment_ids,project_id) VALUES($1,$2,'Du',$3,$4,$5)",
        [
          workspace.id,
          b.runId ?? null,
          b.message,
          JSON.stringify([...new Set(b.attachmentIds)]),
          workspace.project_id ?? null,
        ],
      );
      return { ok: true };
    });
  }
  const agents = (
    await pool.query("SELECT id,name FROM agents WHERE workspace_id=$1", [
      workspace.id,
    ])
  ).rows;
  let mentions: string[];
  try {
    mentions = mentionedAgents(b.message, agents);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const recipients = mentions.length ? mentions : b.agentIds;
  if (b.runId) {
    return transaction(async (c) => {
      const run = (
        await c.query(
          "SELECT * FROM runs WHERE id=$1 AND workspace_id=$2 AND status IN('running','paused','input_required') FOR UPDATE",
          [b.runId, workspace.id],
        )
      ).rows[0];
      if (!run) throw new HttpError(404, "Offener Auftrag fehlt.");
      if (run.status === "paused")
        throw new HttpError(
          409,
          "Bitte den pausierten Auftrag zuerst fortsetzen.",
        );
      if (!recipients.length)
        throw new HttpError(400, "Bitte mindestens einen Agenten ansprechen.");
      await bindAttachments(c, workspace.id, run.id, b.attachmentIds);
      for (const agentId of [...new Set(recipients)]) {
        await assertProjectAgent(c, run.project_id, agentId);
        const agent = (
          await c.query(
            "SELECT * FROM agents WHERE id=$1 AND workspace_id=$2",
            [agentId, workspace.id],
          )
        ).rows[0];
        if (!agent)
          throw new HttpError(403, "Agent gehört nicht zum Workspace.");
        const waiting = (
          await c.query(
            "SELECT * FROM tasks WHERE run_id=$1 AND agent_id=$2 AND status='input_required' FOR UPDATE",
            [run.id, agentId],
          )
        ).rows;
        if (waiting.length) {
          const { providerFor } = await import("./store.ts");
          for (const task of waiting) {
            await providerFor(c, workspace.id, task.model_id ?? agent.model_id);
            await c.query(
              "UPDATE tasks SET status='queued',error=null,messages=$2 WHERE id=$1",
              [
                task.id,
                JSON.stringify([
                  ...task.messages,
                  { role: "user", content: b.message },
                ]),
              ],
            );
          }
        } else {
          const count = (
            await c.query("SELECT count(*) FROM tasks WHERE run_id=$1", [
              run.id,
            ])
          ).rows[0].count;
          if (Number(count) >= 20)
            throw new HttpError(409, "Maximal 20 Teilaufgaben pro Auftrag.");
          const { providerFor } = await import("./store.ts");
          const { provider } = await providerFor(
            c,
            workspace.id,
            agent.model_id,
          );
          await c.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,model_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              run.id,
              workspace.id,
              agentId,
              b.message.slice(0, 100),
              `Übergeordnetes Ziel: ${run.goal}\nNeue Nachricht: ${b.message}`,
              provider.id,
            ],
          );
        }
      }
      await event(c, workspace.id, run.id, null, "user_message", b.message);
      await c.query(
        "INSERT INTO chat_messages(workspace_id,run_id,author,content,attachment_ids) VALUES($1,$2,'Du',$3,$4)",
        [workspace.id, run.id, b.message, JSON.stringify(b.attachmentIds)],
      );
      await c.query(
        "UPDATE runs SET status='running',chat=true,updated_at=now() WHERE id=$1",
        [run.id],
      );
      return { id: run.id };
    });
  }
  const history = (
    await pool.query(
      "SELECT author,content,attachment_ids FROM(SELECT id,author,content,attachment_ids FROM chat_messages WHERE workspace_id=$1 ORDER BY id DESC LIMIT 12) m ORDER BY id",
      [workspace.id],
    )
  ).rows;
  const previousIds = history.flatMap((m) => m.attachment_ids);
  const available = (
    await pool.query(
      "SELECT id FROM attachments WHERE workspace_id=$1 AND id=ANY($2::text[])",
      [workspace.id, previousIds],
    )
  ).rows.map((m) => m.id);
  const ids = [...new Set([...b.attachmentIds, ...available])];
  return createRun(
    workspace,
    b.message,
    recipients[0],
    ids,
    true,
    recipients,
    JSON.stringify(history).slice(-18000),
  );
}
