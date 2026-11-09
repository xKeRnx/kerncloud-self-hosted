import { storageGuard } from "./storage-budget.mjs";
import { projectCheckpoints } from "./checkpoints.mjs";
import { processRegistry } from "./processes.mjs";
import http from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const token = process.env.KERNCLOUD_CONTROL_TOKEN ?? "",
  root = "/home/runner/project";
if (token.length < 40 || process.getuid?.() === 0)
  throw new Error("Non-root controller credentials required");
await fs.mkdir(root, { recursive: true });
const project = await fs.realpath(root),
  cache = new Map();
const storage = storageGuard(project);
const checkpoints = projectCheckpoints(
  project,
  path.join(path.dirname(project), ".kerncloud-checkpoints"),
);
let busy = false,
  browserPromise;
const pages = new Map();
const limit = 12000;
function inside(value) {
  return value === project || value.startsWith(project + path.sep);
}
async function projectPath(input, write = false) {
  if (
    typeof input !== "string" ||
    input.includes("\0") ||
    path.isAbsolute(input)
  )
    throw new Error("Only relative project paths are allowed");
  const target = path.resolve(project, input);
  if (!inside(target)) throw new Error("Path leaves project");
  let existing = target;
  while (true) {
    try {
      const real = await fs.realpath(existing);
      if (!inside(real)) throw new Error("Symlink leaves project");
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (!write) throw e;
      existing = path.dirname(existing);
    }
  }
  return target;
}
function command(args, signal) {
  return new Promise(async (resolve, reject) => {
    let child,
      storageTimer,
      timer,
      stdout = "",
      stderr = "",
      truncated = false,
      timedOut = false;
    const abort = () => {
      if (child?.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
    };
    try {
      const cwd = await projectPath(args.cwd ?? ".");
      if (signal.aborted) throw new Error("Canceled");
      const env = Object.fromEntries(
        ["PATH", "HOME", "LANG", "DISPLAY", "TERM", "TMPDIR"]
          .filter((k) => process.env[k])
          .map((k) => [k, process.env[k]]),
      );
      child = spawn("/bin/bash", ["-lc", args.command], {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      signal.addEventListener("abort", abort, { once: true });
      storageTimer = setInterval(async () => {
        if (await storage.over()) abort();
      }, 1000);
      timer = setTimeout(
        () => {
          timedOut = true;
          abort();
        },
        Math.min(30, Math.max(1, args.timeout_seconds ?? 20)) * 1000,
      );
      child.stdout.on("data", (d) => {
        if (stdout.length < limit)
          stdout += d.toString().slice(0, limit - stdout.length);
        else truncated = true;
      });
      child.stderr.on("data", (d) => {
        if (stderr.length < limit)
          stderr += d.toString().slice(0, limit - stderr.length);
        else truncated = true;
      });
      child.on("error", reject);
      child.on("close", (code, sig) => {
        clearTimeout(timer);
        clearInterval(storageTimer);
        signal.removeEventListener("abort", abort);
        // Detached subprocesses in the original process group do not survive the tool call.
        abort();
        resolve({
          ok: code === 0 && !signal.aborted && !timedOut,
          exit_code: code,
          signal: sig,
          stdout,
          stderr,
          truncated,
          timed_out: timedOut,
          canceled: signal.aborted,
        });
      });
    } catch (e) {
      clearTimeout(timer);
      clearInterval(storageTimer);
      signal.removeEventListener("abort", abort);
      abort();
      reject(e);
    }
  });
}
async function browser() {
  if (process.env.KERNCLOUD_BROWSER !== "true")
    throw new Error("No browser in this environment");
  if (!browserPromise)
    browserPromise = (async () => {
      const { chromium } = await import(
        pathToFileURL("/opt/kerncloud/node_modules/playwright-core/index.mjs")
          .href
      );
      const b = await chromium.connectOverCDP("http://127.0.0.1:9222", {
        timeout: 5000,
      });
      b.on("disconnected", () => {
        browserPromise = undefined;
        pages.clear();
      });
      return b;
    })().catch((e) => {
      browserPromise = undefined;
      throw e;
    });
  return browserPromise;
}
async function browserAction(args, signal) {
  const b = await browser(),
    context = b.contexts()[0];
  for (const p of context.pages())
    if (![...pages.values()].includes(p)) pages.set(randomUUID(), p);
  for (const [id, p] of pages) if (p.isClosed()) pages.delete(id);
  let page = args.tab ? pages.get(args.tab) : [...pages.values()].at(-1);
  if (args.action === "new_tab" || (!page && !args.tab)) {
    page = await context.newPage();
    pages.set(randomUUID(), page);
  }
  if (!page) throw new Error("Tab not found; use tabs");
  if (args.action === "tabs")
    return {
      ok: true,
      tabs: await Promise.all(
        [...pages].map(async ([id, p]) => ({
          id,
          url: p.url(),
          title: (await p.title()).slice(0, 200),
        })),
      ),
    };
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  signal.throwIfAborted();
  if (args.action === "navigate" || (args.action === "new_tab" && args.url)) {
    const url = new URL(args.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Browser URL must be HTTP(S) without credentials");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  } else if (args.action === "close_tab") {
    await page.close();
    return { ok: true, closed: true };
  } else if (args.action === "click" || args.action === "fill") {
    if (!/^r\d{1,5}$/.test(args.ref ?? ""))
      throw new Error("Read snapshot first and provide a valid ref");
    const locator = page.locator(`[data-kc-ref="${args.ref}"]`);
    if (args.action === "click") await locator.click();
    else await locator.fill(args.text ?? "");
  } else if (args.action === "press") {
    if (args.ref)
      await page
        .locator(`[data-kc-ref="${args.ref}"]`)
        .press(args.key ?? "Enter");
    else await page.keyboard.press(args.key ?? "Enter");
  } else if (args.action === "scroll")
    await page.mouse.wheel(0, args.direction === "up" ? -650 : 650);
  signal.throwIfAborted();
  await page.bringToFront();
  const snapshot = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll(
        'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]',
      ),
    ]
      .filter((e) => e.getClientRects().length)
      .slice(0, 160);
    document
      .querySelectorAll("[data-kc-ref]")
      .forEach((e) => e.removeAttribute("data-kc-ref"));
    return {
      text: (document.body?.innerText ?? "").slice(0, 12000),
      elements: els.map((e, i) => {
        const ref = "r" + (i + 1);
        e.setAttribute("data-kc-ref", ref);
        return {
          ref,
          tag: e.tagName.toLowerCase(),
          role: e.getAttribute("role"),
          text: (e.innerText ?? "").slice(0, 120),
          label: e.getAttribute("aria-label"),
          name: e.getAttribute("name"),
          placeholder: e.getAttribute("placeholder"),
          type: e.getAttribute("type"),
        };
      }),
    };
  });
  return {
    ok: true,
    tab: [...pages].find(([, p]) => p === page)?.[0],
    url: page.url(),
    title: (await page.title()).slice(0, 200),
    ...snapshot,
  };
}
async function execute(tool, args, signal) {
  storage.configure(args.storage_budget_bytes ?? 1073741824);
  if (tool === "environment_process")
    return processes.action(args, args.process_scope, signal);
  if (tool === "environment_checkpoint") return checkpoints(args, signal);
  if (["environment_command", "environment_write_file"].includes(tool)) {
    if (typeof args.checkpoint_scope !== "string")
      throw new Error("Updated platform required for project checkpoint");
    await checkpoints(
      { action: "ensure", scope: args.checkpoint_scope },
      signal,
    );
  }
  if (tool === "environment_command")
    return args.background
      ? processes.start(
          args,
          args.process_request_id,
          args.process_scope,
          signal,
        )
      : command(args, signal);
  if (tool === "environment_browser") return browserAction(args, signal);
  const target = await projectPath(
    args.path,
    tool === "environment_write_file",
  );
  signal.throwIfAborted();
  if (tool === "environment_read_file") {
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 2000000)
      throw new Error("File too large or not a regular file");
    const content = await fs.readFile(target, "utf8");
    return {
      ok: true,
      path: args.path,
      total_characters: content.length,
      offset: args.offset ?? 0,
      content: content.slice(
        args.offset ?? 0,
        (args.offset ?? 0) + Math.min(16000, args.length ?? 12000),
      ),
    };
  }
  if (tool === "environment_write_file") {
    if (typeof args.content !== "string" || args.content.length > 100000)
      throw new Error("Content too large");
    const old = await fs.stat(target).catch(() => ({ size: 0 }));
    await storage.check(
      args.append
        ? Buffer.byteLength(args.content)
        : Math.max(0, Buffer.byteLength(args.content) - old.size),
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Recheck after creating directories; never follow a symlink outside the project.
    await projectPath(args.path, true);
    signal.throwIfAborted();
    if (args.append) await fs.appendFile(target, args.content, "utf8");
    else {
      const temp = target + ".kc-" + randomUUID();
      await fs.writeFile(temp, args.content, { encoding: "utf8", flag: "wx" });
      await fs.rename(temp, target);
    }
    return {
      ok: true,
      path: args.path,
      bytes: Buffer.byteLength(args.content),
      append: Boolean(args.append),
    };
  }
  throw new Error("Unknown environment tool");
}
const processes = processRegistry({
  cwd: projectPath,
  overBudget: () => storage.over(),
  environment: () =>
    Object.fromEntries(
      ["PATH", "HOME", "LANG", "DISPLAY", "TERM", "TMPDIR"]
        .filter((k) => process.env[k])
        .map((k) => [k, process.env[k]]),
    ),
});
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    processes.close();
    process.exit(0);
  });
const server = http.createServer(async (req, res) => {
  const candidate = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (
    Buffer.byteLength(candidate) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(candidate), Buffer.from(token))
  ) {
    res.writeHead(401);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" && req.url === "/health") {
    res.end(
      JSON.stringify({
        version: 1,
        capabilities: ["processes-v1", "task-scoped-output", "checkpoints"],
        browser: process.env.KERNCLOUD_BROWSER === "true",
      }),
    );
    return;
  }
  if (req.method !== "POST" || req.url !== "/execute") {
    res.writeHead(404);
    res.end("{}");
    return;
  }
  const abort = new AbortController();
  let jobId;
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const timer = setTimeout(() => abort.abort(), 35000);
  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 180000)
        throw new Error("Request too large");
    }
    const job = JSON.parse(body);
    jobId = job.id;
    if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error("Invalid job id");
    if (cache.has(jobId)) {
      res.end(JSON.stringify(cache.get(jobId)));
      return;
    }
    if (busy) {
      res.writeHead(409);
      res.end(JSON.stringify({ ok: false, error: "Environment tool busy" }));
      return;
    }
    busy = true;
    try {
      const result = await execute(job.tool, job.args, abort.signal);
      result.storage_used_bytes = await storage.measure(true);
      if (
        result.storage_used_bytes >
        (job.args.storage_budget_bytes ?? 1073741824)
      ) {
        result.ok = false;
        result.storage_warning =
          "Storage budget exceeded; remove files or increase the budget";
      }
      let encoded = JSON.stringify(result);
      while (encoded.length > 28000 || Buffer.byteLength(encoded) > 90000) {
        result.truncated = true;
        if (result.elements?.length) result.elements.pop();
        else if (result.tabs?.length > 1) result.tabs.pop();
        else if (result.text?.length > 1000)
          result.text = result.text.slice(
            0,
            Math.floor(result.text.length / 2),
          );
        else break;
        encoded = JSON.stringify(result);
      }
      cache.set(jobId, result);
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      if (!res.destroyed) res.end(JSON.stringify(result));
    } finally {
      busy = false;
    }
  } catch (e) {
    if (!res.destroyed)
      res.end(
        JSON.stringify({
          ok: false,
          error: String(e.message ?? "Environment action failed").slice(0, 300),
        }),
      );
  } finally {
    clearTimeout(timer);
  }
});
server.requestTimeout = 40000;
server.headersTimeout = 5000;
server.listen(8090, "0.0.0.0", () =>
  console.log("[Environment] Agent controller ready (non-root)."),
);
