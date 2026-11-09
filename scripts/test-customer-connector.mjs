import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
const cli = promisify(execFile),
  base = "http://localhost:3101";
const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
url.pathname = "/kerncloud_test";
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
assert.equal(url.pathname, "/kerncloud_test");
process.env.DATABASE_URL = url.toString();
const { pool } = await import("../src/server/db.ts");
const { toolStep, checkpoint } = await import("../src/server/engine.ts");
const id = randomUUID(),
  output = resolve("test-results", `customer-connector-${id}`);
mkdirSync(output, { recursive: true });
const report = {
  started: new Date().toISOString(),
  checks: [],
  cleanup: false,
};
const log = (check, detail = {}) => {
  report.checks.push({ check, ...detail });
  console.log(JSON.stringify({ check, ...detail }));
};
const wait = async (fn, limit = 120) => {
  for (let i = 0; i < limit; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Local connector condition timed out.");
};
async function command(args) {
  const r = await cli("docker", args, {
    cwd: output,
    timeout: 300000,
    maxBuffer: 3000000,
  });
  appendFileSync(join(output, "docker.log"), r.stdout + r.stderr);
  return r.stdout.trim();
}
async function request(path, body, cookie = "", method = "POST") {
  const r = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  if (r.status !== 200)
    throw Error(`${path}: HTTP ${r.status}: ${data.error ?? "error"}`);
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
let host,
  setup = false,
  cookie = "",
  task,
  lease,
  beat,
  workspace;
const environments = [];
try {
  const admin = await request("auth/login", {
    email: "admin@test.local",
    password: "integration-admin-password",
  });
  const signed = await request("auth/signup", {
    email: `connector-e2e-${id}@test.local`,
    name: "Actual Docker connector fixture",
    password: "connector-e2e-fixture-password",
    privacyAccepted: true,
  });
  cookie = signed.cookie;
  let state = (await request("state", undefined, cookie)).data;
  workspace = state.workspace;
  await request(
    "admin/workspace",
    { id: workspace.id, plan_id: "business" },
    admin.cookie,
  );
  const created = (
    await request(
      "customer-hosts",
      {
        action: "create",
        name: "Docker E2E customer host",
        cpu: 4,
        memory: 8192,
      },
      cookie,
    )
  ).data;
  host = created.id;
  const files = unzipSync(Buffer.from(created.archive, "base64"));
  const allowed = new Set([
    ".env.connector",
    ".dockerignore",
    ".gitignore",
    "Dockerfile",
    "package.json",
    "compose.yaml",
    "README.txt",
    "src/core/customer-host.ts",
    "src/infrastructure/customer-agent.ts",
    "src/infrastructure/docker.ts",
    "src/gateway/relay.ts",
    "environments/controller.mjs",
    "environments/checkpoints.mjs",
    "environments/processes.mjs",
    "environments/browser/Dockerfile",
    "environments/browser/start.sh",
    "environments/development/Dockerfile",
    "environments/development/start.sh",
  ]);
  for (const [name, bytes] of Object.entries(files)) {
    assert.ok(allowed.has(name));
    const target = resolve(output, name);
    assert.ok(target.startsWith(output + sep));
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, bytes, { mode: 0o600 });
  }
  await command(["build", "--tag", "kerncloud-customer-connector:0.3", "."]);
  log("downloaded-connector-image-built");
  setup = true;
  await command(["compose", "up", "-d", "connector"]);
  await wait(async () => {
    const h = (
      await request("customer-hosts", undefined, cookie)
    ).data.hosts.find((h) => h.id === host);
    return h?.last_seen && Date.now() - Date.parse(h.last_seen) < 20000;
  });
  log("outbound-customer-connector-online");
  await request(
    "execution-policy",
    { allowHosted: false, hostIds: [host] },
    cookie,
  );
  const balance = (await request("runtime", undefined, cookie)).data.balance;
  const run = randomUUID();
  task = randomUUID();
  lease = randomUUID();
  await pool.query(
    "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Actual customer connector Docker fixture',100)",
    [run, workspace.id],
  );
  await pool.query(
    "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Docker E2E fixture','No model used','running',$5,now()+interval '90 seconds')",
    [task, run, workspace.id, state.agents[0].id, lease],
  );
  beat = setInterval(
    () =>
      void pool
        .query(
          "UPDATE tasks SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2",
          [task, lease],
        )
        .catch(() => {}),
    10000,
  );
  const view = async (id) =>
    (await request("runtime", undefined, cookie)).data.environments.find(
      (e) => e.id === id,
    );
  const manage = async (action, e) =>
    request(
      "environments/manage",
      { action, id: e.id, confirmation: e.name, expectedRate: 1 },
      cookie,
    );
  async function ready(id) {
    return wait(async () => {
      const e = await view(id);
      if (["failed", "uncertain"].includes(e.status))
        throw Error(`Environment failed: ${e.last_error}`);
      return e.status === "running" &&
        e.controller_seen &&
        Date.now() - Date.parse(e.controller_seen) < 20000 &&
        e.relay_seen
        ? e
        : false;
    });
  }
  async function invoke(id, name, args) {
    const r = JSON.parse(
      (
        await toolStep(
          task,
          lease,
          randomUUID(),
          name,
          { environment_id: id, ...args },
          [],
          {},
        )
      ).result,
    );
    return r;
  }
  async function create(template, name) {
    const id = (
      await request(
        "environments/manage",
        {
          action: "book",
          templateId: template,
          name,
          hostId: host,
          expectedRate: 1,
        },
        cookie,
      )
    ).data.id;
    const e = { id, name };
    environments.push(e);
    await manage("start", e);
    await ready(id);
    await request(
      "environments/agents",
      {
        id,
        permissions:
          template === "browser"
            ? ["files", "exec", "browser"]
            : ["files", "exec"],
        agentIds: [state.agents[0].id],
      },
      cookie,
    );
    return e;
  }
  const dev = await create("development", "Local development E2E");
  log("local-development-started");
  assert.equal(
    (
      await invoke(dev.id, "environment_write_file", {
        path: "proof.txt",
        content: "Customer host proof",
      })
    ).ok,
    true,
  );
  assert.equal(
    (await invoke(dev.id, "environment_read_file", { path: "proof.txt" }))
      .content,
    "Customer host proof",
  );
  const executed = await invoke(dev.id, "environment_command", {
    command: "cat proof.txt",
    timeout_seconds: 10,
  });
  assert.equal(executed.exit_code, 0);
  assert.match(executed.stdout, /Customer host proof/);
  log("agent-read-write-and-command-verified");
  await manage("stop", dev);
  await wait(async () => (await view(dev.id)).status === "stopped");
  await manage("start", dev);
  await ready(dev.id);
  assert.equal(
    (await invoke(dev.id, "environment_read_file", { path: "proof.txt" }))
      .content,
    "Customer host proof",
  );
  log("stop-start-preserves-local-files");
  await manage("reset", dev);
  await ready(dev.id);
  assert.equal(
    (await invoke(dev.id, "environment_read_file", { path: "proof.txt" })).ok,
    false,
  );
  log("reset-created-fresh-local-workspace");
  await manage("stop", dev);
  await wait(async () => (await view(dev.id)).status === "stopped");
  await manage("delete", dev);
  await wait(async () => (await view(dev.id)).status === "deleted");
  const browser = await create("browser", "Local browser E2E");
  log("local-browser-started");
  const fixtureName = `kerncloud-fixture-${id}`;
  const network = `kerncloud-net-${browser.id}`;
  const labels = JSON.parse(
    await command([
      "network",
      "inspect",
      "--format",
      "{{json .Labels}}",
      network,
    ]),
  );
  assert.equal(labels["kerncloud.host"], host);
  await command([
    "run",
    "-d",
    "--name",
    fixtureName,
    "--network",
    network,
    "--label",
    `kerncloud.host=${host}`,
    "--label",
    `kerncloud.environment=${browser.id}`,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--memory",
    "64m",
    "--cpus",
    "0.25",
    "--pids-limit",
    "32",
    "--user",
    "1000:1000",
    "node:22-bookworm-slim",
    "node",
    "-e",
    'require("node:http").createServer((q,r)=>r.end(`<html><body><h1>Local browser fixture</h1><button onclick="document.querySelector(\'h1\').textContent=\'Clicked locally\'">Run local</button></body></html>`)).listen(8123,"0.0.0.0")',
  ]);
  let page = await invoke(browser.id, "environment_browser", {
    action: "navigate",
    url: `http://${fixtureName}:8123/`,
  });
  assert.equal(page.ok, true);
  assert.match(page.text, /Local browser fixture/);
  const button = page.elements.find((e) => e.tag === "button");
  assert.ok(button?.ref);
  page = await invoke(browser.id, "environment_browser", {
    action: "click",
    ref: button.ref,
  });
  assert.equal(page.ok, true);
  assert.match(page.text, /Clicked locally/);
  log("agent-browser-navigation-and-click-verified");
  await request(
    "execution-policy",
    { allowHosted: false, hostIds: [] },
    cookie,
  );
  await assert.rejects(() =>
    invoke(browser.id, "environment_read_file", { path: "fixture.mjs" }),
  );
  log("location-revocation-enforced");
  await request(
    "execution-policy",
    { allowHosted: false, hostIds: [host] },
    cookie,
  );
  await manage("stop", browser);
  await wait(async () => (await view(browser.id)).status === "stopped");
  await manage("delete", browser);
  await wait(async () => (await view(browser.id)).status === "deleted");
  const after = (await request("runtime", undefined, cookie)).data.balance;
  assert.equal(after.included, balance.included);
  assert.equal(after.purchased, balance.purchased);
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM runtime_ledger WHERE environment_id=ANY($1::text[]) AND kind IN('usage','reservation')",
        [environments.map((e) => e.id)],
      )
    ).rowCount,
    0,
  );
  log("no-hosted-runtime-charges");
  await checkpoint(
    task,
    lease,
    [
      {
        role: "assistant",
        content: "Actual Docker E2E fixture passed; no AI model used.",
      },
    ],
    "Actual Docker E2E fixture passed; no AI model used.",
  );
  report.success = true;
} finally {
  clearInterval(beat);
  if (task)
    await pool
      .query(
        "UPDATE runs SET status='canceled' WHERE id=(SELECT run_id FROM tasks WHERE id=$1) AND status='running'",
        [task],
      )
      .catch(() => {});
  if (cookie && host)
    await request(
      "customer-hosts",
      { action: "revoke", id: host },
      cookie,
    ).catch(() => {});
  if (setup)
    await command(["compose", "rm", "-f", "-s", "connector"]).catch(() => {});
  if (host) {
    for (const [kind, filter, format, labelExpression] of [
      ["container", "ps", "{{json .Config.Labels}}", "Config.Labels"],
      ["volume", "volume", "{{json .Labels}}", "Labels"],
      ["network", "network", "{{json .Labels}}", "Labels"],
    ]) {
      const args =
        kind === "container"
          ? ["ps", "-aq", "--filter", `label=kerncloud.host=${host}`]
          : [kind, "ls", "-q", "--filter", `label=kerncloud.host=${host}`];
      const values = (await command(args).catch(() => ""))
        .split(/\s+/)
        .filter(Boolean);
      for (const value of values) {
        const labels = JSON.parse(
          await command([
            kind === "container" ? "inspect" : kind,
            ...(kind === "container" ? [] : ["inspect"]),
            "--format",
            format,
            value,
          ]),
        );
        assert.equal(labels["kerncloud.host"], host);
        await command([
          kind,
          "rm",
          ...(kind === "container" ? ["-f"] : []),
          value,
        ]);
      }
    }
  }
  report.cleanup = true;
  report.finished = new Date().toISOString();
  writeFileSync(join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      success: report.success ?? false,
      report: join(output, "result.json"),
      cleanup: report.cleanup,
    }),
  );
  await pool.end();
}
