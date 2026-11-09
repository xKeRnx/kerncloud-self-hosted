import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function workspaceRebuildTests(t: any, { request, pool }: any) {
  const owner = await request("auth/signup", {
    name: "Workspace navigation fixture",
    email: "workspace-rebuild@fixture.invalid",
    password: "workspace-rebuild-test-password",
    privacyAccepted: true,
  });
  assert.equal(owner.status, 200);
  const req = (p: string, b?: unknown) => request(p, b, owner.cookie);
  const s = (await req("state")).data,
    ws = s.workspace.id,
    p1 = s.project.id,
    p2 = randomUUID(),
    agent = s.agents[0].id;
  await pool.query(
    "INSERT INTO workspace_projects(id,workspace_id,name,status,all_agents) VALUES($1,$2,'Second scoped project','active',true)",
    [p2, ws],
  );
  const runs: string[] = [];
  for (let n = 0; n < 33; n++) {
    const id = randomUUID();
    runs.push(id);
    await pool.query(
      "INSERT INTO runs(id,workspace_id,project_id,goal,status,max_steps,created_at) VALUES($1,$2,$3,$4,'completed',20,'2026-01-01T10:00:00.123456Z')",
      [
        id,
        ws,
        n % 2 ? p2 : p1,
        "Workspace result " + n + (n === 2 ? " 100% literal_" : ""),
      ],
    );
  }
  await pool.query("UPDATE runs SET status='paused' WHERE id=$1", [runs[0]]);
  const task = randomUUID();
  await pool.query(
    "INSERT INTO tasks(id,workspace_id,run_id,agent_id,title,instructions,status,error) VALUES($1,$2,$3,$4,'Need a decision','Do not call a provider','input_required','Fixture question')",
    [task, ws, runs[0], agent],
  );
  const artifacts: string[] = [];
  for (let n = 0; n < 28; n++) {
    const id = randomUUID();
    artifacts.push(id);
    await pool.query(
      "INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content,created_at) VALUES($1,$2,$3,$4,$5,'PRIVATE_RESULT_CONTENT','2026-01-01T11:00:00.123456Z')",
      [id, ws, runs[0], task, "file-" + n + ".md"],
    );
  }
  const foreign = await request("auth/signup", {
    name: "Foreign navigation fixture",
    email: "workspace-rebuild-foreign@fixture.invalid",
    password: "foreign-navigation-fixture-password",
    privacyAccepted: true,
  });
  const f = (await request("state", undefined, foreign.cookie)).data;
  const before = await pool.query(
    "SELECT project_id FROM user_workspace_preferences WHERE user_id=$1 AND workspace_id=$2",
    [s.user.id, ws],
  );
  try {
    await t.test(
      "workspace home covers all projects, keeps partial results distinct and exposes no file bodies",
      async () => {
        const r = await req("workspace/home");
        assert.equal(r.status, 200);
        assert.equal(r.data.scope, "workspace");
        assert.equal(r.data.stats.completed, 32);
        assert.equal(r.data.stats.open, 1);
        assert.equal(r.data.stats.attention, 1);
        assert.equal(r.data.stats.projects, 2);
        assert.equal(r.data.running[0].project_id, p1);
        assert.equal(r.data.attention[0].id, task);
        assert.equal(r.data.results.length, 1);
        assert.equal(r.data.results[0].status, "paused");
        assert.ok(!JSON.stringify(r.data).includes("PRIVATE_RESULT_CONTENT"));
        assert.equal(
          (
            await request(
              "workspace/home?workspaceId=" + ws,
              undefined,
              foreign.cookie,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "all-task filters and microsecond-safe keyset cursors never change project preferences or leak foreign work",
      async () => {
        const first = await req("workspace/tasks");
        assert.equal(first.status, 200);
        assert.equal(first.data.items.length, 25);
        assert.ok(first.data.next);
        const next = await req(
          "workspace/tasks?before=" + encodeURIComponent(first.data.next),
        );
        assert.equal(next.status, 200);
        assert.equal(next.data.items.length, 8);
        assert.equal(
          new Set(
            [...first.data.items, ...next.data.items].map((x: any) => x.id),
          ).size,
          33,
        );
        assert.equal(
          (await req("workspace/tasks?project=" + p2)).data.items.length,
          16,
        );
        assert.equal(
          (await req("workspace/tasks?status=paused")).data.items.length,
          1,
        );
        assert.equal(
          (await req("workspace/tasks?status=input_required")).data.items
            .length,
          1,
        );
        assert.equal(
          (
            await req(
              "workspace/tasks?q=" + encodeURIComponent("100% literal_"),
            )
          ).data.items.length,
          1,
        );
        assert.notEqual(
          (await req("workspace/tasks?project=" + f.project.id)).status,
          200,
        );
        assert.equal((await req("workspace/tasks?before=invalid")).status, 400);
        const after = await pool.query(
          "SELECT project_id FROM user_workspace_preferences WHERE user_id=$1 AND workspace_id=$2",
          [s.user.id, ws],
        );
        assert.deepEqual(after.rows, before.rows);
      },
    );
    await t.test(
      "project result pagination is scoped, excludes retired versions and returns metadata only",
      async () => {
        const a = await req("project/results?projectId=" + p1);
        assert.equal(a.status, 200);
        assert.equal(a.data.items.length, 25);
        const b = await req(
          "project/results?projectId=" +
            p1 +
            "&before=" +
            encodeURIComponent(a.data.next),
        );
        assert.equal(b.data.items.length, 3);
        assert.equal(
          new Set([...a.data.items, ...b.data.items].map((x: any) => x.id))
            .size,
          28,
        );
        assert.equal(
          (await req("project/results?projectId=" + p2)).data.items.length,
          0,
        );
        assert.ok(!JSON.stringify(a.data).includes("PRIVATE_RESULT_CONTENT"));
        await pool.query("UPDATE artifacts SET retired=true WHERE id=$1", [
          artifacts[0],
        ]);
        const c = await req("project/results?projectId=" + p1);
        assert.ok(!c.data.items.some((x: any) => x.id === artifacts[0]));
        assert.notEqual(
          (await req("project/results?projectId=" + f.project.id)).status,
          200,
        );
        assert.equal((await req("project/results?before=invalid")).status, 400);
      },
    );
    await t.test(
      "new-task budgets can reduce defaults but never silently expand them; old requests keep default behavior",
      async () => {
        const model = await req("models", {
          name: "Navigation protocol fixture",
          provider_name: "Fixture",
          endpoint: "http://127.0.0.1:9/v1",
          model: "fixture-no-execution",
          key: "fixture-only",
          monitor_enabled: false,
        });
        assert.equal(model.status, 200);
        assert.equal(
          (await req("default-model", { modelId: model.data.id })).status,
          200,
        );
        const defaults = (
          await pool.query(
            "SELECT run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
            [ws],
          )
        ).rows[0];
        const count = Number(
          (
            await pool.query(
              "SELECT count(*) n FROM model_calls WHERE workspace_id=$1",
              [ws],
            )
          ).rows[0].n,
        );
        assert.equal(
          (
            await req("runs", {
              goal: "Do not execute this fixture",
              agentId: agent,
              projectId: p2,
              tokenLimit: defaults.run_token_limit + 1,
              creditLimit: 0,
            })
          ).status,
          409,
        );
        for (const custom of [true, false]) {
          const r = await req("runs", {
            goal: "Protocol-only task creation fixture",
            agentId: agent,
            projectId: p2,
            ...(custom ? { tokenLimit: 1000, creditLimit: 0 } : {}),
          });
          assert.equal(r.status, 200, JSON.stringify(r.data));
          runs.push(r.data.id);
          const row = (
            await pool.query("SELECT * FROM runs WHERE id=$1", [r.data.id])
          ).rows[0];
          assert.equal(row.project_id, p2);
          assert.equal(
            row.token_limit,
            custom ? 1000 : defaults.run_token_limit,
          );
          assert.equal(
            row.credit_limit,
            custom ? 0 : defaults.run_credit_limit,
          );
          await request(
            "runs/" + r.data.id,
            { action: "cancel" },
            owner.cookie,
            "PATCH",
          );
        }
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM model_calls WHERE workspace_id=$1",
                [ws],
              )
            ).rows[0].n,
          ),
          count,
        );
        const now = (
          await pool.query(
            "SELECT run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
            [ws],
          )
        ).rows[0];
        assert.deepEqual(now, defaults);
        await pool.query(
          "UPDATE model_offerings SET active=false WHERE id=$1",
          [model.data.id],
        );
      },
    );
  } finally {
    await pool.query(
      "UPDATE tasks SET status='canceled',lease_token=NULL,lease_until=NULL,worker_id=NULL WHERE run_id=ANY($1::text[]) AND status NOT IN('completed','failed','canceled')",
      [runs],
    );
    await pool.query(
      "UPDATE runs SET status='canceled' WHERE id=ANY($1::text[])",
      [runs],
    );
  }
}
