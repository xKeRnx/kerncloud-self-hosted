import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { NextRequest } from "next/server";
export async function customerHostTests(
  t: any,
  { request, pool, handle, bob, admin }: any,
) {
  const signed = await request("auth/signup", {
    name: "Customer host fixture",
    email: "customer-host@test.local",
    password: "customer-host-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(signed.status, 200);
  const cookie = signed.cookie;
  let state = (await request("state", undefined, cookie)).data;
  await request(
    "admin/workspace",
    { id: state.workspace.id, plan_id: "business" },
    admin.cookie,
  );
  state = (await request("state", undefined, cookie)).data;
  const workspace = state.workspace,
    agent = state.agents[0],
    ids: string[] = [];
  const setup = async (name: string) => {
    const r = await request(
      "customer-hosts",
      { action: "create", name, cpu: 4, memory: 8192 },
      cookie,
    );
    assert.equal(r.status, 200, JSON.stringify({ error: r.data.error }));
    const zip = unzipSync(Buffer.from(r.data.archive, "base64"));
    const env = strFromU8(zip[".env.connector"]);
    const token = env.match(/^INFRA_HOST_TOKEN=(.+)$/m)![1];
    ids.push(r.data.id);
    return { id: r.data.id, token };
  };
  const hostApi = async (
    host: { id: string; token: string },
    path: string,
    body: unknown,
  ) => {
    const r = await handle(
      new NextRequest(
        `http://localhost:3100/api/infrastructure/agent/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-host-id": host.id,
            Authorization: `Bearer ${host.token}`,
          },
          body: JSON.stringify(body),
        },
      ),
      `infrastructure/agent/${path}`,
    );
    return { status: r.status, data: await r.json() };
  };
  const heartbeat = {
    version: "Docker customer protocol fixture",
    hostname: "fixture-host",
    cpuCount: 4,
    memoryTotal: 8192 * 1048576,
    memoryFree: 6000 * 1048576,
    load: [],
    commandsEnabled: true,
    accessConfigured: true,
    containers: [],
  };
  let h1: any,
    h2: any,
    environment1 = "",
    environment2 = "";
  await t.test(
    "Kunden-Connector: kontogebundene Einrichtung, keine fremden Server und sichere Schlüsselrotation",
    async () => {
      h1 = await setup("My private host");
      h2 = await setup("My other private host");
      assert.equal(
        (
          await pool.query(
            "SELECT self_service FROM infrastructure_hosts WHERE id=$1",
            [h1.id],
          )
        ).rows[0].self_service,
        false,
      );
      await assert.rejects(
        () =>
          pool.query(
            "UPDATE infrastructure_hosts SET self_service=true WHERE id=$1",
            [h1.id],
          ),
        (e: any) => e.code === "23514",
      );
      assert.equal(
        (
          await request(
            "customer-hosts",
            { action: "rotate", id: h1.id },
            bob.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request("customer-hosts", undefined, bob.cookie)
        ).data.hosts.some((h: any) => h.id === h1.id),
        false,
      );
      for (const h of [h1, h2])
        assert.equal((await hostApi(h, "heartbeat", heartbeat)).status, 200);
      const before = (await request("customer-hosts", undefined, cookie)).data;
      assert.equal(before.hosts.length, 2);
      assert.ok(before.hosts.every((h: any) => !("token_hash" in h)));
      assert.equal(
        (
          await request(
            "execution-policy",
            { allowHosted: false, hostIds: [h1.id] },
            bob.cookie,
          )
        ).status,
        403,
      );
    },
  );
  const policy = async (hostIds: string[], allowHosted = false) => {
    const r = await request(
      "execution-policy",
      { allowHosted, hostIds },
      cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };
  async function book(host: any, name: string) {
    const r = await request(
      "environments/manage",
      {
        action: "book",
        name,
        templateId: "development",
        expectedRate: 1,
        hostId: host.id,
      },
      cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // Protocol-only booking fixture; real relay routing is covered by gateway tests.
    const gatewayId = 'customer-host-fixture-' + r.data.id;
    await pool.query(
      "INSERT INTO gateway_instances(id,address,expires_at) VALUES($1,'http://fixture.invalid:3200',now()+interval '30 seconds')",
      [gatewayId],
    );
    try {
      assert.equal(
        (
          await request(
            "environments/manage",
            { action: "start", id: r.data.id, expectedRate: 1 },
            cookie,
          )
        ).status,
        200,
      );
    } finally {
      await pool.query('DELETE FROM gateway_instances WHERE id=$1',[gatewayId]);
    }
    const job = await hostApi(host, "claim", {});
    assert.equal(job.status, 200);
    assert.equal(job.data.job.environmentId, r.data.id);
    assert.equal(
      (
        await hostApi(host, "complete", {
          id: job.data.job.id,
          lease: job.data.job.lease,
          ok: true,
          resourceId: `fixture-${r.data.id}`,
        })
      ).status,
      200,
    );
    await pool.query(
      "UPDATE customer_environments SET controller_seen=now() WHERE id=$1",
      [r.data.id],
    );
    return r.data.id;
  }
  await t.test(
    "Lokale Buchung: ausgewählter Rechner bleibt fest, kein Cloud-Fallback und keine Hosting-Minuten",
    async () => {
      assert.equal(
        (
          await request(
            "environments/manage",
            {
              action: "book",
              templateId: "development",
              expectedRate: 1,
              hostId: h1.id,
            },
            cookie,
          )
        ).status,
        403,
      );
      await policy([h1.id]);
      assert.equal(
        (
          await request(
            "environments/manage",
            {
              action: "book",
              templateId: "development",
              expectedRate: 1,
              hostId: "hosted",
            },
            cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "environments/manage",
            {
              action: "book",
              templateId: "development",
              expectedRate: 1,
              hostId: h2.id,
            },
            cookie,
          )
        ).status,
        403,
      );
      await request("runtime", undefined, cookie);
      await pool.query(
        "UPDATE accounts SET runtime_included=0,runtime_purchased=0 WHERE id=$1",
        [workspace.account_id],
      );
      environment1 = await book(h1, "Local editor one");
      await policy([h1.id, h2.id]);
      environment2 = await book(h2, "Local editor two");
      const { maintainRuntime } = await import("../../src/server/runtime.ts"),
        { transaction } = await import("../../src/server/db.ts");
      await transaction(maintainRuntime);
      await transaction(maintainRuntime);
      const view = (await request("runtime", undefined, cookie)).data;
      assert.equal(view.balance.included, 0);
      assert.equal(view.balance.purchased, 0);
      assert.equal(view.usage.local_booked, 2);
      assert.equal(view.usage.booked, 0);
      assert.equal(
        (
          await pool.query(
            "SELECT * FROM runtime_ledger WHERE environment_id=ANY($1::text[])",
            [[environment1, environment2]],
          )
        ).rowCount,
        0,
      );
      await pool.query(
        "UPDATE infrastructure_hosts SET last_seen=now()-interval '2 minutes' WHERE id=$1",
        [h2.id],
      );
      assert.equal(
        (
          await request(
            "environments/manage",
            {
              action: "book",
              name: "No fallback",
              templateId: "development",
              expectedRate: 1,
              hostId: h2.id,
            },
            cookie,
          )
        ).status,
        409,
      );
      await hostApi(h2, "heartbeat", heartbeat);
    },
  );
  await t.test(
    "Ausführungsort-Auswahl sperrt Agentenlisten und laufende Aktionen serverseitig",
    async () => {
      const run = randomUUID(),
        task = randomUUID(),
        lease = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Customer location fixture',100)",
        [run, workspace.id],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Fixture','Fixture','running',$5,now()+interval '90 seconds')",
        [task, run, workspace.id, agent.id, lease],
      );
      for (const id of [environment1, environment2])
        assert.equal(
          (
            await request(
              "environments/agents",
              { id, permissions: ["files"], agentIds: [agent.id] },
              cookie,
            )
          ).status,
          200,
        );
      const { environmentToolStep, environmentPermission } =
        await import("../../src/server/environment-tools.ts");
      const { toolStep } = await import("../../src/server/engine.ts");
      const file = JSON.parse(
        (
          await toolStep(
            task,
            lease,
            randomUUID(),
            "save_artifact",
            { name: "shared.txt", content: "Shared result for the reviewer" },
            [],
            {},
          )
        ).result,
      );
      const child = randomUUID(),
        childLease = randomUUID();
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,parent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,$5,'Reviewer fixture','Fixture','running',$6,now()+interval '90 seconds')",
        [child, run, workspace.id, state.agents[1].id, task, childLease],
      );
      const read = JSON.parse(
        (
          await toolStep(
            child,
            childLease,
            randomUUID(),
            "read_artifact",
            { artifact_id: file.artifact_id, offset: 0, length: 6 },
            [],
            {},
          )
        ).result,
      );
      assert.equal(read.content, "Shared");
      assert.equal(read.total_characters, 30);
      await assert.rejects(
        () =>
          toolStep(
            child,
            childLease,
            randomUUID(),
            "delegate_task",
            {
              agent_id: agent.id,
              title: "Cycle",
              instructions: "Must not delegate back to coordinator",
            },
            [],
            {},
          ),
        (e: any) => e.status === 400,
      );
      const foreign = (
        await pool.query(
          "SELECT id FROM artifacts WHERE workspace_id<>$1 LIMIT 1",
          [workspace.id],
        )
      ).rows[0];
      assert.ok(foreign);
      await assert.rejects(
        () =>
          toolStep(
            child,
            childLease,
            randomUUID(),
            "read_artifact",
            { artifact_id: foreign.id },
            [],
            {},
          ),
        (e: any) => e.status === 404,
      );
      const listed = async () =>
        JSON.parse(
          (
            await environmentToolStep(
              task,
              lease,
              randomUUID(),
              "list_environments",
              {},
            )
          ).result,
        );
      assert.equal((await listed()).length, 2);
      const operation = `${task}:${randomUUID()}`;
      await pool.query("INSERT INTO operations(id,task_id) VALUES($1,$2)", [
        operation,
        task,
      ]);
      const job = randomUUID();
      await pool.query(
        "INSERT INTO environment_tool_calls(id,operation_id,environment_id,generation,task_id,task_lease,permission,tool,args,status,started_at) VALUES($1,$2,$3,1,$4,$5,'files','environment_read_file','{}','running',now())",
        [job, operation, environment2, task, lease],
      );
      await policy([h1.id]);
      assert.deepEqual(
        (await listed()).map((e: any) => e.id),
        [environment1],
      );
      await assert.rejects(() =>
        environmentPermission(pool, task, lease, environment2, "files"),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM environment_tool_calls WHERE id=$1",
            [job],
          )
        ).rows[0].status,
        "uncertain",
      );
      await request(`runs/${run}`, { action: "cancel" }, cookie, "PATCH");
      const rotated = await request(
        "customer-hosts",
        { action: "rotate", id: h1.id },
        cookie,
      );
      assert.equal(rotated.status, 200);
      assert.equal((await hostApi(h1, "heartbeat", heartbeat)).status, 401);
      const env = strFromU8(
        unzipSync(Buffer.from(rotated.data.archive, "base64"))[
          ".env.connector"
        ],
      );
      h1.token = env.match(/^INFRA_HOST_TOKEN=(.+)$/m)![1];
      assert.equal((await hostApi(h1, "heartbeat", heartbeat)).status, 200);
      assert.equal(
        (
          await request(
            "customer-hosts",
            { action: "revoke", id: h1.id },
            cookie,
          )
        ).status,
        200,
      );
      assert.equal((await hostApi(h1, "heartbeat", heartbeat)).status, 401);
    },
  );
  await t.test(
    "Modellschritt-Kontingent ist atomar und verbrauchte Schritte überleben Planänderungen",
    async () => {
      const exported = (await request("privacy/export", undefined, cookie))
        .data;
      assert.equal(exported.customer_hosts.length, 2);
      assert.ok(!JSON.stringify(exported).includes(h1.token));
      const { consumeModelStep } =
          await import("../../src/server/execution-policy.ts"),
        { transaction } = await import("../../src/server/db.ts");
      await pool.query("UPDATE plans SET monthly_steps=1 WHERE id='business'");
      try {
        const results = await Promise.allSettled([
          transaction((c) => consumeModelStep(c, workspace.account_id)),
          transaction((c) => consumeModelStep(c, workspace.account_id)),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          (await request("state", undefined, cookie)).data.model_usage.used,
          1,
        );
        await assert.rejects(
          () => transaction((c) => consumeModelStep(c, workspace.account_id)),
          (e: any) => e.status === 402,
        );
      } finally {
        await pool.query(
          "UPDATE plans SET monthly_steps=5000 WHERE id='business'",
        );
      }
      assert.equal(
        (await request("state", undefined, cookie)).data.model_usage.used,
        1,
      );
    },
  );
  await t.test(
    "Parallelitätsgrenze gilt über mehrere Workspaces desselben Kontos",
    async () => {
      const second = (
        await request(
          "workspaces",
          { name: "Concurrency fixture workspace" },
          cookie,
        )
      ).data.id;
      const secondAgent = (
        await pool.query(
          "SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1",
          [second],
        )
      ).rows[0].id;
      const firstRun = randomUUID(),
        secondRun = randomUUID(),
        firstTask = randomUUID(),
        secondTask = randomUUID();
      await pool.query(
        "UPDATE plans SET max_parallel_tasks=1 WHERE id='business'",
      );
      try {
        for (const [run, w, task, ag, status] of [
          [firstRun, workspace.id, firstTask, agent.id, "running"],
          [secondRun, second, secondTask, secondAgent, "queued"],
        ]) {
          await pool.query(
            "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Concurrency protocol fixture',20)",
            [run, w],
          );
          await pool.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Fixture','Fixture',$5,$6,now()+interval '90 seconds')",
            [
              task,
              run,
              w,
              ag,
              status,
              status === "running" ? randomUUID() : null,
            ],
          );
        }
        const { claim } = await import("../../src/server/store.ts");
        assert.equal(await claim(randomUUID()), null);
        await pool.query(
          "UPDATE tasks SET status='completed',lease_token=NULL WHERE id=$1",
          [firstTask],
        );
        assert.equal((await claim(randomUUID()))?.task.id, secondTask);
      } finally {
        await pool.query(
          "UPDATE runs SET status='canceled' WHERE id=ANY($1::text[])",
          [[firstRun, secondRun]],
        );
        await pool.query(
          "UPDATE tasks SET status='canceled',lease_token=NULL,worker_id=NULL WHERE run_id=ANY($1::text[])",
          [[firstRun, secondRun]],
        );
        await pool.query(
          "UPDATE plans SET max_parallel_tasks=4 WHERE id='business'",
        );
      }
    },
  );
}
