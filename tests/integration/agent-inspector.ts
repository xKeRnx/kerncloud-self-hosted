import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function agentInspectorTests(t: any, { request, pool }: any) {
  const owner = await request("auth/signup", {
    name: "Inspector fixture",
    email: "inspector@fixture.invalid",
    password: "inspector-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(owner.status, 200);
  const state = (await request("state", undefined, owner.cookie)).data;
  const ws = state.workspace.id,
    agent = state.agents[0],
    other = state.agents[1],
    p1 = state.project.id,
    p2 = randomUUID(),
    run = randomUUID(),
    task = randomUUID(),
    child = randomUUID(),
    otherRun = randomUUID(),
    otherTask = randomUUID();
  const foreign = await request("auth/signup", {
    name: "Inspector foreign",
    email: "inspector-foreign@fixture.invalid",
    password: "inspector-foreign-password",
    privacyAccepted: true,
  });
  assert.equal(foreign.status, 200);
  const foreignState = (await request("state", undefined, foreign.cookie)).data;
  await pool.query(
    "INSERT INTO workspace_projects(id,workspace_id,name,status,all_agents) VALUES($1,$2,'Inspector second project','active',true)",
    [p2, ws],
  );
  for (const [id, project] of [
    [run, p1],
    [otherRun, p2],
  ])
    await pool.query(
      "INSERT INTO runs(id,workspace_id,project_id,goal,status,max_steps,token_limit,credit_limit) VALUES($1,$2,$3,'Inspector protocol fixture','paused',20,10000,1000)",
      [id, ws, project],
    );
  const messages = [
    { role: "system", content: "PRIVATE_SYSTEM_INSTRUCTION" },
    ...Array.from({ length: 45 }, (_, i) => ({
      role: "user",
      content: "Historical input " + i,
    })),
    {
      role: "assistant",
      content: "I will hand over the evidence.",
      reasoning: "PRIVATE_REASONING",
      tool_calls: [
        {
          id: "inspector-tool",
          type: "function",
          function: {
            name: "team_message",
            arguments: JSON.stringify({
              agent_id: other.id,
              message: "Please review",
              api_key: "PRIVATE_TOOL_KEY",
            }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "inspector-tool",
      content: JSON.stringify({
        result: "Delivered",
        password: "PRIVATE_RESULT_PASSWORD",
      }),
    },
  ];
  await pool.query(
    "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,error,messages,context_state) VALUES($1,$2,$3,$4,'Review business plan','Use evidence; no guarantees','input_required','Fixed budget needs review',$5,$6)",
    [
      task,
      run,
      ws,
      agent.id,
      JSON.stringify(messages),
      JSON.stringify({
        estimated_input_upper_bound: 900,
        omitted_groups: 3,
        summary: "PRIVATE_CONTEXT_SUMMARY",
      }),
    ],
  );
  await pool.query(
    "INSERT INTO tasks(id,run_id,workspace_id,agent_id,parent_id,title,instructions,status,result) VALUES($1,$2,$3,$4,$5,'Evidence check','Check the sources','completed','Evidence checked')",
    [child, run, ws, other.id, task],
  );
  await pool.query(
    "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status) VALUES($1,$2,$3,$4,'Second project work','Fixture','completed')",
    [otherTask, otherRun, ws, agent.id],
  );
  for (const [taskId, tokens, input, output, known, bound, reserved] of [
    [task, 100, 80, 20, true, 0, 0],
    [task, 0, 0, 0, false, 500, 30],
    [child, 50, 40, 10, true, 0, 0],
  ])
    await pool.query(
      "INSERT INTO model_calls(id,workspace_id,run_id,task_id,status,reserved,managed,tokens,input_tokens,output_tokens,usage_known,budget_tokens,model_name,provider_name) VALUES($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,'Inspector fixture model','Fixture')",
      [
        randomUUID(),
        ws,
        run,
        taskId,
        known ? "settled" : "uncertain",
        reserved,
        tokens,
        input,
        output,
        known,
        bound,
      ],
    );
  await pool.query(
    "INSERT INTO project_plan_items(workspace_id,project_id,agent_id,run_id,title,status,estimate_min,estimate_max) VALUES($1,$2,$3,$4,'Review evidence','ready',2,5)",
    [ws, p1, agent.id, run],
  );
  await pool.query(
    "INSERT INTO events(workspace_id,run_id,agent_id,kind,content) VALUES($1,$2,$3,'message','Incoming review from team')",
    [ws, run, other.id],
  );
  const base = `agents/${agent.id}/inspect`,
    req = (p: string) => request(p, undefined, owner.cookie);
  const prefs = (
    await pool.query(
      "SELECT * FROM user_workspace_preferences WHERE user_id=$1 ORDER BY workspace_id",
      [state.user.id],
    )
  ).rows;
  try {
    await t.test(
      "Agent inspector is scoped to workspace and selected agent, with a read-only project filter and shared budget",
      async () => {
        const all = await req(base);
        assert.equal(all.status, 200, JSON.stringify(all.data));
        assert.equal(all.data.total, 2);
        assert.equal(Number(all.data.usage.tokens), 100);
        assert.equal(all.data.usage.calls, 2);
        assert.equal(all.data.usage.unknown_calls, 1);
        const filtered = await req(base + "?filterProject=" + p2);
        assert.equal(filtered.status, 200);
        assert.deepEqual(
          filtered.data.tasks.map((r: any) => r.id),
          [otherTask],
        );
        const forbidden = await request(base, undefined, foreign.cookie);
        assert.equal(forbidden.status, 404);
        const badProject = await req(
          base + "?filterProject=" + foreignState.project.id,
        );
        assert.equal(badProject.status, 404);
        const detail = await req(base + "/task/" + task);
        assert.equal(detail.status, 200, JSON.stringify(detail.data));
        assert.equal(Number(detail.data.budget.measured_tokens), 150);
        assert.equal(Number(detail.data.budget.accounted_tokens), 650);
        assert.equal(Number(detail.data.budget.credits), 30);
        assert.equal(detail.data.calls_total, 2);
        assert.equal(detail.data.plan[0].title, "Review evidence");
        assert.equal(detail.data.relations[0].id, child);
        assert.ok(
          detail.data.events.some((e: any) => e.agent_name === other.name),
        );
        assert.equal(
          (await req(`agents/${other.id}/inspect/task/${task}`)).status,
          404,
        );
        assert.equal((await req(base + "?page=0")).status, 400);
        assert.deepEqual(
          (
            await pool.query(
              "SELECT * FROM user_workspace_preferences WHERE user_id=$1 ORDER BY workspace_id",
              [state.user.id],
            )
          ).rows,
          prefs,
        );
      },
    );
    await t.test(
      "Agent inspection paginates original messages, removes secrets and internal reasoning, and performs no model call",
      async () => {
        const beforeCalls = Number(
          (await pool.query("SELECT count(*) n FROM model_calls")).rows[0].n,
        );
        let cursor: number | null = null,
          seen: number[] = [],
          iterations = 0;
        do {
          const result = await req(
            base +
              "/task/" +
              task +
              (cursor === null ? "" : "?before=" + cursor),
          );
          assert.equal(result.status, 200);
          const text = JSON.stringify(result.data);
          for (const secret of [
            "PRIVATE_SYSTEM_INSTRUCTION",
            "PRIVATE_REASONING",
            "PRIVATE_TOOL_KEY",
            "PRIVATE_RESULT_PASSWORD",
            "PRIVATE_CONTEXT_SUMMARY",
            "lease_token",
            "proposal_cipher",
          ])
            assert.ok(!text.includes(secret), secret);
          for (const e of result.data.entries) {
            assert.ok(!seen.includes(e.index));
            seen.push(e.index);
          }
          cursor = result.data.next_before;
          assert.ok(++iterations < 8);
        } while (cursor !== null);
        assert.equal(seen.length, messages.length - 1);
        assert.equal(
          Number(
            (await pool.query("SELECT count(*) n FROM model_calls")).rows[0].n,
          ),
          beforeCalls,
        );
        await pool.query(
          "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'viewer')",
          [ws, foreignState.user.id],
        );
        const viewer = await request(
          base + "?workspaceId=" + ws,
          undefined,
          foreign.cookie,
        );
        assert.equal(viewer.status, 200);
        const viewerDetail = await request(
          base + "/task/" + task + "?workspaceId=" + ws,
          undefined,
          foreign.cookie,
        );
        assert.equal(viewerDetail.status, 200);
        assert.equal(
          (
            await request(
              base + "?workspaceId=" + ws,
              { action: "write" },
              foreign.cookie,
            )
          ).status,
          403,
        );
      },
    );
  } finally {
    await pool.query(
      "UPDATE tasks SET status='canceled' WHERE run_id IN($1,$2)",
      [run, otherRun],
    );
    await pool.query("UPDATE runs SET status='canceled' WHERE id IN($1,$2)", [
      run,
      otherRun,
    ]);
  }
}
