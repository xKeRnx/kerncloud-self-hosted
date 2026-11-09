import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { TestContext } from "node:test";
export async function agentEnvironmentTests(
  t: TestContext,
  { request, pool, alice, bob, admin, a }: Record<string, any>,
) {
  const { toolStep, context } = await import("../../src/server/engine.ts");
  const { encrypt, hashToken } = await import("../../src/server/security.ts");
  const { startGateway } = await import("../../src/gateway/server.ts");
  const { environmentPermission } =
    await import("../../src/server/environment-tools.ts");
  const workspace = (
    await request(
      "workspaces",
      { name: "Agent container protocol fixture" },
      alice.cookie,
    )
  ).data.id;
  const cookie = alice.cookie + "; kc_workspace=" + workspace;
  const state = (await request("state", undefined, cookie)).data;
  const agents = state.agents;
  const environment = randomUUID(),
    host = randomUUID(),
    run = randomUUID(),
    task = randomUUID(),
    lease = randomUUID(),
    task2 = randomUUID(),
    lease2 = randomUUID(),
    token = randomUUID() + randomUUID();
  const oldBase = process.env.PUBLIC_ENVIRONMENT_URL;
  let gateway: any,
    relay: WebSocket | undefined,
    calls = 0,
    cancels = 0,
    hold = false;
  const wait = async (fn: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail("Agent environment condition timed out");
  };
  const invoke = (
    name: string,
    args: unknown,
    call = randomUUID(),
    which = task,
    whichLease = lease,
  ) => toolStep(which, whichLease, call, name, args, [], {});
  try {
    await pool.query(
      "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,enabled,provisioning,last_seen) VALUES($1,'Agent tools protocol fixture','docker',$2,true,true,now())",
      [host, hashToken(token)],
    );
    await pool.query(
      "INSERT INTO customer_environments(id,workspace_id,host_id,template_id,name,status,self_service,billing_active,paid_until,controller_seen) VALUES($1,$2,$3,'development','Agent tools fixture','running',true,true,now()+interval '1 hour',now())",
      [environment, workspace, host],
    );
    await pool.query(
      "INSERT INTO environment_credentials(environment_id,secret,relay_secret,relay_hash) VALUES($1,$2,$2,$3)",
      [environment, encrypt(token), hashToken(token)],
    );
    await pool.query(
      "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Container tools fixture',20)",
      [run, workspace],
    );
    for (const [id, l, agent] of [
      [task, lease, agents[0].id],
      [task2, lease2, agents[1].id],
    ])
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Protocol fixture','Protocol fixture','running',$5,now()+interval '90 seconds')",
        [id, run, workspace, agent, l],
      );
    await t.test(
      "Agenten-Containerrechte: Workspace, einzelne Agenten, Fähigkeiten und bestätigte Wiederholung",
      async () => {
        await assert.rejects(() =>
          invoke("environment_command", {
            environment_id: environment,
            command: "whoami",
          }),
        );
        assert.deepEqual(
          JSON.parse((await invoke("list_environments", {})).result),
          [],
        );
        assert.equal(
          (
            await request(
              "environments/agents",
              { id: environment, permissions: ["exec"], agentIds: [] },
              bob.cookie,
            )
          ).status,
          404,
        );
        const foreign = (await request("state", undefined, bob.cookie)).data
          .agents[0].id;
        assert.equal(
          (
            await request(
              "environments/agents",
              { id: environment, permissions: ["files"], agentIds: [foreign] },
              cookie,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "environments/agents",
              {
                id: environment,
                permissions: ["files"],
                agentIds: [agents[0].id],
              },
              cookie,
            )
          ).status,
          200,
        );
        await assert.rejects(() =>
          invoke("environment_command", {
            environment_id: environment,
            command: "whoami",
          }),
        );
        await assert.rejects(() =>
          invoke(
            "environment_read_file",
            { environment_id: environment, path: "a.txt" },
            randomUUID(),
            task2,
            lease2,
          ),
        );
        const ctx = await context(task, lease);
        assert.ok(
          ctx.tools.some((x: any) => x.function.name === "environment_command"),
        );
        process.env.PUBLIC_ENVIRONMENT_URL = "http://localhost:3220";
        gateway = await startGateway(0, "127.0.0.1");
        const port = gateway.server.address().port;
        relay = new WebSocket("ws://127.0.0.1:" + port + "/_relay", {
          headers: {
            authorization: "Bearer " + token,
            "x-environment-id": environment,
            "x-environment-generation": "1",
          },
        });
        relay.on("message", (raw) => {
          const m = JSON.parse(raw.toString());
          if (m.kind === "agent-start") {
            calls++;
            if (!hold)
              relay!.send(
                JSON.stringify({
                  kind: "agent-result",
                  id: m.id,
                  result: { ok: true, content: "protocol-fixture-file" },
                }),
              );
          }
          if (m.kind === "cancel") cancels++;
        });
        await new Promise<void>((resolve, reject) => {
          relay!.once("open", resolve);
          relay!.once("error", reject);
        });
        const call = randomUUID(),
          args = { environment_id: environment, path: "proof.txt" };
        const first = await invoke("environment_read_file", args, call);
        assert.match(first.result, /protocol-fixture-file/);
        assert.deepEqual(
          await invoke("environment_read_file", args, call),
          first,
        );
        assert.equal(calls, 1, "confirmed tool call is not executed twice");
        const activity = (await request("runtime", undefined, cookie)).data
          .tool_activity;
        assert.equal(activity[0].status, "done");
        assert.equal(
          (
            await request("runtime", undefined, alice.cookie)
          ).data.tool_activity.some((x: any) => x.id === activity[0].id),
          false,
        );
        const exported = (await request("privacy/export", undefined, cookie))
          .data;
        assert.ok(
          exported.environment_tools.some(
            (x: any) => x.tool === "environment_read_file",
          ),
        );
        await pool.query(
          "UPDATE customer_environments SET access_blocked=true WHERE id=$1",
          [environment],
        );
        await assert.rejects(() =>
          environmentPermission(pool, task, lease, environment, "files"),
        );
        await pool.query(
          "UPDATE customer_environments SET access_blocked=false WHERE id=$1",
          [environment],
        );
      },
    );
    await t.test(
      "Agenten-Stopp widerruft laufende Containeraktionen und sperrt unbestätigte Wiederholung",
      async () => {
        hold = true;
        const promise = invoke("environment_read_file", {
          environment_id: environment,
          path: "long.txt",
        });
        const rejected = assert.rejects(promise);
        await wait(() => calls === 2);
        assert.equal(
          (
            await request(
              "execution/control",
              { action: "stop", agentId: agents[0].id },
              cookie,
            )
          ).status,
          200,
        );
        await rejected;
        await wait(() => cancels > 0);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM environment_tool_calls WHERE environment_id=$1 AND status IN('running','queued')",
              [environment],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM operations o JOIN tasks t ON t.id=o.task_id WHERE t.id=$1 AND o.status<>'done'",
              [task],
            )
          ).rows[0].n,
          1,
        );
      },
    );
  } finally {
    relay?.terminate();
    await gateway?.close();
    if (oldBase === undefined) delete process.env.PUBLIC_ENVIRONMENT_URL;
    else process.env.PUBLIC_ENVIRONMENT_URL = oldBase;
    await pool.query("DELETE FROM runs WHERE id=$1", [run]);
    await pool.query("DELETE FROM customer_environments WHERE id=$1", [
      environment,
    ]);
    await pool.query("DELETE FROM infrastructure_hosts WHERE id=$1", [host]);
  }
}
