import fs from "node:fs";
import {
  readDeployment,
  writeDeployment,
  assertRollbackSchema,
} from "./deployment-state.mjs";
import { imageDistribution } from "./image-distribution.mjs";
import { ensureLocalNetworks, networkSettings } from "./local-network.mjs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runProcess, parseServices } from "./local-process.mjs";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}
export function prepare(root = projectRoot, options = {}) {
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) {
    const old = parseEnv(fs.readFileSync(envFile, "utf8"));
    if (old.DEPLOYMENT_MODE !== "self-hosted")
      throw Error(
        "Existing installation is not self-hosted. Use a separate folder; no account or secret conversion is performed.",
      );
    for (const key of [
      "POSTGRES_PASSWORD",
      "ENCRYPTION_KEY",
      "WORKER_TOKEN",
      "APP_TOKEN",
      "ADMIN_EMAIL",
      "ADMIN_PASSWORD",
      "KERNCLOUD_COMPOSE_PROJECT",
      "KERNCLOUD_PORT",
    ])
      if (!old[key])
        throw Error(
          "Existing configuration is incomplete: " +
            key +
            ". Restore your configuration; secrets are never silently replaced.",
        );
    return { created: false, config: old };
  }
  const port = Number(options.port ?? 3100),
    gatewayPort = Number(options.gatewayPort ?? 3200);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !Number.isInteger(gatewayPort) ||
    gatewayPort < 1024 ||
    gatewayPort > 65535 ||
    port === gatewayPort
  )
    throw Error("Invalid local ports");
  const database = options.database ?? "kerncloud";
  if (!/^[a-z][a-z0-9_]{0,50}$/.test(database))
    throw Error("Invalid database name");
  const project =
    options.project ??
    "kerncloud-selfhost-" +
      createHash("sha256")
        .update(path.resolve(root))
        .digest("hex")
        .slice(0, 10);
  if (!/^[a-z][a-z0-9_-]{1,60}$/.test(project))
    throw Error("Invalid Compose project");
  const email = options.email ?? "admin@kerncloud.local";
  if (!/^[^\s=@]+@[^\s=]+$/.test(email))
    throw Error("Invalid administrator email");
  const password = randomBytes(24).toString("hex");
  const config = {
    DEPLOYMENT_MODE: "self-hosted",
    ALLOW_REGISTRATION: "false",
    KERNCLOUD_COMPOSE_PROJECT: project,
    KERNCLOUD_PORT: String(port),
    KERNCLOUD_GATEWAY_PORT: String(gatewayPort),
    KERNCLOUD_DB_NAME: database,
    KERNCLOUD_IMAGE: "kerncloud-selfhost:0.40.0",
    KERNCLOUD_BIND_ADDRESS: "127.0.0.1",
    POSTGRES_PASSWORD: password,
    DATABASE_URL:
      "postgresql://kerncloud:" + password + "@postgres:5432/" + database,
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    WORKER_TOKEN: randomBytes(32).toString("hex"),
    APP_TOKEN: randomBytes(32).toString("hex"),
    ADMIN_EMAIL: email,
    ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
    PUBLIC_URL: "http://localhost:" + port,
    PLATFORM_URL: "http://localhost:" + port,
    PUBLIC_ENVIRONMENT_URL: "http://localhost:" + gatewayPort,
    ALLOW_LOCAL_ENDPOINTS: "true",
    WORKER_CONCURRENCY: "2",
  };
  fs.writeFileSync(
    envFile,
    Object.entries(config)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return { created: true, config };
}
export function currentImage(root = projectRoot) {
  const override = readDeployment(root, ".local-rollback-active.json");
  return (
    override?.app ??
    imageDistribution(
      root,
      fs.existsSync(path.join(root, ".env"))
        ? parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"))
        : {},
    ).app
  );
}
function imageEnvironment(root) {
  const override = readDeployment(root, ".local-rollback-active.json");
  const distribution =
    override ??
    imageDistribution(
      root,
      fs.existsSync(path.join(root, ".env"))
        ? parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"))
        : {},
    );
  return {
    ...process.env,
    KERNCLOUD_IMAGE: distribution.app,
    KERNCLOUD_VALIDATOR_IMAGE: distribution.validator,
  };
}
export function configureNetwork(root, input) {
  const config = prepare(root).config,
    next = { ...config, ...networkSettings(input) };
  const temp = path.join(root, ".env.network-update");
  fs.writeFileSync(
    temp,
    Object.entries(next)
      .map(([k, v]) => k + "=" + v)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  fs.renameSync(temp, path.join(root, ".env"));
  return next;
}
export function dockerArgs(config, ...args) {
  return [
    "compose",
    "--project-name",
    config.KERNCLOUD_COMPOSE_PROJECT,
    "--env-file",
    ".env",
    "-f",
    "compose.self-hosted.yaml",
    ...(fs.existsSync(".local-networks.yaml")
      ? ["-f", ".local-networks.yaml"]
      : []),
    ...args,
  ];
}
export async function runDocker(args, root = projectRoot) {
  const r = await runProcess("docker", args, {
    cwd: root,
    env: imageEnvironment(root),
  });
  if (r.status !== 0)
    throw Error(
      "Docker command failed. Configuration and volumes have been preserved.",
    );
}
async function captureDocker(args, root = projectRoot) {
  return runProcess("docker", args, {
    cwd: root,
    capture: true,
    timeout: 20000,
    env: imageEnvironment(root),
  });
}
export async function doctor(root = projectRoot) {
  for (const args of [
    ["version", "--format", "{{.Server.Os}}"],
    ["compose", "version"],
  ]) {
    const r = await captureDocker(args, root);
    if (r.status !== 0)
      throw Error(
        "Docker Engine with Compose v2 must be installed and running.",
      );
    if (args[0] === "version" && r.stdout.trim() !== "linux")
      throw Error("Switch Docker to Linux containers.");
  }
  console.log("Docker Linux engine and Compose are available.");
}
export async function readServices(root, config) {
  const r = await captureDocker(
    dockerArgs(config, "ps", "--all", "--format", "json"),
    root,
  );
  if (r.status !== 0)
    throw Error(
      "Could not read the local service status. Check Docker and try again.",
    );
  return parseServices(r.stdout.trim() || "[]");
}
export async function imagesAvailable(root, config) {
  const catalog = await captureDocker(
    dockerArgs(config, "config", "--images"),
    root,
  );
  if (catalog.status !== 0)
    throw Error("Docker could not read the local service configuration.");
  const images = [
    ...new Set(
      catalog.stdout
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  if (!images.length) return false;
  return (
    (
      await captureDocker(
        ["image", "inspect", ...images, "--format", "{{.Id}}"],
        root,
      )
    ).status === 0
  );
}
export async function waitForHealth(port, timeout = 300000, report = () => {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/api/health", {
        signal: AbortSignal.timeout(2500),
      });
      if (r.ok) return;
    } catch {}
    report({ phase: "health" });
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error(
    "The workspace is not ready yet. Check service status and the local setup log. Existing data has been preserved.",
  );
}
export async function main(
  args = process.argv.slice(2),
  root = projectRoot,
  hooks = {},
) {
  const command = args[0] ?? "help";
  process.chdir(root);
  if (command === "help") {
    console.log(
      "KeRnCloud local: init | doctor | start | stop | status | logs | backup | update | rollback\ninit options: --port 3100 --gateway-port 3200 --email you@example.com\nCredentials: ADMIN_EMAIL and ADMIN_PASSWORD in the private .env file.",
    );
    return;
  }
  if (
    ![
      "init",
      "doctor",
      "start",
      "stop",
      "status",
      "logs",
      "backup",
      "update",
      "rollback",
    ].includes(command)
  )
    throw Error("Unknown command");
  const options = {};
  for (let i = 1; i < args.length; i += 2) {
    const keys = {
      "--port": "port",
      "--gateway-port": "gatewayPort",
      "--email": "email",
    };
    if (!keys[args[i]] || !args[i + 1]) throw Error("Invalid option");
    options[keys[args[i]]] = args[i + 1];
  }
  const report = (event) => hooks.onProgress?.(event);
  if (command === "doctor") {
    report({ phase: "docker" });
    await doctor(root);
    return;
  }
  const { created, config } = prepare(root, options);
  if (command === "init") {
    console.log(
      created
        ? "Created private local configuration."
        : "Existing secrets and configuration preserved.",
    );
    return;
  }
  report({ phase: "docker" });
  await doctor(root);
  const compose = (...a) => runDocker(dockerArgs(config, ...a), root);
  if (command === "start") {
    report({ phase: "prepare" });
    ensureLocalNetworks(root, config);
    report({ phase: "build" });
    if (!(await imagesAvailable(root, config))) {
      if (imageDistribution(root, config).mode === "registry")
        await compose("pull", "postgres");
      if (imageDistribution(root, config).mode === "registry")
        await compose(
          "pull",
          "app",
          "worker",
          "scheduler",
          "gateway",
          "object-storage",
          "artifact-validator",
        );
      else await compose("--progress", "plain", "build");
    } else {
      report({ phase: "build", reusedImages: true });
      console.log(
        "Existing local images are available; no server rebuild needed.",
      );
    }
    report({ phase: "services" });
    await compose(
      "up",
      "-d",
      "--no-build",
      "--pull",
      "missing",
      "--scale",
      "worker=2",
    );
    report({ phase: "health" });
    await waitForHealth(config.KERNCLOUD_PORT, 300000, report);
    console.log("Ready: " + config.PUBLIC_URL + "/login");
  }
  if (command === "stop") {
    report({ phase: "stopping" });
    await compose("stop");
  }
  if (command === "status") {
    report({ phase: "status" });
    const services = await readServices(root, config);
    hooks.onServices?.(services);
    for (const s of services)
      console.log(
        s.service + ": " + s.state + (s.health ? " (" + s.health + ")" : ""),
      );
  }
  if (command === "logs")
    await compose("logs", "--tail", "80", "app", "worker");
  if (command === "backup") {
    report({ phase: "backup" });
    await backup(root, config);
  }
  const migrations = async () => {
    const r = await captureDocker(
      dockerArgs(
        config,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "kerncloud",
        "-d",
        config.KERNCLOUD_DB_NAME,
        "-t",
        "-A",
        "-c",
        "SELECT string_agg(version::text,',' ORDER BY version) FROM schema_migrations;",
      ),
      root,
    );
    if (r.status !== 0 || !/^\d+(?:,\d+)*$/.test(r.stdout.trim()))
      throw Error(
        "Cannot verify the database schema; update/rollback was not started.",
      );
    return r.stdout.trim();
  };
  if (command === "rollback") {
    const saved = readDeployment(root, ".local-rollback.json");
    if (!saved) throw Error("No compatible local image checkpoint exists.");
    assertRollbackSchema(saved, await migrations());
    const active = await captureDocker(
      dockerArgs(
        config,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "kerncloud",
        "-d",
        config.KERNCLOUD_DB_NAME,
        "-t",
        "-A",
        "-c",
        "SELECT count(*) FROM runs WHERE status NOT IN ('completed','failed','canceled');",
      ),
      root,
    );
    if (active.status !== 0 || active.stdout.trim() !== "0")
      throw Error("Finish or cancel unfinished tasks before rollback.");
    await runDocker(
      ["image", "inspect", saved.app, saved.validator, "--format", "{{.Id}}"],
      root,
    );
    await backup(root, config);
    writeDeployment(root, ".local-rollback-active.json", saved);
    await compose(
      "up",
      "-d",
      "--no-build",
      "--pull",
      "never",
      "--scale",
      "worker=2",
    );
    await waitForHealth(config.KERNCLOUD_PORT, 300000, report);
    console.log(
      "Previous images restored. Database, configuration and permissions were retained.",
    );
  }
  if (command === "update") {
    report({ phase: "update-check" });
    const r = await captureDocker(
      dockerArgs(
        config,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "kerncloud",
        "-d",
        config.KERNCLOUD_DB_NAME,
        "-t",
        "-A",
        "-c",
        "SELECT count(*) FROM runs WHERE status NOT IN ('completed','failed','canceled');",
      ),
      root,
    );
    if (r.status !== 0 || r.stdout.trim() !== "0")
      throw Error(
        "Finish or cancel unfinished tasks first. Update has not started.",
      );
    report({ phase: "backup" });
    await backup(root, config);
    const previous = { schema: 1, migrations: await migrations() };
    for (const [key, service] of [
      ["app", "app"],
      ["validator", "artifact-validator"],
    ]) {
      const containers = await captureDocker(
        dockerArgs(config, "ps", "--all", "--quiet", service),
        root,
      );
      const id = containers.stdout.trim();
      if (containers.status !== 0 || !/^[a-f0-9]{12,64}$/.test(id))
        throw Error(
          "Cannot preserve the running image checkpoint. Update was not started.",
        );
      const inspected = await captureDocker(
        ["inspect", id, "--format", "{{.Image}}"],
        root,
      );
      if (inspected.status !== 0) throw Error("Image checkpoint unavailable");
      previous[key] = inspected.stdout.trim();
    }
    writeDeployment(root, ".local-rollback.json", previous);
    fs.rmSync(path.join(root, ".local-rollback-active.json"), { force: true });
    report({ phase: "prepare" });
    ensureLocalNetworks(root, config);
    report({ phase: "build" });
    if (imageDistribution(root, config).mode === "registry")
      await compose("pull", "postgres");
    if (imageDistribution(root, config).mode === "registry")
      await compose(
        "pull",
        "app",
        "worker",
        "scheduler",
        "gateway",
        "object-storage",
        "artifact-validator",
      );
    else await compose("--progress", "plain", "build");
    report({ phase: "services" });
    await compose(
      "up",
      "-d",
      "--no-build",
      "--pull",
      "missing",
      "--scale",
      "worker=2",
    );
    report({ phase: "health" });
    await waitForHealth(config.KERNCLOUD_PORT, 300000, report);
    console.log("Updated; secrets, database and object volumes retained.");
  }
}
async function pipeToFile(args, destination, root) {
  const child = spawn("docker", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  const out = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
  await Promise.all([
    new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error("Backup command failed")),
      );
    }),
    new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
      child.stdout.on("error", reject);
      child.stdout.pipe(out);
    }),
  ]);
}
export async function backup(root, config) {
  const folder = path.join(root, "backups");
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stamp =
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomBytes(3).toString("hex"),
    base = path.join(folder, stamp);
  await pipeToFile(
    dockerArgs(
      config,
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      "kerncloud",
      "-Fc",
      config.KERNCLOUD_DB_NAME,
    ),
    base + ".dump",
    root,
  );
  await pipeToFile(
    dockerArgs(
      config,
      "exec",
      "-T",
      "object-storage",
      "tar",
      "-C",
      "/data",
      "-czf",
      "-",
      ".",
    ),
    base + ".objects.tar.gz",
    root,
  );
  fs.writeFileSync(
    base + ".manifest.json",
    JSON.stringify(
      {
        database: path.basename(base) + ".dump",
        objects: path.basename(base) + ".objects.tar.gz",
        requires:
          "Preserve the matching private .env / ENCRYPTION_KEY separately",
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log("Backup saved. Preserve the matching .env separately.");
  return base;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
