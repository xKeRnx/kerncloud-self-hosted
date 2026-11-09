import { tickAutomations } from "../../src/server/automations.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transaction } from "../../src/server/db.ts";
import { encrypt } from "../../src/server/security.ts";
import { claim, bindAttachments, finishTask } from "../../src/server/store.ts";
import { toolStep, context } from "../../src/server/engine.ts";
import {
  searchKnowledge,
  readKnowledge,
} from "../../src/server/knowledge-search.ts";
import { writeMemory, listMemory } from "../../src/server/memory.ts";
import {
  savePlan,
  enforceProjectBudget,
  createHire,
} from "../../src/server/organisation.ts";
import { environmentPermission } from "../../src/server/environment-tools.ts";
export async function organisationTests(
  t: any,
  { request, pool, fixtureUrl }: any,
) {
  const signed = await request("auth/signup", {
    name: "Organisation fixture",
    email: "organisation@fixture.invalid",
    password: "organisation-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(signed.status, 200);
  const cookie = signed.cookie,
    state = (await request("state", undefined, cookie)).data,
    ws = state.workspace.id,
    chief = state.agents.find((a: any) => a.can_manage),
    model = randomUUID();
  let centralEnvironmentFixture:
    | {
        host: string;
        envA: string;
        envB: string;
        gateway: string;
      }
    | undefined;
  const original = (
    await pool.query(
      "SELECT max_agents,max_automations,max_environments,max_running_environments,runtime_minutes,environment_templates,active FROM plans WHERE id='business'",
    )
  ).rows[0];
  const originalTemplates = (
    await pool.query(
      "SELECT id,enabled FROM environment_templates WHERE id IN('browser','development')",
    )
  ).rows;
  await pool.query(
    "UPDATE environment_templates SET enabled=true WHERE id IN('browser','development')",
  );
  await pool.query(
    "UPDATE plans SET max_agents=50,max_automations=30,max_environments=10,max_running_environments=10,runtime_minutes=1200,environment_templates='[\"browser\",\"development\"]',active=true WHERE id='business'",
  );
  await pool.query(
    "UPDATE accounts SET plan_id='business',subscription_status='local_test' WHERE id=$1",
    [state.workspace.account_id],
  );
  await pool.query(
    "INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,input_rate,output_rate,monitor_enabled) VALUES($1,$2,'Organisation protocol fixture','Fixture',$3,'fixture', $4,0,0,false)",
    [model, ws, fixtureUrl + "/v1", encrypt("fixture-only")],
  );
  await pool.query("UPDATE workspaces SET default_model_id=$2 WHERE id=$1", [
    ws,
    model,
  ]);
  const project = async (name: string, agent_ids = [chief.id]) => {
    const r = await request(
      "suite/work-projects",
      { name, agent_ids, credit_limit: 10000, token_limit: 100000 },
      cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.id;
  };
  const a = await project("Project Alpha"),
    b = await project("Project Beta");
  const scoped = (path: string, body?: any, p = a) =>
    request(
      path + (path.includes("?") ? "&" : "?") + "projectId=" + p,
      body,
      cookie,
    );
  const cancel = async () => {
    await pool.query(
      "UPDATE runs SET status='canceled' WHERE workspace_id=$1 AND status<>'completed'",
      [ws],
    );
    await pool.query(
      "UPDATE tasks SET status='canceled',lease_token=NULL,lease_until=NULL WHERE workspace_id=$1 AND status IN('queued','running','input_required','waiting')",
      [ws],
    );
  };
  const leased = async (projectId = a) => {
    const run = randomUUID(),
      task = randomUUID(),
      lease = randomUUID();
    await pool.query(
      "INSERT INTO runs(id,workspace_id,project_id,goal,max_steps) VALUES($1,$2,$3,'Organisation protocol fixture',20)",
      [run, ws, projectId],
    );
    await pool.query(
      "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Fixture','Fixture','running',$5,now()+interval '90 seconds')",
      [task, run, ws, chief.id, lease],
    );
    return { run, task, lease };
  };
  try {
    await t.test(
      "projects preserve the default workspace and reject foreign selections",
      async () => {
        assert.ok(state.workspace.project_id);
        assert.equal((await scoped("suite/organisation")).data.project.id, a);
        const foreign = await request("auth/signup", {
          name: "Foreign project fixture",
          email: "org-foreign@fixture.invalid",
          password: "foreign-fixture-password",
          privacyAccepted: true,
        });
        assert.equal(
          (
            await request(
              "suite/organisation?projectId=" + a,
              undefined,
              foreign.cookie,
            )
          ).status,
          404,
        );
        const s = (await scoped("state?view=files")).data;
        assert.equal(s.project.id, a);
        assert.equal(s.workspace.project_id, a);
      },
    );
    await t.test(
      "account project selection follows separate sessions, ignores stale browser cookies and keeps explicit read scopes transient",
      async () => {
        const device = await request("auth/login", {
          email: "organisation@fixture.invalid",
          password: "organisation-fixture-password",
        });
        assert.equal(device.status, 200);
        const saved = await request("preferences/project", { id: b }, cookie);
        assert.equal(saved.status, 200);
        assert.equal(saved.data.saved, true);
        for (const page of [
          "state?view=files",
          "state?view=tasks",
          "state?view=overview",
        ]) {
          const next = await request(
            page,
            undefined,
            device.cookie +
              "; kc_project=" +
              a +
              "; kc_project_" +
              ws +
              "=" +
              a,
          );
          assert.equal(next.status, 200);
          assert.equal(next.data.workspace.project_id, b);
        }
        assert.equal((await scoped("state")).data.workspace.project_id, a);
        assert.equal(
          (await request("state", undefined, device.cookie)).data.workspace
            .project_id,
          b,
          "a scoped read must not overwrite the saved preference",
        );
        const timestamp = (
          await pool.query(
            "SELECT updated_at FROM user_workspace_preferences WHERE user_id=$1 AND workspace_id=$2",
            [state.user.id, ws],
          )
        ).rows[0].updated_at;
        await request("preferences/project", { id: b }, cookie);
        assert.equal(
          (
            await pool.query(
              "SELECT updated_at FROM user_workspace_preferences WHERE user_id=$1 AND workspace_id=$2",
              [state.user.id, ws],
            )
          ).rows[0].updated_at.toISOString(),
          timestamp.toISOString(),
          "repeated selection does not trigger writes or refresh loops",
        );
        const exported = await request("privacy/export", undefined, cookie);
        assert.equal(exported.status, 200);
        assert.ok(
          exported.data.project_preferences.some(
            (p: any) => p.workspace_id === ws && p.project_id === b,
          ),
        );
      },
    );
    await t.test(
      "project preferences are personal, permit viewer navigation and reject foreign workspaces and projects",
      async () => {
        const viewer = await request("auth/signup", {
          name: "Preference viewer",
          email: "preference-viewer@fixture.invalid",
          password: "preference-viewer-fixture-password",
          privacyAccepted: true,
        });
        assert.equal(viewer.status, 200);
        const viewerState = (await request("state", undefined, viewer.cookie))
          .data;
        await pool.query(
          "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'viewer')",
          [ws, viewerState.user.id],
        );
        const selected = await request(
          "preferences/project?workspaceId=" + ws,
          { id: a, user_id: state.user.id },
          viewer.cookie,
        );
        assert.equal(selected.status, 200);
        assert.equal(
          (await request("state?workspaceId=" + ws, undefined, viewer.cookie))
            .data.workspace.project_id,
          a,
        );
        assert.equal(
          (await request("state", undefined, cookie)).data.workspace.project_id,
          b,
          "another member's selection is independent",
        );
        assert.equal(
          (await request("preferences/project", { id: a }, viewer.cookie))
            .status,
          404,
        );
        const foreign = await request(
          "preferences/project?workspaceId=" + viewerState.workspace.id,
          { id: viewerState.workspace.project_id },
          cookie,
        );
        assert.equal(foreign.status, 403);
        assert.equal(
          (
            await request(
              "suite/work-projects?workspaceId=" + ws,
              { name: "Forbidden", agent_ids: [] },
              viewer.cookie,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "each workspace remembers its own project and removed selections fall back safely",
      async () => {
        const second = await request(
          "workspaces",
          { name: "Preference second workspace" },
          cookie,
        );
        assert.equal(second.status, 200, JSON.stringify(second.data));
        const secondState = await request(
          "state?workspaceId=" + second.data.id,
          undefined,
          cookie,
        );
        assert.equal(secondState.status, 200);
        assert.equal(
          (
            await request(
              "preferences/project?workspaceId=" + second.data.id,
              { id: secondState.data.workspace.project_id },
              cookie,
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("state", undefined, cookie)).data.workspace.project_id,
          b,
        );
        const temp = await project("Temporary preference target");
        await request("preferences/project", { id: temp }, cookie);
        await pool.query("DELETE FROM workspace_projects WHERE id=$1", [temp]);
        assert.equal(
          (await request("state", undefined, cookie)).data.workspace.project_id,
          state.workspace.project_id,
        );
        await request("preferences/project", { id: b }, cookie);
      },
    );
    const file = randomUUID(),
      skill = randomUUID();
    await pool.query(
      "INSERT INTO attachments(id,workspace_id,project_id,name,mime,source,content,bytes) VALUES($1,$2,$3,'alpha-private.txt','text/plain','fixture','UnmistakableAlphaSecret',24)",
      [file, ws, a],
    );
    await t.test(
      "project files and guessed source IDs are inaccessible until explicitly shared",
      async () => {
        assert.equal(
          (await scoped("attachments/" + file, undefined, b)).status,
          404,
        );
        assert.equal(
          (
            await scoped("state?view=files", undefined, b)
          ).data.attachments.some((f: any) => f.id === file),
          false,
        );
        assert.equal(
          (
            await searchKnowledge(
              ws,
              { query: "UnmistakableAlphaSecret" },
              pool,
              b,
            )
          ).results.length,
          0,
        );
        await assert.rejects(
          () => readKnowledge(ws, { kind: "attachment", id: file }, pool, b),
          (e: any) => e.status === 404,
        );
        const r = await leased(b);
        await assert.rejects(
          () => transaction((c) => bindAttachments(c, ws, r.run, [file])),
          (e: any) => e.status === 403,
        );
        await cancel();
        assert.equal(
          (
            await scoped("suite/material-sharing", {
              kind: "attachment",
              id: file,
              workspace_shared: true,
            })
          ).status,
          200,
        );
        assert.equal(
          (await scoped("attachments/" + file, undefined, b)).status,
          200,
        );
        assert.equal(
          (
            await searchKnowledge(
              ws,
              { query: "UnmistakableAlphaSecret" },
              pool,
              b,
            )
          ).results.length,
          1,
        );
        await scoped("suite/material-sharing", {
          kind: "attachment",
          id: file,
          workspace_shared: false,
        });
      },
    );
    await t.test(
      "memory keys can repeat per project and source references cannot bridge projects",
      async () => {
        const input = {
          key: "architecture",
          title: "Architecture",
          content: "Alpha private design",
          kind: "knowledge" as const,
          status: "open" as const,
          evidence: "",
          expected_revision: null,
          pinned: false,
          verified: false,
        };
        await transaction((c) =>
          writeMemory(c, ws, input, chief.id, false, false, a),
        );
        await transaction((c) =>
          writeMemory(
            c,
            ws,
            { ...input, content: "Beta private design" },
            chief.id,
            false,
            false,
            b,
          ),
        );
        const rows = await transaction((c) => listMemory(c, ws, "", true, b));
        assert.equal(
          rows.find((m: any) => m.key === "architecture").content,
          "Beta private design",
        );
        assert.ok(!JSON.stringify(rows).includes("Alpha private design"));
        await assert.rejects(
          () =>
            transaction((c) =>
              writeMemory(
                c,
                ws,
                {
                  ...input,
                  key: "bad-reference",
                  source_refs: [{ kind: "attachment", id: file }],
                },
                chief.id,
                false,
                false,
                b,
              ),
            ),
          (e: any) => e.status === 403,
        );
      },
    );
    await t.test(
      "agent context exposes its project only and keeps unused organisation tools lazy",
      async () => {
        const r = await leased(b),
          ctx = await context(r.task, r.lease);
        assert.ok(ctx.system.includes(b));
        assert.ok(!ctx.system.includes("Alpha private design"));
        const status = JSON.parse(
          (
            await toolStep(
              r.task,
              r.lease,
              "status-for-hire",
              "project_status",
              {},
              [],
              {},
            )
          ).result,
        );
        assert.ok(status.available_models.some((m: any) => m.id === model));
        assert.ok(
          status.available_models.every(
            (m: any) => !("endpoint" in m) && !("key" in m),
          ),
        );
        assert.ok(status.capacity.max_agents > 0);
        assert.ok(status.hiring.hiring);
        const result = await toolStep(
          r.task,
          r.lease,
          "read-foreign",
          "read_attachment",
          { attachment_id: file },
          [],
          {},
        ).catch((e: any) => e);
        assert.equal(result.status, 403);
        await cancel();
      },
    );
    await t.test(
      "a container in the same workspace remains unavailable to another project",
      async () => {
        const host = randomUUID(),
          environment = randomUUID(),
          r = await leased(b);
        await pool.query(
          "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,enabled,last_seen) VALUES($1,'Organisation container fixture','docker','fixture-only',true,now())",
          [host],
        );
        await pool.query(
          "INSERT INTO customer_environments(id,workspace_id,project_id,host_id,template_id,name,status,self_service,agent_permissions,controller_seen) VALUES($1,$2,$3,$4,'development','Alpha-only environment','running',false,'[\"files\",\"exec\"]',now())",
          [environment, ws, a, host],
        );
        await assert.rejects(
          () =>
            transaction((c) =>
              environmentPermission(c, r.task, r.lease, environment, "exec"),
            ),
          (e: any) => e.status === 409,
        );
        const list = await toolStep(
          r.task,
          r.lease,
          "project-environments",
          "list_environments",
          {},
          [],
          {},
        );
        assert.ok(!list.result.includes(environment));
        const beta = await scoped("runtime", undefined, b),
          alpha = await scoped("runtime", undefined, a);
        assert.equal(beta.status, 200, JSON.stringify(beta.data));
        assert.ok(
          !beta.data.environments.some((e: any) => e.id === environment),
        );
        assert.ok(
          alpha.data.environments.some((e: any) => e.id === environment),
        );
        assert.ok(
          !(await scoped("environments", undefined, b)).data.environments.some(
            (e: any) => e.id === environment,
          ),
        );
        assert.equal(
          (
            await scoped(
              "environments/manage",
              { action: "stop", id: environment },
              b,
            )
          ).status,
          404,
        );
        assert.equal(
          (await scoped("environments/launch", { id: environment }, b)).status,
          404,
        );
        const statsA = (
            await scoped("suite/organisation?section=projects", undefined, a)
          ).data,
          statsB = (
            await scoped("suite/organisation?section=projects", undefined, b)
          ).data;
        assert.equal(statsA.stats.files, 1);
        assert.equal(statsB.stats.files, 0);
        assert.equal(statsA.stats.environments, 1);
        assert.equal(statsB.stats.environments, 0);
        assert.ok(statsA.recent_runs.every((r: any) => r.project_id === a));
        assert.ok(statsB.recent_runs.every((r: any) => r.project_id === b));
        await cancel();
      },
    );

    await t.test(
      "central environment overview filters every project without exposing credentials or changing the saved project",
      async () => {
        const host = randomUUID(),
          envA = randomUUID(),
          envB = randomUUID();
        await pool.query(
          "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,enabled,provisioning,self_service,last_seen,inventory) VALUES($1,'Central protocol host','docker','central-fixture-only',true,true,true,now(),'{\"commandsEnabled\":true,\"accessConfigured\":true}')",
          [host],
        );
        await pool.query(
          "INSERT INTO customer_environments(id,workspace_id,project_id,host_id,template_id,name,status,self_service,resource_id,access_blocked) VALUES($1,$3,$4,$6,'development','Central fixture Alpha','stopped',true,'protocol-alpha',true),($2,$3,$5,$6,'browser','Central fixture Beta','booked',true,NULL,true)",
          [envA, envB, ws, a, b, host],
        );
        await request("preferences/project", { id: a }, cookie);
        const all = await request(
          "environments/overview?query=Central%20fixture",
          undefined,
          cookie,
        );
        assert.equal(all.status, 200, JSON.stringify(all.data));
        assert.equal(all.data.total, 2);
        assert.equal(all.data.can_manage, true);
        assert.deepEqual(
          new Set(all.data.environments.map((e: any) => e.project_id)),
          new Set([a, b]),
        );
        for (const e of all.data.environments) {
          assert.ok(e.project_name);
          for (const k of [
            "secret",
            "token_hash",
            "resource_id",
            "agent_permissions",
            "inventory",
          ])
            assert.ok(!(k in e), k);
        }
        const filtered = await request(
          "environments/overview?filterProject=" +
            b +
            "&query=Central%20fixture&status=booked",
          undefined,
          cookie,
        );
        assert.equal(filtered.status, 200);
        assert.equal(filtered.data.total, 1);
        assert.equal(filtered.data.environments[0].id, envB);
        const page2 = await request(
          "environments/overview?query=Central%20fixture&page=2",
          undefined,
          cookie,
        );
        assert.equal(page2.status, 200);
        assert.equal(page2.data.environments.length, 0);
        assert.equal(
          (await request("state", undefined, cookie)).data.workspace.project_id,
          a,
        );
        const bad = await request(
          "environments/overview?filterProject=" + randomUUID(),
          undefined,
          cookie,
        );
        assert.equal(bad.status, 404);
        // Keep the protocol IDs in this isolated fixture scope for the following lifecycle assertions.
        centralEnvironmentFixture = { host, envA, envB, gateway: randomUUID() };
      },
    );
    await t.test(
      "central lifecycle queues the existing start/stop jobs, preserves preferences and enforces plan and tenant rules",
      async () => {
        const { host, envA, envB } = centralEnvironmentFixture!;
        await pool.query(
          "UPDATE workspaces SET allow_hosted_execution=true WHERE id=$1",
          [ws],
        );
        await pool.query(
          "INSERT INTO gateway_instances(id,address,expires_at) VALUES($1,'http://central-fixture.invalid:3200',now()+interval '1 hour')",
          [centralEnvironmentFixture!.gateway],
        );
        const foreign = await request(
          "environments/overview/manage",
          {
            id: randomUUID(),
            action: "start",
            expectedProjectId: a,
            expectedRate: 1,
          },
          cookie,
        );
        assert.equal(foreign.status, 404);
        const stale = await request(
          "environments/overview/manage",
          { id: envA, action: "start", expectedProjectId: b, expectedRate: 1 },
          cookie,
        );
        assert.equal(stale.status, 409);
        const rate = Number(
          (
            await pool.query(
              "SELECT runtime_rate FROM environment_templates WHERE id='development'",
            )
          ).rows[0].runtime_rate,
        );
        const start = await request(
          "environments/overview/manage",
          {
            id: envA,
            action: "start",
            expectedProjectId: a,
            expectedRate: rate,
          },
          cookie,
        );
        assert.equal(start.status, 200, JSON.stringify(start.data));
        const started = (
          await pool.query(
            "SELECT status,access_blocked FROM customer_environments WHERE id=$1",
            [envA],
          )
        ).rows[0];
        assert.equal(started.status, "pending");
        assert.equal(started.access_blocked, true);
        assert.equal(
          (
            await pool.query(
              "SELECT action FROM environment_jobs WHERE id=$1",
              [start.data.jobId],
            )
          ).rows[0].action,
          "start",
        );
        assert.equal(
          (
            await request(
              "environments/overview/manage",
              {
                id: envA,
                action: "assign",
                expectedProjectId: a,
                targetProjectId: b,
              },
              cookie,
            )
          ).status,
          409,
        );
        await pool.query(
          "UPDATE environment_jobs SET status='completed' WHERE id=$1",
          [start.data.jobId],
        );
        await pool.query(
          "UPDATE customer_environments SET status='running',access_blocked=false WHERE id=$1",
          [envA],
        );
        const stop = await request(
          "environments/overview/manage",
          { id: envA, action: "stop", expectedProjectId: a },
          cookie,
        );
        assert.equal(stop.status, 200, JSON.stringify(stop.data));
        const stopped = (
          await pool.query(
            "SELECT status,access_blocked,shutdown_requested FROM customer_environments WHERE id=$1",
            [envA],
          )
        ).rows[0];
        assert.equal(stopped.status, "pending");
        assert.equal(stopped.access_blocked, true);
        assert.equal(stopped.shutdown_requested, true);
        await pool.query(
          "UPDATE environment_jobs SET status='completed' WHERE id=$1",
          [stop.data.jobId],
        );
        await pool.query(
          "UPDATE customer_environments SET status='stopped',billing_active=false,reservation=NULL WHERE id=$1",
          [envA],
        );
        assert.equal(
          (await request("state", undefined, cookie)).data.workspace.project_id,
          a,
        );
        const oldPlan = (
          await pool.query(
            "SELECT subscription_status FROM accounts WHERE id=$1",
            [state.workspace.account_id],
          )
        ).rows[0].subscription_status;
        await pool.query(
          "UPDATE accounts SET subscription_status='canceled' WHERE id=$1",
          [state.workspace.account_id],
        );
        assert.equal(
          (
            await request(
              "environments/overview/manage",
              {
                id: envB,
                action: "start",
                expectedProjectId: b,
                expectedRate: 1,
              },
              cookie,
            )
          ).status,
          403,
        );
        await pool.query(
          "UPDATE accounts SET subscription_status=$2 WHERE id=$1",
          [state.workspace.account_id, oldPlan],
        );
        const viewer = await request("auth/login", {
          email: "preference-viewer@fixture.invalid",
          password: "preference-viewer-fixture-password",
        });
        const viewed = await request(
          "environments/overview?workspaceId=" + ws,
          undefined,
          viewer.cookie,
        );
        assert.equal(viewed.status, 200);
        assert.equal(viewed.data.can_manage, false);
        assert.equal(
          (
            await request(
              "environments/overview/manage?workspaceId=" + ws,
              { id: envA, action: "stop", expectedProjectId: a },
              viewer.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "environments/overview/manage",
              { id: envA, action: "stop", expectedProjectId: a },
              viewer.cookie,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "stopped environment reassignment rejects uncertain work and stale mappings, keeps files and cannot cross workspaces",
      async () => {
        const { host, envA, envB } = centralEnvironmentFixture!;
        const job = randomUUID();
        await pool.query(
          "INSERT INTO environment_jobs(id,environment_id,host_id,action,generation,spec,status) VALUES($1,$2,$3,'stop',1,'{}','uncertain')",
          [job, envA, host],
        );
        const move = () =>
          request(
            "environments/overview/manage",
            {
              id: envA,
              action: "assign",
              expectedProjectId: a,
              targetProjectId: b,
            },
            cookie,
          );
        assert.equal((await move()).status, 409);
        await pool.query(
          "UPDATE environment_jobs SET status='completed' WHERE id=$1",
          [job],
        );
        await pool.query(
          "UPDATE customer_environments SET billing_active=true WHERE id=$1",
          [envA],
        );
        assert.equal((await move()).status, 409);
        await pool.query(
          "UPDATE customer_environments SET billing_active=false WHERE id=$1",
          [envA],
        );
        assert.equal(
          (
            await request(
              "environments/overview/manage",
              {
                id: envA,
                action: "assign",
                expectedProjectId: a,
                targetProjectId: randomUUID(),
              },
              cookie,
            )
          ).status,
          404,
        );
        const work = await leased(a),
          operation = randomUUID(),
          call = randomUUID();
        await pool.query(
          "INSERT INTO operations(id,task_id,status,result) VALUES($1,$2,'done','{}')",
          [operation, work.task],
        );
        await pool.query(
          "INSERT INTO environment_tool_calls(id,operation_id,environment_id,generation,task_id,task_lease,permission,tool,args,status) VALUES($1,$2,$3,1,$4,$5,'exec','exec','{}','uncertain')",
          [call, operation, envA, work.task, work.lease],
        );
        assert.equal((await move()).status, 409);
        await pool.query(
          "UPDATE environment_tool_calls SET status='canceled' WHERE id=$1",
          [call],
        );
        const before = (
          await pool.query(
            "SELECT resource_id,generation FROM customer_environments WHERE id=$1",
            [envA],
          )
        ).rows[0];
        assert.equal((await move()).status, 200);
        const after = (
          await pool.query(
            "SELECT project_id,resource_id,generation FROM customer_environments WHERE id=$1",
            [envA],
          )
        ).rows[0];
        assert.equal(after.project_id, b);
        assert.equal(after.resource_id, before.resource_id);
        assert.equal(after.generation, before.generation);
        assert.equal((await move()).status, 409);
        assert.equal(
          (await request("state", undefined, cookie)).data.workspace.project_id,
          a,
        );
        assert.ok(
          !(await scoped("runtime", undefined, a)).data.environments.some(
            (e: any) => e.id === envA,
          ),
        );
        assert.ok(
          (await scoped("runtime", undefined, b)).data.environments.some(
            (e: any) => e.id === envA,
          ),
        );
        await request("preferences/project", { id: b }, cookie);
      },
    );
    await t.test(
      "plan graph prevents cycles, foreign prerequisites and agent edits of locked steps",
      async () => {
        const one = await scoped("suite/plan", {
          project_id: a,
          title: "Foundation",
          agent_id: chief.id,
          locked: true,
        });
        assert.equal(one.status, 200, JSON.stringify(one.data));
        const two = await scoped("suite/plan", {
          project_id: a,
          title: "Follow-up",
          agent_id: chief.id,
          dependencies: [one.data.id],
        });
        assert.equal(two.status, 200);
        const item = (await scoped("suite/organisation")).data.items.find(
          (i: any) => i.id === one.data.id,
        );
        assert.equal(
          (
            await scoped("suite/plan", {
              project_id: a,
              id: item.id,
              revision: item.revision,
              title: "Cycle",
              dependencies: [two.data.id],
            })
          ).status,
          400,
        );
        await assert.rejects(
          () =>
            transaction((c) =>
              savePlan(
                c,
                ws,
                {
                  project_id: a,
                  id: item.id,
                  revision: item.revision,
                  title: "Agent override",
                },
                chief.id,
              ),
            ),
          (e: any) => e.status === 403,
        );
        assert.equal(
          (
            await scoped(
              "suite/plan",
              {
                project_id: b,
                title: "Foreign dependency",
                dependencies: [item.id],
              },
              b,
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "task claiming waits for prerequisites and planned start without model calls",
      async () => {
        const data = (await scoped("suite/organisation")).data,
          dep = data.items.find((i: any) => i.title === "Foundation"),
          item = data.items.find((i: any) => i.title === "Follow-up");
        const r = await scoped("runs", {
          goal: "Follow-up protocol fixture",
          agentId: chief.id,
          planItemId: item.id,
        });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(await claim(randomUUID()), null);
        await pool.query(
          "UPDATE project_plan_items SET status='done' WHERE id=$1",
          [dep.id],
        );
        assert.equal((await claim(randomUUID()))?.task.run_id, r.data.id);
        await cancel();
        const future = await scoped("suite/plan", {
          project_id: a,
          title: "Future fixture",
          agent_id: chief.id,
          planned_start: new Date(Date.now() + 3600000).toISOString(),
        });
        const queued = await scoped("runs", {
          goal: "Wait for future start",
          agentId: chief.id,
          planItemId: future.data.id,
        });
        assert.equal(queued.status, 200);
        assert.equal(await claim(randomUUID()), null);
        await cancel();
      },
    );

    await t.test(
      "agents execute planned subtasks inside the same run budget",
      async () => {
        const second = state.agents.find((a: any) => a.id !== chief.id).id;
        await pool.query(
          "UPDATE workspace_projects SET agent_ids=agent_ids||to_jsonb($2::text) WHERE id=$1",
          [a, second],
        );
        const first = await scoped("suite/plan", {
          project_id: a,
          title: "Agent planned first step",
          agent_id: second,
        });
        const next = await scoped("suite/plan", {
          project_id: a,
          title: "Agent planned next step",
          agent_id: second,
          dependencies: [first.data.id],
        });
        const r = await leased(),
          before = (
            await pool.query(
              "SELECT credit_limit,token_limit FROM runs WHERE id=$1",
              [r.run],
            )
          ).rows[0];
        const one = await toolStep(
          r.task,
          r.lease,
          "plan-delegate-one",
          "delegate_task",
          {
            agent_id: second,
            title: "First planned fixture",
            instructions: "Verify fixture one without model calls.",
            plan_item_id: first.data.id,
          },
          [],
          {},
        );
        const two = await toolStep(
          r.task,
          r.lease,
          "plan-delegate-two",
          "delegate_task",
          {
            agent_id: second,
            title: "Next planned fixture",
            instructions: "Verify fixture two after fixture one.",
            plan_item_id: next.data.id,
          },
          [],
          {},
        );
        await toolStep(
          r.task,
          r.lease,
          "plan-wait",
          "wait_for_team",
          {},
          [],
          {},
        );
        const claimed = await claim(randomUUID());
        assert.equal(claimed?.task.id, JSON.parse(one.result).task_id);
        assert.equal(claimed?.task.run_id, r.run);
        await transaction((c) =>
          finishTask(
            c,
            claimed!.task,
            "completed",
            "Protocol fixture completed with evidence.",
          ),
        );
        const following = await claim(randomUUID());
        assert.equal(following?.task.id, JSON.parse(two.result).task_id);
        assert.equal(following?.task.run_id, r.run);
        assert.deepEqual(
          (
            await pool.query(
              "SELECT credit_limit,token_limit FROM runs WHERE id=$1",
              [r.run],
            )
          ).rows[0],
          before,
        );
        assert.equal(
          Number(
            (
              await pool.query("SELECT count(*) n FROM runs WHERE id=$1", [
                r.run,
              ])
            ).rows[0].n,
          ),
          1,
        );
        await cancel();
      },
    );
    await t.test(
      "parallel reservations share one fixed project budget",
      async () => {
        const r = await leased();
        await pool.query(
          "UPDATE workspace_projects SET credit_limit=100 WHERE id=$1",
          [a],
        );
        const reserve = () =>
          transaction(async (c) => {
            const run = (
              await c.query("SELECT * FROM runs WHERE id=$1", [r.run])
            ).rows[0];
            await enforceProjectBudget(c, run, chief.id, 60, 100);
            await c.query(
              "INSERT INTO model_calls(id,workspace_id,run_id,task_id,reserved,managed,budget_tokens) VALUES($1,$2,$3,$4,60,true,100)",
              [randomUUID(), ws, r.run, r.task],
            );
          });
        const results = await Promise.allSettled([reserve(), reserve()]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.filter((r) => r.status === "rejected").length, 1);
        await pool.query(
          "UPDATE workspace_projects SET credit_limit=10000 WHERE id=$1",
          [a],
        );
        await cancel();
      },
    );
    await t.test(
      "reporting cycles are rejected and locks stop agent-initiated organisation changes",
      async () => {
        const data = (await scoped("suite/organisation")).data,
          other = data.agents.find((a: any) => a.id !== chief.id),
          agents = data.agents.map((x: any) => ({
            id: x.id,
            manager_id: x.manager_id,
            structure_locked: x.structure_locked,
            can_manage: x.can_manage,
            monthly_credit_limit: x.monthly_credit_limit,
          }));
        agents.find((x: any) => x.id === chief.id).manager_id = other.id;
        assert.equal(
          (
            await scoped("suite/organisation", {
              action: "structure",
              revision: data.policy.revision,
              agents,
            })
          ).status,
          400,
        );
        await pool.query(
          "UPDATE organisation_settings SET locked=true WHERE workspace_id=$1",
          [ws],
        );
        const r = await leased();
        await assert.rejects(
          () =>
            toolStep(
              r.task,
              r.lease,
              "locked-hire",
              "request_agent",
              {
                name: "QA",
                role: "Tester",
                instructions: "Verify the concrete project output.",
                manager_id: chief.id,
                project_id: a,
                model_id: model,
                credit_limit: 100,
                reason: "A project-specific test specialist is needed.",
              },
              [],
              {},
            ),
          (e: any) => e.status === 403,
        );
        await pool.query(
          "UPDATE organisation_settings SET locked=false WHERE workspace_id=$1",
          [ws],
        );
        await cancel();
      },
    );
    let hired = "";
    const hire = {
      name: "QA Specialist",
      role: "Tester",
      instructions: "Verify concrete project output using assigned tools only.",
      manager_id: chief.id,
      project_id: a,
      model_id: model,
      credit_limit: 100,
      reason: "A project-specific test specialist is needed.",
    };
    await t.test(
      "agent hiring pauses for exact approval, creates once and grants no extra capabilities",
      async () => {
        const r = await leased();
        const result = await toolStep(
          r.task,
          r.lease,
          "hire-one",
          "request_agent",
          hire,
          [],
          {},
        );
        assert.equal(result.yield, true);
        const inbox = await scoped("decisions");
        assert.equal(inbox.status, 200);
        const d = (
          await pool.query("SELECT id FROM decisions WHERE task_id=$1", [
            r.task,
          ])
        ).rows[0];
        const answer = await scoped("decisions/respond", {
          id: d.id,
          choice: "approve",
        });
        assert.equal(answer.status, 200, JSON.stringify(answer.data));
        assert.equal(
          (await scoped("decisions/respond", { id: d.id, choice: "approve" }))
            .status,
          200,
        );
        const rows = (
          await pool.query("SELECT * FROM agents WHERE hire_source=$1", [
            "decision:" + d.id,
          ])
        ).rows;
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0].mcp_ids, []);
        assert.deepEqual(rows[0].skill_ids, []);
        assert.equal(rows[0].manager_id, chief.id);
        hired = rows[0].id;
        assert.equal(
          (await pool.query("SELECT kc_project_agent($1,$2) ok", [a, hired]))
            .rows[0].ok,
          true,
        );
        assert.equal(
          (await pool.query("SELECT kc_project_agent($1,$2) ok", [b, hired]))
            .rows[0].ok,
          false,
        );
        await cancel();
      },
    );
    await t.test(
      "automatic hires honour allowed model, role, count and fixed cost limits",
      async () => {
        await pool.query(
          "UPDATE organisation_settings SET hiring='automatic',max_hires=1,allowed_roles=$2,allowed_models=$3,hire_credit_limit=100 WHERE workspace_id=$1",
          [ws, JSON.stringify(["Tester"]), JSON.stringify([model])],
        );
        const r = await leased(),
          task = {
            id: r.task,
            workspace_id: ws,
            run_id: r.run,
            agent_id: chief.id,
          };
        await assert.rejects(
          () =>
            transaction((c) =>
              createHire(c, task, { ...hire, role: "Unapproved" }, "bad-role"),
            ),
          (e: any) => e.status === 403,
        );
        await assert.rejects(
          () =>
            transaction((c) =>
              createHire(c, task, { ...hire, credit_limit: 101 }, "bad-budget"),
            ),
          (e: any) => e.status === 403,
        );
        const created = await transaction((c) =>
          createHire(c, task, { ...hire, name: "Auto QA" }, "auto-one"),
        );
        assert.ok(created?.id);
        await assert.rejects(
          () =>
            transaction((c) =>
              createHire(c, task, { ...hire, name: "Second QA" }, "auto-two"),
            ),
          (e: any) => e.status === 403,
        );
        await cancel();
      },
    );

    await t.test(
      "a denied hire cannot be retried under a new operation or automatic policy",
      async () => {
        await pool.query(
          "UPDATE organisation_settings SET hiring='approval' WHERE workspace_id=$1",
          [ws],
        );
        const r = await leased(),
          proposal = { ...hire, name: "Rejected Specialist", credit_limit: 90 };
        await toolStep(
          r.task,
          r.lease,
          "denied-hire",
          "request_agent",
          proposal,
          [],
          {},
        );
        const d = (
          await pool.query("SELECT id FROM decisions WHERE task_id=$1", [
            r.task,
          ])
        ).rows[0];
        assert.equal(
          (await scoped("decisions/respond", { id: d.id, choice: "deny" }))
            .status,
          200,
        );
        await pool.query(
          "UPDATE organisation_settings SET hiring='automatic',max_hires=2 WHERE workspace_id=$1",
          [ws],
        );
        await assert.rejects(
          () =>
            transaction((c) =>
              createHire(
                c,
                {
                  id: r.task,
                  workspace_id: ws,
                  run_id: r.run,
                  agent_id: chief.id,
                },
                proposal,
                "retry-denied",
              ),
            ),
          (e: any) => e.status === 403 && e.message.includes("abgelehnt"),
        );
        await cancel();
      },
    );
    await t.test(
      "organisation proposals require exact approval and stale policy revisions cannot execute",
      async () => {
        const auto = (
          await pool.query(
            "SELECT id FROM agents WHERE workspace_id=$1 AND auto_hire",
            [ws],
          )
        ).rows[0].id;
        const r = await leased(),
          moves = {
            moves: [{ id: hired, manager_id: auto }],
            reason: "Place testing specialists under a focused team lead.",
          };
        const proposed = await toolStep(
          r.task,
          r.lease,
          "reorg",
          "propose_organisation",
          moves,
          [],
          {},
        );
        assert.equal(proposed.yield, true);
        const d = (
          await pool.query("SELECT id FROM decisions WHERE task_id=$1", [
            r.task,
          ])
        ).rows[0];
        const approved = await scoped("decisions/respond", {
          id: d.id,
          choice: "approve",
        });
        assert.equal(approved.status, 200, JSON.stringify(approved.data));
        assert.equal(
          (
            await pool.query("SELECT manager_id FROM agents WHERE id=$1", [
              hired,
            ])
          ).rows[0].manager_id,
          auto,
        );
        await cancel();
        const next = await leased();
        await toolStep(
          next.task,
          next.lease,
          "stale-reorg",
          "propose_organisation",
          {
            moves: [{ id: hired, manager_id: chief.id }],
            reason: "Return the specialist to the project coordinator.",
          },
          [],
          {},
        );
        const pending = (
          await pool.query("SELECT id FROM decisions WHERE task_id=$1", [
            next.task,
          ])
        ).rows[0];
        await pool.query(
          "UPDATE organisation_settings SET revision=revision+1 WHERE workspace_id=$1",
          [ws],
        );
        assert.equal(
          (
            await scoped("decisions/respond", {
              id: pending.id,
              choice: "approve",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query("SELECT manager_id FROM agents WHERE id=$1", [
              hired,
            ])
          ).rows[0].manager_id,
          auto,
        );
        await cancel();
      },
    );
    await pool.query(
      "INSERT INTO skills(id,workspace_id,project_id,name,description,content,status) VALUES($1,$2,$3,'Fixture skill','Test routine skill','Read the project status and report concrete findings.','approved')",
      [skill, ws, a],
    );
    await pool.query("UPDATE agents SET skill_ids=$2 WHERE id=$1", [
      chief.id,
      JSON.stringify([skill]),
    ]);
    await t.test(
      "routines coalesce bursts and can skip triggers instead of building a backlog",
      async () => {
        const body = {
          action: "save",
          name: "Project routine",
          agent_id: chief.id,
          skill_id: skill,
          mode: "agent",
          goal: "Report the current project status with evidence.",
          interval_minutes: 60,
          token_limit: 1000,
          credit_limit: 100,
          enabled: true,
          overlap_policy: "coalesce",
          catch_up: "skip",
        };
        const saved = await scoped("automations", body);
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        for (let n = 0; n < 4; n++)
          assert.equal(
            (await scoped("automations", { action: "run", id: saved.data.id }))
              .status,
            200,
          );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM automation_triggers WHERE automation_id=$1 AND status='queued'",
                [saved.data.id],
              )
            ).rows[0].n,
          ),
          1,
        );
        assert.equal(
          (await scoped("automations", undefined, b)).data.entries.length,
          0,
        );
        await pool.query(
          "DELETE FROM automation_triggers WHERE automation_id=$1",
          [saved.data.id],
        );
        await pool.query(
          "UPDATE automations SET next_at=now()-interval '3 hours' WHERE id=$1",
          [saved.data.id],
        );
        await tickAutomations();
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM automation_triggers WHERE automation_id=$1",
                [saved.data.id],
              )
            ).rows[0].n,
          ),
          0,
        );
        assert.ok(
          Date.parse(
            (
              await pool.query("SELECT next_at FROM automations WHERE id=$1", [
                saved.data.id,
              ])
            ).rows[0].next_at,
          ) > Date.now(),
        );
        await scoped("automations", {
          action: "toggle",
          id: saved.data.id,
          enabled: false,
        });
      },
    );
    await t.test(
      "team packages need exact preview, import paused and remain idempotent",
      async () => {
        const exported = await scoped("suite/templates", { action: "export" });
        assert.equal(exported.status, 200, JSON.stringify(exported.data));
        const packageData = exported.data.package;
        assert.ok(!JSON.stringify(packageData).includes("fixture-only"));
        assert.ok(
          !JSON.stringify(packageData).includes("UnmistakableAlphaSecret"),
        );
        const preview = await scoped("suite/templates", {
          action: "preview",
          package: packageData,
        });
        assert.equal(preview.status, 200);
        assert.equal(
          (
            await scoped("suite/templates", {
              action: "import",
              package: packageData,
              preview_hash: "wrong",
              reviewed: true,
            })
          ).status,
          400,
        );
        const imported = await scoped("suite/templates", {
          action: "import",
          package: packageData,
          preview_hash: preview.data.digest,
          reviewed: true,
        });
        assert.equal(imported.status, 200, JSON.stringify(imported.data));
        const again = await scoped("suite/templates", {
          action: "import",
          package: packageData,
          preview_hash: preview.data.digest,
          reviewed: true,
        });
        assert.equal(again.data.project_id, imported.data.project_id);
        const project = (
          await pool.query("SELECT * FROM workspace_projects WHERE id=$1", [
            imported.data.project_id,
          ])
        ).rows[0];
        assert.equal(project.status, "planned");
        for (const id of project.agent_ids) {
          const agent = (
            await pool.query(
              "SELECT execution_paused,mcp_ids FROM agents WHERE id=$1",
              [id],
            )
          ).rows[0];
          assert.equal(agent.execution_paused, true);
          assert.deepEqual(agent.mcp_ids, []);
        }
        assert.ok(
          (
            await pool.query(
              "SELECT enabled FROM automations WHERE project_id=$1",
              [project.id],
            )
          ).rows.every((r: any) => !r.enabled),
        );
        assert.ok(
          (
            await pool.query("SELECT status FROM skills WHERE project_id=$1", [
              project.id,
            ])
          ).rows.every((r: any) => r.status === "draft"),
        );
      },
    );
  } finally {
    for (const template of originalTemplates)
      await pool.query(
        "UPDATE environment_templates SET enabled=$2 WHERE id=$1",
        [template.id, template.enabled],
      );
    if (centralEnvironmentFixture) {
      await pool.query("DELETE FROM gateway_instances WHERE id=$1", [
        centralEnvironmentFixture.gateway,
      ]);
      await pool.query(
        "UPDATE infrastructure_hosts SET enabled=false,provisioning=false WHERE id=$1",
        [centralEnvironmentFixture.host],
      );
    }
    await cancel();
    await pool.query(
      "UPDATE automations SET enabled=false WHERE workspace_id=$1",
      [ws],
    );
    await pool.query(
      "UPDATE plans SET max_agents=$1,max_automations=$2,max_environments=$3,max_running_environments=$4,runtime_minutes=$5,environment_templates=$6,active=$7 WHERE id='business'",
      [
        original.max_agents,
        original.max_automations,
        original.max_environments,
        original.max_running_environments,
        original.runtime_minutes,
        JSON.stringify(original.environment_templates),
        original.active,
      ],
    );
  }
}
