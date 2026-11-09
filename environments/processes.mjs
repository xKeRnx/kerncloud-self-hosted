import { spawn } from "node:child_process";

// Lives only in the non-root customer controller. Never in the SaaS host.
export function processRegistry({
  cwd,
  overBudget = async () => false,
  environment,
  maxRunning = 4,
  leaseMs = 60000,
}) {
  const processes = new Map();
  const kill = (p) => {
    if (p.child?.pid && p.status === "running") {
      try {
        process.kill(-p.child.pid, "SIGKILL");
      } catch {}
    }
  };
  let measuring = false;
  const sweep = setInterval(async () => {
    if (measuring) return;
    measuring = true;
    let exceeded;
    try {
      exceeded = await overBudget();
    } finally {
      measuring = false;
    }
    const now = Date.now();
    for (const [id, p] of processes) {
      if (p.status === "running" && (exceeded || now - p.touched > leaseMs)) {
        p.canceled = true;
        kill(p);
      }
      if (p.status !== "running" && now - p.finished > 3600000)
        processes.delete(id);
    }
  }, 1000);
  sweep.unref();
  function find(id, scope) {
    const p = processes.get(id);
    if (!p || p.scope !== scope)
      throw new Error(
        "Process unavailable in this task; do not restart an unconfirmed command",
      );
    p.touched = Date.now();
    return p;
  }
  function snapshot(p, cursor = 0) {
    const start = Math.max(p.offset, Math.min(p.offset + p.log.length, cursor));
    return {
      ok:
        p.status === "running" || (p.code === 0 && !p.canceled && !p.timedOut),
      status: p.status,
      process_id: p.id,
      exit_code: p.code ?? null,
      output: p.log.slice(start - p.offset),
      cursor: p.offset + p.log.length,
      truncated: cursor < p.offset,
      canceled: !!p.canceled,
      timed_out: !!p.timedOut,
    };
  }
  async function wait(p, seconds, cursor, signal) {
    const abort = () => {
      p.canceled = true;
      kill(p);
    };
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (p.status === "running")
        await Promise.race([
          p.done,
          new Promise((r) => {
            const t = setTimeout(r, seconds * 1000);
            p.done.then(() => {
              clearTimeout(t);
              r();
            });
          }),
        ]);
      signal?.throwIfAborted();
      return snapshot(p, cursor);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  return {
    async start(args, id, scope, signal) {
      if (typeof scope !== "string" || !scope)
        throw new Error("Task scope required");
      if (processes.has(id)) return snapshot(find(id, scope));
      if (
        [...processes.values()].filter((p) => p.status === "running").length >=
        maxRunning
      )
        throw new Error("Environment process limit reached");
      for (const [key, p] of processes)
        if (processes.size >= 32 && p.status !== "running")
          processes.delete(key);
      const directory = await cwd(args.cwd ?? ".");
      signal?.throwIfAborted();
      const p = {
        id,
        scope,
        status: "running",
        log: "",
        offset: 0,
        touched: Date.now(),
        finished: 0,
      };
      processes.set(id, p);
      p.done = new Promise((resolve) => {
        const child = (p.child = spawn("/bin/bash", ["-lc", args.command], {
          cwd: directory,
          env: environment(),
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        }));
        const append = (d) => {
          p.log += d.toString();
          if (p.log.length > 24000) {
            const n = p.log.length - 24000;
            p.log = p.log.slice(n);
            p.offset += n;
          }
        };
        child.stdout.on("data", append);
        child.stderr.on("data", append);
        const timer = setTimeout(
          () => {
            p.timedOut = true;
            kill(p);
          },
          Math.min(1800, Math.max(1, args.timeout_seconds ?? 300)) * 1000,
        );
        let finished = false;
        const finish = (code, error) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          kill(p);
          p.status = "exited";
          p.code = code;
          p.finished = Date.now();
          if (error) append(Buffer.from(String(error.message).slice(0, 300)));
          resolve();
        };
        child.on("error", (error) => finish(null, error));
        child.on("close", (code) => finish(code));
      });
      return wait(
        p,
        Math.min(20, Math.max(0, args.yield_seconds ?? 1)),
        0,
        signal,
      );
    },
    async action(args, scope, signal) {
      const p = find(args.process_id, scope);
      if (args.action === "stop") {
        p.canceled = true;
        kill(p);
        return wait(p, 2, args.cursor ?? 0, signal);
      }
      return wait(p, args.action === "wait" ? 20 : 0, args.cursor ?? 0, signal);
    },
    close() {
      clearInterval(sweep);
      for (const p of processes.values()) {
        p.canceled = true;
        kill(p);
      }
    },
  };
}
