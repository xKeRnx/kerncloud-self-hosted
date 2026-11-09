import { gatewayHttp } from "../tests/fixtures/gateway-http.ts";
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { WebSocket } from "ws";
import {
  DockerEngine,
  dockerInventory,
  executeDockerJob,
} from "../src/infrastructure/docker.ts";
const platform = process.env.QA_PLATFORM ?? "http://ui-test:3100",
  gateway = process.env.QA_GATEWAY ?? "http://test-gateway:3200";
if (!platform.includes("ui-test") && !platform.includes("127.0.0.1:3101"))
  throw new Error("Dedicated test application only");
const engine = new DockerEngine();
let host: any,
  aliceCookie = "",
  adminCookie = "",
  workspaceId = "",
  heartbeat: ReturnType<typeof setInterval> | undefined;
const environments: { id: string; template: string; name: string }[] = [];
async function api(path: string, body?: unknown, cookie = aliceCookie) {
  const r = await fetch(platform + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}: ${data.error}`);
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function agent(path: string, body: unknown) {
  const r = await fetch(platform + "/api/infrastructure/agent/" + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + host.token,
      "x-host-id": host.id,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Fixture connector ${path}: ${r.status}`);
  return r.json();
}
async function beat() {
  await agent("heartbeat", await dockerInventory(engine, host.id));
}
async function processJobs() {
  for (let i = 0; i < 20; i++) {
    const { job } = await agent("claim", {});
    if (!job) return;
    const result = await executeDockerJob(engine, host.id, job, async () => {
      await agent("job-heartbeat", { id: job.id, lease: job.lease });
    });
    await agent("complete", {
      id: job.id,
      lease: job.lease,
      ok: true,
      ...result,
    });
  }
}
async function execExit(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await engine.request("GET", `/exec/${id}/json`);
    if (!state.Running && state.ExitCode !== null) return state.ExitCode;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Docker fixture exec did not finish");
}
async function ready(id: string) {
  for (let i = 0; i < 60; i++) {
    await beat();
    try {
      return (await api("environments/launch", { id })).data.url as string;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Access relay not ready");
}
async function browserCookie(url: string) {
  const parsed = new URL(url),
    r = await gatewayHttp(gateway + parsed.pathname + parsed.search, {
      host: parsed.host,
    });
  assert.equal(r.status, 303);
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    host: parsed.host,
    origin: parsed.origin,
  };
}
async function getPage(
  access: { cookie: string; host: string },
  initial = "/",
) {
  let path = initial;
  for (let i = 0; i < 10; i++) {
    const r = await gatewayHttp(gateway + path, {
      host: access.host,
      cookie: access.cookie,
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = new URL(r.headers.get("location")!, `http://${access.host}`);
      path = next.pathname + next.search;
      continue;
    }
    return { status: r.status, text: await r.text() };
  }
  throw new Error("Redirect loop");
}
try {
  adminCookie = (
    await api(
      "auth/login",
      { email: "admin@test.local", password: "integration-admin-password" },
      "",
    )
  ).cookie;
  aliceCookie = (
    await api(
      "auth/login",
      { email: "alice@test.local", password: "alice-new-strong-password" },
      "",
    )
  ).cookie;
  const state = (await api("state")).data;
  workspaceId = state.workspace.id;
  const admin = (await api("admin", undefined, adminCookie)).data,
    plan = admin.plans.find((p: any) => p.id === "starter");
  await api(
    "admin/plan",
    {
      ...plan,
      max_environments: 2,
      max_running_environments: 2,
      runtime_minutes: 30,
      environment_templates: ["browser", "development"],
    },
    adminCookie,
  );
  await api(
    "admin/workspace",
    { id: workspaceId, plan_id: "starter", creditAdjustment: 0 },
    adminCookie,
  );
  host = (
    await api(
      "admin/infrastructure",
      {
        action: "createHost",
        name: "Disposable Docker end-to-end fixture",
        kind: "docker",
      },
      adminCookie,
    )
  ).data;
  const view = (await api("admin/infrastructure", undefined, adminCookie)).data;
  for (const other of view.hosts)
    if (other.id !== host.id)
      await api(
        "admin/infrastructure",
        {
          action: "host",
          id: other.id,
          enabled: other.enabled,
          provisioning: other.provisioning,
          self_service: false,
        },
        adminCookie,
      );
  await api(
    "admin/infrastructure",
    {
      action: "host",
      id: host.id,
      enabled: true,
      provisioning: true,
      self_service: true,
      max_running: 2,
      cpu_limit: 8,
      memory_limit_mb: 8192,
    },
    adminCookie,
  );
  await beat();
  heartbeat = setInterval(() => void beat().catch(() => {}), 5000);
  for (const template of ["development", "browser"]) {
    const spec = view.templates.find((t: any) => t.id === template);
    await api(
      "admin/infrastructure",
      { action: "template", ...spec, enabled: true },
      adminCookie,
    );
    const name = `Docker QA ${template}`,
      id = (
        await api("environments/manage", {
          action: "book",
          templateId: template,
          name,
          expectedRate: 1,
        })
      ).data.id;
    environments.push({ id, template, name });
    await api("environments/manage", { action: "start", id, expectedRate: 1 });
    await processJobs();
    const url = await ready(id),
      session = await browserCookie(url);
    let page: any;
    for (let attempt = 0; attempt < 45; attempt++) {
      page = await getPage(session);
      if (page.status === 200) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(page.status, 200, template + " protected page failed");
    assert.match(
      page.text,
      template === "browser"
        ? /noVNC/
        : /code-server|workbench|Visual Studio Code/i,
    );
    if (template === "browser") {
      const ws = new WebSocket(
        gateway.replace(/^http/, "ws") + "/websockify",
        ["binary"],
        {
          headers: { host: session.host, cookie: session.cookie },
          origin: session.origin,
        },
      );
      const greeting = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error("VNC WebSocket timeout"));
        }, 15000);
        ws.once("message", (data) => {
          clearTimeout(timer);
          resolve(data.toString());
        });
        ws.once("error", reject);
      });
      assert.match(greeting, /^RFB /);
      ws.close();
    }
    if (process.env.QA_AGENT_TOOLS === "true") {
      const { verifyAgentTools } = await import("./verify-agent-tools.ts");
      await verifyAgentTools({
        api,
        environmentId: id,
        template,
        engine,
        execExit,
      });
    }
    await api("environments/manage", { action: "stop", id });
    await processJobs();
    assert.equal(
      (await getPage(session)).status,
      401,
      "stopped access must be revoked",
    );
    await api("environments/manage", { action: "start", id, expectedRate: 1 });
    await processJobs();
    await ready(id);
    const main = await engine.request(
      "GET",
      `/containers/kerncloud-env-${id}-g1/json`,
    );
    const { Id } = await engine.request("POST", `/containers/${main.Id}/exec`, {
      User: "1000:1000",
      Cmd: ["sh", "-c", "printf proof > /home/runner/qa-proof.txt"],
    });
    await engine.request("POST", `/exec/${Id}/start`, {
      Detach: false,
      Tty: false,
    });
    assert.equal(
      await execExit(Id),
      0,
      "fixture file was written before reset",
    );
    await api("environments/manage", {
      action: "reset",
      id,
      confirmation: name,
      expectedRate: 1,
    });
    await processJobs();
    await ready(id);
    assert.equal(
      await engine.request("GET", `/containers/kerncloud-env-${id}-g1/json`),
      null,
      "old generation removed",
    );
    const second = await engine.request(
        "GET",
        `/containers/kerncloud-env-${id}-g2/json`,
      ),
      proof = await engine.request("POST", `/containers/${second.Id}/exec`, {
        User: "1000:1000",
        Cmd: ["test", "!", "-e", "/home/runner/qa-proof.txt"],
      });
    await engine.request("POST", `/exec/${proof.Id}/start`, {
      Detach: false,
      Tty: false,
    });
    assert.equal(await execExit(proof.Id), 0, "reset clears working volume");
    console.log(
      `${template}: customer booking, real Docker relay, protected HTTP${template === "browser" ? " + VNC WebSocket" : ""}, stop/start and reset verified.`,
    );
  }
  if (process.env.QA_HOLD === "true") {
    await writeFile(
      "/qa/ready.json",
      JSON.stringify({ workspaceId, environments }),
      { mode: 0o600 },
    );
    console.log(
      "QA_READY: dedicated test environments available for browser inspection.",
    );
    const end = Date.now() + 600000;
    while (Date.now() < end) {
      try {
        await access("/qa/finish");
        break;
      } catch {}
      await processJobs();
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
} finally {
  if (heartbeat) clearInterval(heartbeat);
  for (const e of environments) {
    try {
      await api("environments/manage", {
        action: "delete",
        id: e.id,
        confirmation: e.name,
      });
      await processJobs();
    } catch {
      // Direct cleanup is scoped to this fixture host and these exact random IDs.
      const view = (await api("admin/infrastructure", undefined, adminCookie))
          .data,
        row = view.environments.find((x: any) => x.id === e.id);
      await executeDockerJob(engine, host.id, {
        id: crypto.randomUUID(),
        environmentId: e.id,
        action: "delete",
        generation: row?.generation ?? 1,
        lease: crypto.randomUUID(),
        spec: {
          id: e.template,
          image: `kerncloud-${e.template}:0.2`,
          command: [],
          cpu: 1,
          memory_mb: 128,
          container_port: 0,
          network: false,
          user_id: "1000:1000",
          read_only: true,
        },
      });
    }
  }
  const left = await engine.request(
    "GET",
    `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`kerncloud.host=${host?.id}`] }))}`,
  );
  assert.equal(left.length, 0, "fixture containers cleaned");
  console.log(
    "Owned Docker QA resources removed; main customer DB and existing containers preserved.",
  );
}
