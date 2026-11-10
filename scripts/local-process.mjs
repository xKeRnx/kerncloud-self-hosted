import { spawn } from "node:child_process";

// Commands are selected by the local CLI, never accepted from dashboard content.
export function runProcess(
  command,
  args,
  { cwd, env = process.env, capture = false, timeout = 1800000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-2_000_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-5000);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        Error(
          "Docker could not start. Install Docker Desktop/Engine and start its Linux engine.",
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(
          Error(
            "The local command reached its time limit. Check the details and Docker status. Existing data has been preserved.",
          ),
        );
      else resolve({ status: code, stdout, stderr });
    });
  });
}

export function parseServices(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  if (!Array.isArray(rows)) rows = [rows];
  return rows.map((row) => ({
    name: String(row.Name ?? row.Service ?? "service").slice(0, 120),
    service: String(row.Service ?? "service").slice(0, 80),
    state: String(row.State ?? "unknown")
      .toLowerCase()
      .slice(0, 30),
    health: String(row.Health ?? "")
      .toLowerCase()
      .slice(0, 30),
  }));
}
