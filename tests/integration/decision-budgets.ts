import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transaction } from "../../src/server/db.ts";
import { createDecision } from "../../src/server/decisions.ts";
export async function decisionBudgetTests(t: any, { request, pool }: any) {
  const signed = await request("auth/signup", {
    name: "Budget decision fixture",
    email: "decision-budget@fixture.invalid",
    password: "decision-budget-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(signed.status, 200);
  const state = (await request("state", undefined, signed.cookie)).data,
    ws = state.workspace.id,
    agent = state.agents[0].id,
    project = state.project.id;
  const Q =
    "Das feste Auftragslimit reicht für keinen weiteren sinnvollen Modellschritt. Kein Anbieteraufruf gestartet.";
  const runIds: string[] = [];
  const fixture = async (question = Q, options: string[] = []) => {
    const run = randomUUID(),
      task = randomUUID();
    runIds.push(run);
    await pool.query(
      "INSERT INTO runs(id,workspace_id,project_id,goal,status,max_steps,token_limit,credit_limit,tokens_used) VALUES($1,$2,$3,'Decision budget protocol fixture','paused',20,100000,10000,85319)",
      [run, ws, project],
    );
    await pool.query(
      "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,error,messages,context_state) VALUES($1,$2,$3,$4,'Budget fixture','Fixture instructions','input_required',$5,'[]',$6)",
      [
        task,
        run,
        ws,
        agent,
        question,
        JSON.stringify({ estimated_input_upper_bound: 14048 }),
      ],
    );
    await pool.query(
      "INSERT INTO model_calls(id,workspace_id,run_id,task_id,reserved,managed,status,tokens,input_tokens,output_tokens,usage_known) VALUES($1,$2,$3,$4,0,false,'settled',85319,80000,5319,true)",
      [randomUUID(), ws, run, task],
    );
    const taskRow = {
      id: task,
      workspace_id: ws,
      run_id: run,
      agent_id: agent,
    };
    const decision = await transaction((c) =>
      createDecision(
        c,
        taskRow,
        { question, kind: "review", options },
        "decision-budget:" + task,
      ),
    );
    return { run, task, decision };
  };
  const req = (path: string, body?: unknown) =>
    request(path, body, signed.cookie);
  const body = (id: string, token_limit = 100000000) => ({
    id,
    choice: "budget_increase",
    confirm_budget_change: true,
    budget: {
      token_limit,
      credit_limit: 10000,
      expected_token_limit: 100000,
      expected_credit_limit: 10000,
    },
  });
  try {
    await t.test(
      "Budget stop stays pending after text replies and chat messages, without starting another model attempt",
      async () => {
        const f = await fixture(),
          before = Number(
            (
              await pool.query(
                "SELECT count(*) n FROM model_calls WHERE run_id=$1",
                [f.run],
              )
            ).rows[0].n,
          );
        assert.equal(
          (
            await req("decisions/respond", {
              id: f.decision,
              choice: "answer",
              message: "Limit auf 100mio erweitern!",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await req(`runs/${f.run}/message`, {
              message: "Limit auf 100mio erweitern!",
            })
          ).status,
          409,
        );
        const listed = (await req("decisions")).data.items.find(
          (d: any) => d.id === f.decision,
        );
        assert.equal(listed.budget.scope, "run");
        assert.equal(listed.budget.max_token_limit, 100000000);
        assert.equal(listed.budget.minimum_token_limit, 101415);
        assert.equal(
          (await pool.query("SELECT status FROM tasks WHERE id=$1", [f.task]))
            .rows[0].status,
          "input_required",
        );
        assert.equal(
          (
            await pool.query("SELECT status FROM decisions WHERE id=$1", [
              f.decision,
            ])
          ).rows[0].status,
          "pending",
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM model_calls WHERE run_id=$1",
                [f.run],
              )
            ).rows[0].n,
          ),
          before,
        );
      },
    );
    await t.test(
      "Explicit 100-million-token override is atomic, idempotent and limited to this run; paused runs remain paused",
      async () => {
        const f = await fixture(),
          snapshot = (
            await pool.query(
              "SELECT run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
              [ws],
            )
          ).rows[0],
          account = (
            await pool.query("SELECT credits FROM accounts WHERE owner_id=$1", [
              state.user.id,
            ])
          ).rows[0].credits;
        assert.equal(
          (
            await req("decisions/respond", {
              ...body(f.decision),
              confirm_budget_change: false,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req("decisions/respond", {
              ...body(f.decision),
              budget: {
                ...body(f.decision).budget,
                expected_token_limit: 200000,
              },
            })
          ).status,
          409,
        );
        const responses = await Promise.all([
          req("decisions/respond", body(f.decision)),
          req("decisions/respond", body(f.decision)),
        ]);
        assert.ok(
          responses.every((r) => r.status === 200),
          JSON.stringify(responses),
        );
        assert.equal(responses.filter((r) => r.data.duplicate).length, 1);
        const run = (
          await pool.query(
            "SELECT token_limit,credit_limit,status FROM runs WHERE id=$1",
            [f.run],
          )
        ).rows[0];
        assert.deepEqual(run, {
          token_limit: 100000000,
          credit_limit: 10000,
          status: "paused",
        });
        assert.equal(
          (await pool.query("SELECT status FROM tasks WHERE id=$1", [f.task]))
            .rows[0].status,
          "queued",
        );
        assert.deepEqual(
          (
            await pool.query(
              "SELECT run_token_limit,run_credit_limit FROM workspaces WHERE id=$1",
              [ws],
            )
          ).rows[0],
          snapshot,
        );
        assert.equal(
          (
            await pool.query("SELECT credits FROM accounts WHERE owner_id=$1", [
              state.user.id,
            ])
          ).rows[0].credits,
          account,
        );
        assert.ok(
          !(await req("decisions")).data.items.some(
            (d: any) => d.id === f.decision,
          ),
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM events WHERE run_id=$1 AND kind='decision'",
                [f.run],
              )
            ).rows[0].n,
          ),
          1,
        );
        await assert.rejects(() =>
          pool.query("UPDATE runs SET token_limit=100000001 WHERE id=$1", [
            f.run,
          ]),
        );
      },
    );
    await t.test(
      "Budget overrides respect workspace role, project quota and typed current limits",
      async () => {
        const f = await fixture(),
          other = await request("auth/signup", {
            name: "Budget role fixture",
            email: "decision-budget-role@fixture.invalid",
            password: "decision-budget-role-password",
            privacyAccepted: true,
          }),
          otherState = (await request("state", undefined, other.cookie)).data;
        assert.equal(
          (await request("decisions/respond", body(f.decision), other.cookie))
            .status,
          404,
        );
        await pool.query(
          "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor')",
          [ws, otherState.user.id],
        );
        assert.equal(
          (
            await request(
              "decisions/respond?workspaceId=" + ws,
              body(f.decision),
              other.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await req("decisions/respond", {
              ...body(f.decision),
              budget: { ...body(f.decision).budget, token_limit: 100000001 },
            })
          ).status,
          400,
        );
        const cap = (
          await pool.query(
            "SELECT token_limit FROM workspace_projects WHERE id=$1",
            [project],
          )
        ).rows[0].token_limit;
        try {
          await pool.query(
            "UPDATE workspace_projects SET token_limit=1000000 WHERE id=$1",
            [project],
          );
          assert.equal(
            (await req("decisions/respond", body(f.decision))).status,
            409,
          );
        } finally {
          await pool.query(
            "UPDATE workspace_projects SET token_limit=$2 WHERE id=$1",
            [project, cap],
          );
        }
        const d = (
          await pool.query("SELECT status FROM decisions WHERE id=$1", [
            f.decision,
          ])
        ).rows[0];
        assert.equal(d.status, "pending");
      },
    );
    await t.test(
      "Pause and stop close budget requests without retry loops, preserve files and invalidate task leases",
      async () => {
        for (const action of ["budget_pause", "budget_stop"]) {
          const f = await fixture(),
            artifact = randomUUID(),
            otherTask = randomUUID();
          await pool.query(
            "INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content) VALUES($1,$2,$3,$4,'kept.md','Keep these results')",
            [artifact, ws, f.run, f.task],
          );
          await pool.query(
            "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token) VALUES($1,$2,$3,$4,'Parallel fixture','Fixture','running','fixture-lease')",
            [otherTask, f.run, ws, agent],
          );
          const response = await req("decisions/respond", {
            id: f.decision,
            choice: action,
          });
          assert.equal(response.status, 200, JSON.stringify(response.data));
          assert.equal(
            (await pool.query("SELECT status FROM runs WHERE id=$1", [f.run]))
              .rows[0].status,
            action === "budget_pause" ? "paused" : "canceled",
          );
          const tasks = (
            await pool.query(
              "SELECT status,lease_token FROM tasks WHERE run_id=$1",
              [f.run],
            )
          ).rows;
          assert.ok(tasks.every((v: any) => v.lease_token === null));
          assert.ok(
            tasks.every(
              (v: any) =>
                v.status ===
                (action === "budget_pause" ? "queued" : "canceled"),
            ),
          );
          assert.equal(
            (
              await pool.query("SELECT content FROM artifacts WHERE id=$1", [
                artifact,
              ])
            ).rows[0].content,
            "Keep these results",
          );
          assert.ok(
            !(await req("decisions")).data.items.some(
              (v: any) => v.id === f.decision,
            ),
          );
        }
      },
    );
    await t.test(
      "Questions persist up to three specific options, allow a custom reply and never turn suggestions into action approvals",
      async () => {
        const f = await fixture(
          "Welche Zielgruppe soll die Website ansprechen?",
          ["Privatkunden", "Unternehmen", "Beide"],
        );
        const listed = (await req("decisions")).data.items.find(
          (d: any) => d.id === f.decision,
        );
        assert.deepEqual(listed.answer_options, [
          "Privatkunden",
          "Unternehmen",
          "Beide",
        ]);
        assert.equal(listed.budget, null);
        const answer = {
          id: f.decision,
          choice: "answer",
          option_index: 1,
          message: "Bitte den Einkauf ansprechen.",
        };
        assert.equal((await req("decisions/respond", answer)).status, 200);
        assert.equal(
          (await req("decisions/respond", answer)).data.duplicate,
          true,
        );
        const messages = (
          await pool.query("SELECT messages FROM tasks WHERE id=$1", [f.task])
        ).rows[0].messages;
        assert.ok(messages.at(-1).content.includes("Unternehmen"));
        assert.ok(messages.at(-1).content.includes("Bitte den Einkauf"));
        assert.ok(messages.at(-1).content.includes("keine Aktionsfreigabe"));
        const own = await fixture("Welche Farbe?");
        assert.equal(
          (
            await req("decisions/respond", {
              id: own.decision,
              choice: "answer",
              message: "Dunkelblau",
            })
          ).status,
          200,
        );
        const fallback = await fixture("Bitte Angaben ergänzen.");
        assert.equal(
          (await req("decisions")).data.items.find(
            (d: any) => d.id === fallback.decision,
          ).answer_options.length,
          3,
        );
        await assert.rejects(() =>
          transaction((c) =>
            createDecision(
              c,
              {
                id: fallback.task,
                run_id: fallback.run,
                workspace_id: ws,
                agent_id: agent,
              },
              { question: "Zu viele", options: ["1", "2", "3", "4"] },
              "invalid-options",
            ),
          ),
        );
      },
    );
  } finally {
    await pool.query(
      "UPDATE tasks SET status='canceled',lease_token=NULL,lease_until=NULL,worker_id=NULL WHERE run_id=ANY($1::text[]) AND status NOT IN('completed','failed','canceled')",
      [runIds],
    );
    await pool.query(
      "UPDATE runs SET status='canceled' WHERE id=ANY($1::text[])",
      [runIds],
    );
  }
}
