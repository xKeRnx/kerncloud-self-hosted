import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { NextRequest } from "next/server";
import { transaction } from "../../src/server/db.ts";
import { encrypt } from "../../src/server/security.ts";
import { toolStep, modelStep } from "../../src/server/engine.ts";
import { environmentPermission } from "../../src/server/environment-tools.ts";
import { starterTeams } from "../../src/core/starter-teams.ts";

export async function workspaceEvolutionTests(
  t: any,
  { request, pool, handle }: any,
) {
  const owner = await request("auth/signup", {
    name: "Evolution fixture",
    email: "evolution@fixture.invalid",
    password: "evolution-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(owner.status, 200);
  const cookie = owner.cookie,
    state = (await request("state", undefined, cookie)).data,
    ws = state.workspace.id,
    project = state.project.id,
    agent = state.agents.find((a: any) => a.can_manage) ?? state.agents[0];
  const other = randomUUID();
  await pool.query(
    "INSERT INTO workspace_projects(id,workspace_id,name,status,all_agents) VALUES($1,$2,'Other evolution project','active',true)",
    [other, ws],
  );
  const call = (path: string, body?: unknown, p = project) =>
    request(
      path + (path.includes("?") ? "&" : "?") + "projectId=" + p,
      body,
      cookie,
    );
  const leased = async (mode?: string) => {
    const run = randomUUID(),
      task = randomUUID(),
      lease = randomUUID();
    await pool.query(
      "INSERT INTO runs(id,workspace_id,project_id,goal,max_steps,token_limit,credit_limit,model_policy) VALUES($1,$2,$3,'Evolution protocol fixture',20,50000,10000,$4)",
      [run, ws, project, JSON.stringify({ work_mode: mode })],
    );
    await pool.query(
      "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Fixture','Fixture','running',$5,now()+interval '180 seconds')",
      [task, run, ws, agent.id, lease],
    );
    return { run, task, lease };
  };
  const r = await leased("draft"),
    artifact = randomUUID();
  await pool.query(
    "INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content) VALUES($1,$2,$3,$4,'report.html','<h1>First version</h1>')",
    [artifact, ws, r.run, r.task],
  );
  let page: string;
  await t.test(
    "Private pages retain immutable versions, isolate projects and reject stale writes",
    async () => {
      const created = await call("project-pages", {
        title: "Report",
        artifactId: artifact,
      });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      page = created.data.id;
      assert.equal((await call("project-pages")).data.pages[0].shared, false);
      assert.equal(
        (await call("project-pages", undefined, other)).data.pages.length,
        0,
      );
      assert.equal(
        (
          await call(
            "project-pages",
            {
              id: page,
              title: "Foreign",
              artifactId: artifact,
              expectedRevision: 1,
            },
            other,
          )
        ).status,
        404,
      );
      await pool.query(
        "UPDATE artifacts SET content='<h1>Second version</h1>' WHERE id=$1",
        [artifact],
      );
      assert.equal(
        (
          await call("project-pages", {
            id: page,
            title: "Report",
            artifactId: artifact,
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call("project-pages", {
            id: page,
            title: "Stale",
            artifactId: artifact,
            expectedRevision: 1,
          })
        ).status,
        409,
      );
      assert.equal(
        (await call("project-pages/" + page + "/versions")).data.versions
          .length,
        2,
      );
      const preview = await handle(
        new NextRequest(
          "http://localhost:3100/api/project-pages/" +
            page +
            "/versions/1/preview?projectId=" +
            project,
          { headers: { cookie } },
        ),
        "project-pages/" + page + "/versions/1/preview",
      );
      assert.equal(preview.status, 200);
      assert.match(await preview.text(), /First version/);
      assert.match(
        preview.headers.get("Content-Security-Policy"),
        /sandbox allow-scripts/,
      );
    },
  );
  await t.test(
    "Sharing is reviewed and revocable; agent page updates are idempotent and cannot change published content",
    async () => {
      assert.equal(
        (
          await call("project-pages/" + page + "/sharing", {
            enabled: true,
            expectedRevision: 2,
          })
        ).status,
        400,
      );
      const shared = await call("project-pages/" + page + "/sharing", {
        enabled: true,
        expectedRevision: 2,
        reviewed: true,
      });
      assert.equal(shared.status, 200, JSON.stringify(shared.data));
      const path = shared.data.url.slice(5);
      const response = await handle(
        new NextRequest("http://localhost:3100" + shared.data.url),
        path,
      );
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Second version/);
      await assert.rejects(
        () =>
          toolStep(
            r.task,
            r.lease,
            "public-update",
            "save_project_page",
            {
              id: page,
              title: "No review",
              artifactId: artifact,
              expectedRevision: 2,
            },
            [],
            {},
          ),
        (e: any) => e.status === 409,
      );
      assert.equal(
        (
          await call("project-pages/" + page + "/sharing", {
            enabled: false,
            expectedRevision: 2,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await handle(
            new NextRequest("http://localhost:3100" + shared.data.url),
            path,
          )
        ).status,
        404,
      );
      const args = { title: "Agent page", artifactId: artifact };
      const a = await toolStep(
          r.task,
          r.lease,
          "page-once",
          "save_project_page",
          args,
          [],
          {},
        ),
        b = await toolStep(
          r.task,
          r.lease,
          "page-once",
          "save_project_page",
          args,
          [],
          {},
        );
      assert.deepEqual(a, b);
      assert.equal((await call("project-pages")).data.pages.length, 2);
      const list = await toolStep(
        r.task,
        r.lease,
        "page-list",
        "list_project_pages",
        {},
        [],
        {},
      );
      assert.ok(
        JSON.parse(list.result).some(
          (p: any) => p.id === page && p.revision === 2,
        ),
      );
    },
  );
  await t.test(
    "Mode restrictions apply to actual backend calls, before any external operation is recorded",
    async () => {
      for (const name of [
        "delegate_task",
        "request_agent",
        "bridge_action",
        "tool_pipeline",
      ]) {
        await assert.rejects(
          () => toolStep(r.task, r.lease, "blocked-" + name, name, {}, [], {}),
          (e: any) => e.status === 403,
        );
      }
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM operations WHERE task_id=$1 AND id LIKE '%blocked-%'",
            [r.task],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "Human takeover blocks agent access, rejects unresolved effects and preserves grants on handback",
    async () => {
      const host = randomUUID(),
        env = randomUUID(),
        e = await leased("execute");
      await pool.query(
        "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,enabled,last_seen) VALUES($1,'Workplace protocol fixture','docker','fixture-only',true,now())",
        [host],
      );
      await pool.query(
        "UPDATE workspaces SET allow_hosted_execution=true WHERE id=$1",
        [ws],
      );
      await pool.query(
        "INSERT INTO customer_environments(id,workspace_id,project_id,host_id,template_id,name,status,self_service,agent_permissions,controller_seen) VALUES($1,$2,$3,$4,'development','Workplace fixture','running',false,'[\"exec\",\"files\"]',now())",
        [env, ws, project, host],
      );
      await transaction((c) =>
        environmentPermission(c, e.task, e.lease, env, "exec"),
      );
      const take = await call("runs/" + e.run + "/workplace", {
        action: "takeover",
        environmentId: env,
      });
      assert.equal(take.status, 200, JSON.stringify(take.data));
      assert.equal(
        (await pool.query("SELECT status FROM runs WHERE id=$1", [e.run]))
          .rows[0].status,
        "paused",
      );
      // A different task in this project must also be unable to enter the environment.
      const concurrent = await leased("execute");
      await assert.rejects(
        () =>
          transaction((c) =>
            environmentPermission(
              c,
              concurrent.task,
              concurrent.lease,
              env,
              "exec",
            ),
          ),
        (e: any) => e.status === 409,
      );
      const release = await call("runs/" + e.run + "/workplace", {
        action: "release",
        environmentId: env,
      });
      assert.equal(release.status, 200);
      assert.deepEqual(
        (
          await pool.query(
            "SELECT agent_permissions,human_controlled FROM customer_environments WHERE id=$1",
            [env],
          )
        ).rows[0],
        { agent_permissions: ["exec", "files"], human_controlled: false },
      );
      await pool.query(
        "INSERT INTO operations(id,task_id,tool_name,status) VALUES('evolution-uncertain',$1,'environment_exec','uncertain')",
        [concurrent.task],
      );
      await pool.query(
        "INSERT INTO environment_tool_calls(id,operation_id,environment_id,generation,task_id,task_lease,permission,tool,args,status) VALUES($1,'evolution-uncertain',$2,1,$3,$4,'exec','exec','{}','uncertain')",
        [randomUUID(), env, concurrent.task, concurrent.lease],
      );
      assert.equal(
        (
          await call("runs/" + e.run + "/workplace", {
            action: "takeover",
            environmentId: env,
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "Blocked children notify once; independent work continues before the coordinator sleeps without polling",
    async () => {
      const parent = await leased("team"),
        child = randomUUID();
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,parent_id,title,instructions,status,error) VALUES($1,$2,$3,$4,$5,'Needs input','Fixture','input_required','Access required')",
        [child, parent.run, ws, agent.id, parent.task],
      );
      const first = await toolStep(
        parent.task,
        parent.lease,
        "wait-first",
        "wait_for_team",
        {},
        [],
        {},
      );
      assert.equal(first.yield, false);
      assert.match(first.result, /Access required/);
      const second = await toolStep(
        parent.task,
        parent.lease,
        "wait-second",
        "wait_for_team",
        {},
        [],
        {},
      );
      assert.equal(second.yield, true);
      assert.equal(
        (
          await pool.query("SELECT status FROM tasks WHERE id=$1", [
            parent.task,
          ])
        ).rows[0].status,
        "waiting",
      );
      assert.equal(
        (await pool.query("SELECT status FROM runs WHERE id=$1", [parent.run]))
          .rows[0].status,
        "running",
      );
    },
  );
  await t.test(
    "Starter teams require exact review and import paused without increasing account balance or workspace budgets",
    async () => {
      const before = (
        await pool.query(
          "SELECT credits,run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
          [ws],
        )
      ).rows[0];
      for (const team of starterTeams) {
        const preview = await call("suite/templates", {
          action: "preview",
          package: team.package,
        });
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        assert.equal(
          (
            await call("suite/templates", {
              action: "import",
              package: team.package,
              preview_hash: preview.data.digest,
            })
          ).status,
          400,
        );
      }
      const team = starterTeams[0],
        preview = await call("suite/templates", {
          action: "preview",
          package: team.package,
        });
      const imported = await call("suite/templates", {
        action: "import",
        package: team.package,
        preview_hash: preview.data.digest,
        reviewed: true,
      });
      assert.equal(imported.status, 200, JSON.stringify(imported.data));
      const agents = (
        await pool.query(
          "SELECT execution_paused,model_id FROM agents WHERE id IN(SELECT jsonb_array_elements_text(agent_ids) FROM workspace_projects WHERE id=$1)",
          [imported.data.project_id],
        )
      ).rows;
      assert.equal(agents.length, 3);
      assert.ok(
        agents.every((a: any) => a.execution_paused && a.model_id === null),
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT credits,run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
            [ws],
          )
        ).rows[0],
        before,
      );
    },
  );
  await t.test(
    "Native adapters traverse the real reservation and settlement path; exhausted budgets make zero HTTP calls",
    async () => {
      let requests = 0;
      const server = createServer(async (req, res) => {
        let body = "";
        for await (const part of req) body += part;
        const b = JSON.parse(body);
        requests++;
        assert.ok(b.max_tokens || b.max_output_tokens);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            req.url === "/v1/messages"
              ? {
                  stop_reason: "end_turn",
                  content: [{ type: "text", text: "Fixture answer" }],
                  usage: {
                    input_tokens: 25,
                    output_tokens: 15,
                    cache_read_input_tokens: 5,
                  },
                }
              : {
                  status: "completed",
                  output: [
                    {
                      type: "message",
                      content: [
                        { type: "output_text", text: "Fixture answer" },
                      ],
                    },
                  ],
                  usage: { input_tokens: 25, output_tokens: 15 },
                },
          ),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      try {
        for (const kind of ["anthropic", "openai-responses"]) {
          const task = await leased("execute");
          const input = {
            name: "Native protocol fixture",
            provider_name: "Fixture",
            endpoint: "http://127.0.0.1:" + address.port + "/v1",
            model: "fixture",
            key: "fixture-only",
            input_rate: 0,
            output_rate: 0,
            monitor_enabled: false,
            engine_kind: kind,
            max_output_tokens: 1024,
          };
          const saved = await call("models", input);
          assert.equal(saved.status, 200, JSON.stringify(saved.data));
          const model = saved.data.id;
          assert.equal(
            (
              await pool.query(
                "SELECT engine_kind FROM model_offerings WHERE id=$1",
                [model],
              )
            ).rows[0].engine_kind,
            kind,
          );
          const { engine_kind, key, ...legacyInput } = input;
          const legacy = await call("models", { ...legacyInput, id: model });
          assert.equal(legacy.status, 200, JSON.stringify(legacy.data));
          assert.equal(
            (
              await pool.query(
                "SELECT engine_kind FROM model_offerings WHERE id=$1",
                [model],
              )
            ).rows[0].engine_kind,
            kind,
            "Older edit requests retain the protocol and encrypted credential",
          );
          await pool.query("UPDATE tasks SET model_id=$2 WHERE id=$1", [
            task.task,
            model,
          ]);
          const messages = [
            { role: "system" as const, content: "Fixture system" },
            { role: "user" as const, content: "Fixture question" },
          ];
          const answer = await modelStep(task.task, task.lease, messages, []);
          assert.ok(answer);
          assert.equal(answer.content, "Fixture answer");
          const n = requests;
          await modelStep(task.task, task.lease, messages, []);
          assert.equal(requests, n, "Replay uses the settled response");
          const usage = (
            await pool.query(
              "SELECT tokens_used,token_limit FROM runs WHERE id=$1",
              [task.run],
            )
          ).rows[0];
          assert.equal(
            Number(usage.tokens_used),
            kind === "anthropic" ? 45 : 40,
          );
          assert.equal(Number(usage.token_limit), 50000);
          await pool.query(
            "UPDATE runs SET token_limit=1000,tokens_used=999 WHERE id=$1",
            [task.run],
          );
          await assert.rejects(() =>
            modelStep(
              task.task,
              task.lease,
              [...messages, { role: "user", content: "Second question" }],
              [],
            ),
          );
          assert.equal(
            requests,
            n,
            "No provider call when admission cannot fit",
          );
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
  await pool.query("UPDATE runs SET status='canceled' WHERE workspace_id=$1", [
    ws,
  ]);
  await pool.query(
    "UPDATE tasks SET status='canceled',lease_token=NULL,lease_until=NULL WHERE workspace_id=$1",
    [ws],
  );
}
