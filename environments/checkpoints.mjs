import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const excluded = (part) =>
  [
    ".git",
    "node_modules",
    ".next",
    ".cache",
    "dist",
    "build",
    "__pycache__",
    ".ssh",
    ".kerncloud-checkpoints",
    ".npmrc",
    ".netrc",
    ".pypirc",
    "credentials",
    "id_rsa",
    "id_ed25519",
  ].includes(part) ||
  /^\.env(?:\.|$)/i.test(part) ||
  /\.(pem|key|p12|pfx|sqlite|sqlite3|db)(-wal|-shm)?$/i.test(part);
const maxBytes = 8 * 1024 * 1024,
  maxFiles = 300,
  maxFileBytes = 1024 * 1024;
// Local, bounded project-file snapshots. No shell, Git hooks or remote storage.
export function projectCheckpoints(root, directory) {
  let tail = Promise.resolve();
  async function scan() {
    const files = {},
      skipped = [];
    let bytes = 0,
      entries = 0;
    async function walk(relative = "") {
      for (const ent of await fs.readdir(path.join(root, relative), {
        withFileTypes: true,
      })) {
        if (++entries > 5000)
          throw Error("Project has too many entries for a bounded checkpoint");
        const name = relative ? `${relative}/${ent.name}` : ent.name;
        if (excluded(ent.name)) {
          if (skipped.length < 100) skipped.push(name);
          continue;
        }
        if (ent.isSymbolicLink()) {
          if (skipped.length < 100) skipped.push(name);
          continue;
        }
        if (ent.isDirectory()) {
          await walk(name);
          continue;
        }
        if (!ent.isFile()) {
          if (skipped.length < 100) skipped.push(name);
          continue;
        }
        const full = path.join(root, name);
        const realParent = await fs.realpath(path.dirname(full));
        if (realParent !== root && !realParent.startsWith(root + path.sep))
          throw Error("Checkpoint path leaves project");
        const handle = await fs.open(
          full,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxFileBytes)
            throw Error(`File cannot be safely checkpointed: ${name}`);
          const data = await handle.readFile();
          if (
            data.length > maxFileBytes ||
            (bytes += data.length) > maxBytes ||
            Object.keys(files).length >= maxFiles
          )
            throw Error("Checkpoint limit: 300 files / 8 MiB / 1 MiB per file");
          files[name] = {
            data: data.toString("base64"),
            sha256: hash(data),
            mode: stat.mode & 0o777,
          };
        } finally {
          await handle.close();
        }
      }
    }
    await walk();
    return { files, bytes, skipped };
  }
  const digest = (files) =>
    hash(
      JSON.stringify(
        Object.entries(files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, f]) => [name, f.sha256, f.mode]),
      ),
    );
  async function safeDirectory() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Checkpoint directory must be a real directory");
  }
  async function list() {
    await safeDirectory();
    const rows = [];
    for (const file of await fs.readdir(directory))
      if (/^[a-f0-9-]{36}\.json\.gz$/.test(file)) {
        const s = await load(file.slice(0, 36));
        rows.push({
          scope: s.scope,
          id: s.id,
          name: s.name,
          created_at: s.created_at,
          files: Object.keys(s.files).length,
          bytes: s.bytes,
          skipped: s.skipped,
        });
      }
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async function load(id) {
    if (!/^[a-f0-9-]{36}$/.test(id ?? "")) throw Error("Invalid checkpoint");
    const target = path.join(directory, `${id}.json.gz`),
      stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes * 2)
      throw Error("Invalid checkpoint storage");
    const s = JSON.parse(
      gunzipSync(await fs.readFile(target), { maxOutputLength: maxBytes * 2 }),
    );
    if (
      s.id !== id ||
      !s.files ||
      Array.isArray(s.files) ||
      Object.keys(s.files).length > maxFiles
    )
      throw Error("Invalid checkpoint manifest");
    let total = 0;
    for (const [name, f] of Object.entries(s.files)) {
      if (
        path.isAbsolute(name) ||
        name.includes("\\") ||
        name
          .split("/")
          .some((p) => !p || p === "." || p === ".." || excluded(p)) ||
        !f ||
        typeof f.data !== "string" ||
        !Number.isInteger(f.mode) ||
        f.mode < 0 ||
        f.mode > 0o777 ||
        Buffer.from(f.data, "base64").length > maxFileBytes ||
        (total += Buffer.from(f.data, "base64").length) > maxBytes ||
        hash(Buffer.from(f.data, "base64")) !== f.sha256
      )
        throw Error("Invalid checkpoint entry");
    }
    return s;
  }
  async function create(name, scope) {
    if ((await list()).length >= 10)
      throw Error(
        "Maximum 10 project checkpoints; remove an old checkpoint explicitly first",
      );
    const s = {
      scope,
      id: randomUUID(),
      name: String(name ?? "Checkpoint").slice(0, 100),
      created_at: new Date().toISOString(),
      ...(await scan()),
    };
    await fs.writeFile(
      path.join(directory, `${s.id}.json.gz`),
      gzipSync(JSON.stringify(s)),
      { flag: "wx", mode: 0o600 },
    );
    return {
      ok: true,
      id: s.id,
      files: Object.keys(s.files).length,
      bytes: s.bytes,
      skipped: s.skipped,
    };
  }
  const previews = new Map();
  async function perform(args, signal = new AbortController().signal) {
    signal.throwIfAborted();
    if (args.action === "ensure") {
      if (!/^[a-f0-9-]{36}$/.test(args.scope ?? ""))
        throw Error("Invalid checkpoint scope");
      const existing = (await list()).find((s) => s.scope === args.scope);
      if (existing) return { ok: true, id: existing.id };
      return create("Before task " + args.scope.slice(0, 8), args.scope);
    }
    if (args.action === "list") return { ok: true, checkpoints: await list() };
    if (args.action === "create") return create(args.name);
    const s = await load(args.checkpoint_id);
    if (args.action === "delete") {
      await fs.unlink(path.join(directory, `${s.id}.json.gz`));
      return { ok: true };
    }
    const current = await scan(),
      currentHash = digest(current.files),
      targetHash = digest(s.files);
    const changes = [
      ...new Set([...Object.keys(current.files), ...Object.keys(s.files)]),
    ]
      .filter(
        (n) =>
          current.files[n]?.sha256 !== s.files[n]?.sha256 ||
          current.files[n]?.mode !== s.files[n]?.mode,
      )
      .map((name) => ({
        name,
        action: !s.files[name]
          ? "remove"
          : !current.files[name]
            ? "restore"
            : "replace",
      }));
    if (args.action === "preview") {
      const token = randomUUID();
      previews.set(token, {
        checkpoint: s.id,
        currentHash,
        targetHash,
        expires: Date.now() + 120000,
      });
      if (previews.size > 20) previews.delete(previews.keys().next().value);
      return {
        ok: true,
        token,
        changes,
        skipped: current.skipped,
        expires_in: 120,
      };
    }
    if (args.action !== "restore") throw Error("Unknown checkpoint action");
    const preview = previews.get(args.preview_token);
    if (
      !preview ||
      preview.checkpoint !== s.id ||
      preview.currentHash !== currentHash ||
      preview.targetHash !== targetHash ||
      preview.expires < Date.now()
    )
      throw Error(
        "Files changed or preview expired. Review a fresh preview before restoring.",
      );
    if (!changes.length) return { ok: true, restored: s.id, changed: 0 };
    // Keep an undo point before mutation. Never silently discard checkpoints at capacity.
    const undo = await create(`Before restore ${s.id.slice(0, 8)}`);
    previews.delete(args.preview_token);
    for (const change of changes) {
      signal.throwIfAborted();
      const target = path.join(root, change.name),
        f = s.files[change.name];
      // Check every parent and leaf again; do not traverse project symlinks.
      let parent = root;
      for (const segment of change.name.split("/").slice(0, -1)) {
        parent = path.join(parent, segment);
        try {
          await fs.mkdir(parent);
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
        }
        const st = await fs.lstat(parent);
        if (!st.isDirectory() || st.isSymbolicLink())
          throw Error("Unsafe restore parent");
      }
      let st;
      try {
        st = await fs.lstat(target);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (st && (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1))
        throw Error("Unsafe restore target");
      const observed = st ? hash(await fs.readFile(target)) : null;
      if (observed !== (current.files[change.name]?.sha256 ?? null))
        throw Error(
          "File changed during restore; use the automatic undo checkpoint",
        );
      if (!f) await fs.unlink(target);
      else {
        const temp = target + `.kc-${randomUUID()}`;
        await fs.writeFile(temp, Buffer.from(f.data, "base64"), {
          flag: "wx",
          mode: f.mode,
        });
        await fs.rename(temp, target);
      }
    }
    return {
      ok: true,
      restored: s.id,
      undo_checkpoint: undo.id,
      changed: changes.length,
    };
  }
  return (args, signal) => {
    const next = tail.then(() => perform(args, signal));
    tail = next.catch(() => {});
    return next;
  };
}
