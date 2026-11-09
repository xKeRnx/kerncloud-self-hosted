import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";

// Scripted model protocol fixture; all tool effects below use actual customer containers.
export async function verifyAgentTools({
  api,
  environmentId,
  template,
  engine,
  execExit,
}: Record<string, any>) {
  const platform = process.env.QA_PLATFORM ?? "http://ui-test:3100";
  if (!platform.includes("ui-test") || !process.env.WORKER_TOKEN)
    throw new Error("Dedicated QA app and worker credentials required");
  const state = (await api("state")).data,
    agent = state.agents[0],
    tag = "agent-docker-fixture-" + randomUUID();
  const page = `<!doctype html><html lang="de"><title>Agenten-Browsertest</title><body><h1>Lokales Testformular</h1><label for="name">Name</label><input id="name"><button onclick="document.querySelector('#result').textContent='Hallo '+document.querySelector('#name').value">Absenden</button><p id="result"></p></body></html>`;
  const steps =
    template === "development"
      ? [
          ["list_environments", {}],
          [
            "environment_write_file",
            {
              path: "agent-proof.mjs",
              content: "export const add=(a,b)=>a+b;\n",
            },
          ],
          ["environment_read_file", { path: "agent-proof.mjs" }],
          [
            "environment_command",
            {
              command: `node --input-type=module -e "import assert from 'node:assert/strict'; import {add} from './agent-proof.mjs'; assert.equal(add(2,3),5); console.log('AGENT_TEST_OK')"`,
            },
          ],
          ["environment_read_file", { path: "../../etc/passwd" }],
        ]
      : [
          ["list_environments", {}],
          ["environment_write_file", { path: "index.html", content: page }],
          [
            "environment_command",
            {
              command:
                "setsid python3 -m http.server 8765 --bind 127.0.0.1 --directory /home/runner/project >/tmp/qa-http.log 2>&1 < /dev/null & sleep 0.5; curl -fsS http://127.0.0.1:8765/ >/dev/null",
            },
          ],
          [
            "environment_browser",
            { action: "navigate", url: "http://127.0.0.1:8765/" },
          ],
          ["environment_browser", { action: "snapshot" }],
          [
            "environment_browser",
            { action: "fill", ref: "r1", text: "KeRnCloud Agent" },
          ],
          ["environment_browser", { action: "click", ref: "r2" }],
        ];
  const fixture = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const own = body.messages.some(
        (m: any) => typeof m.content === "string" && m.content.includes(tag),
      );
      const done = body.messages.filter((m: any) => m.role === "tool").length;
      const next =
        body.model === "stop-fixture"
          ? [
              "environment_command",
              {
                command:
                  "echo started > command-started.txt; sleep 12; echo escaped > no-after-stop.txt",
                timeout_seconds: 25,
              },
            ]
          : steps[done];
      const message =
        own && next
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: randomUUID(),
                  type: "function",
                  function: {
                    name: next[0],
                    arguments: JSON.stringify(
                      next[0] === "list_environments"
                        ? {}
                        : {
                            ...(next[1] as object),
                            environment_id: environmentId,
                          },
                    ),
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content: "Controlled local protocol fixture finished.",
            };
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            choices: [{ message }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 30,
              total_tokens: 130,
            },
          }),
        );
    } catch {
      res.writeHead(500).end("{}");
    }
  });
  await new Promise<void>((r) => fixture.listen(0, "0.0.0.0", r));
  const address = Object.values(networkInterfaces())
    .flat()
    .find((x) => x?.family === "IPv4" && !x.internal)!.address;
  const endpoint = `http://${address}:${(fixture.address() as any).port}/v1`;
  let worker: ReturnType<typeof spawn> | undefined;
  const wait = async (
    fn: () => Promise<boolean>,
    message: string,
    attempts = 160,
  ) => {
    for (let i = 0; i < attempts; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(message);
  };
  const exists = async (file: string) => {
    const main = await engine.request(
      "GET",
      `/containers/kerncloud-env-${environmentId}-g1/json`,
    );
    const exec = await engine.request("POST", `/containers/${main.Id}/exec`, {
      User: "1000:1000",
      Cmd: ["test", "-f", "/home/runner/project/" + file],
    });
    await engine.request("POST", `/exec/${exec.Id}/start`, {
      Detach: false,
      Tty: false,
    });
    return (await execExit(exec.Id)) === 0;
  };
  try {
    await api("environments/agents", {
      id: environmentId,
      permissions:
        template === "browser"
          ? ["files", "exec", "browser"]
          : ["files", "exec"],
      agentIds: [agent.id],
    });
    await wait(
      async () =>
        Boolean(
          (await api("runtime")).data.environments.find(
            (e: any) => e.id === environmentId,
          )?.controller_seen,
        ),
      "Controller not ready",
    );
    const model = (
      await api("models", {
        name: "Docker agent protocol fixture",
        provider_name: "Local controlled fixture",
        endpoint,
        model: "tool-fixture",
        streaming: false,
      })
    ).data.id;
    await api("agents", { ...agent, model_id: model });
    worker = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
      env: { ...process.env, PLATFORM_URL: platform, WORKER_CONCURRENCY: "1" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    worker.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    const run = (
      await api("runs", {
        goal: tag + " Verify actual sandbox tools.",
        agentId: agent.id,
      })
    ).data.id;
    await wait(async () => {
      const r = (await api("state")).data.runs.find((x: any) => x.id === run);
      if (["failed", "input_required"].includes(r?.status))
        throw new Error("Agent fixture run did not finish: " + r.status);
      return r?.status === "completed";
    }, "Worker tool sequence not completed");
    const activity = (await api("runtime")).data.tool_activity.filter(
      (j: any) => j.environment_name,
    );
    if (template === "development") {
      assert.ok(await exists("agent-proof.mjs"));
      assert.ok(
        activity.some(
          (j: any) =>
            j.tool === "environment_command" &&
            j.result?.stdout?.includes("AGENT_TEST_OK"),
        ),
      );
      assert.ok(
        activity.some(
          (j: any) =>
            j.tool === "environment_read_file" &&
            j.result?.ok === false &&
            j.result?.error?.includes("Path leaves project"),
        ),
      );
    } else
      assert.ok(
        activity.some(
          (j: any) =>
            j.tool === "environment_browser" &&
            j.result?.text?.includes("Hallo KeRnCloud Agent"),
        ),
      );
    console.log(
      `${template}: real worker + scripted model fixture wrote files, executed commands${template === "browser" ? " and filled/submitted the visible browser form" : " and passed an actual Node test; traversal refused"}.`,
    );
    if (template === "development") {
      const stopModel = (
        await api("models", {
          name: "Docker cancellation fixture",
          provider_name: "Local controlled fixture",
          endpoint,
          model: "stop-fixture",
          streaming: false,
        })
      ).data.id;
      await api("agents", { ...agent, model_id: stopModel });
      await api("runs", {
        goal: tag + " Verify active command cancellation.",
        agentId: agent.id,
      });
      await wait(
        () => exists("command-started.txt"),
        "Long command did not start",
      );
      await api("execution/control", { action: "stop", agentId: agent.id });
      await new Promise((r) => setTimeout(r, 13000));
      assert.equal(
        await exists("no-after-stop.txt"),
        false,
        "stopped command must not finish later",
      );
      assert.ok(
        (await api("runtime")).data.tool_activity.some(
          (j: any) => j.status === "uncertain",
        ),
      );
      console.log(
        "Actual running command was killed by agent stop; no delayed file write.",
      );
    }
  } finally {
    worker?.kill("SIGTERM");
    if (worker)
      await Promise.race([
        new Promise((r) => worker!.once("exit", r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    if (worker?.exitCode === null) worker.kill("SIGKILL");
    await api("execution/control", { action: "resume", agentId: agent.id });
    await api("agents", agent);
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
