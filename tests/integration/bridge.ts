import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
export async function bridgeTests(t: any, { request, pool }: any) {
  const { handle } = await import("../../src/server/api.ts");
  const { bridgeToolStep } = await import("../../src/server/bridge.ts");
  const owner = await request("auth/signup", {
    name: "Bridge fixture",
    email: "bridge@fixture.invalid",
    password: "bridge-fixture-password",
    privacyAccepted: true,
  });
  const req = (p: string, b?: unknown) => request(p, b, owner.cookie);
  const s = (await req("state")).data,
    w = s.workspace.id,
    p = s.project.id,
    a = s.agents[0].id;
  await pool.query(
    "UPDATE accounts SET plan_id='business',subscription_status='active' WHERE owner_id=$1",
    [s.user.id],
  );
  const scope = {
    project_ids: [p],
    agent_ids: [a],
    capabilities: ["files.read", "files.write"],
  };
  let token: any, device: any;
  const agent = async (path: string, b: unknown, key = "") => {
    const response = await handle(
      new NextRequest("http://localhost:3100/api/bridge/agent/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { authorization: "Bearer " + key } : {}),
        },
        body: JSON.stringify(b),
      }),
      "bridge/agent/" + path,
    );
    return { status: response.status, data: await response.json() };
  };
  const policy = {
    capabilities: ["files.read"],
    roots: [{ alias: "docs", write: false }],
    targets: [],
    programs: [],
  };
  await t.test(
    "Bridge token metadata never returns secrets; foreign scopes and reusable enrollment are denied",
    async () => {
      const foreign = await request("auth/signup", {
        name: "Foreign bridge",
        email: "bridge-foreign@fixture.invalid",
        password: "bridge-foreign-password",
        privacyAccepted: true,
      });
      const f = (await request("state", undefined, foreign.cookie)).data;
      const bad = await req("bridge", {
        action: "create",
        name: "bad",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        scope: { ...scope, project_ids: [f.project.id] },
      });
      assert.equal(bad.status, 403);
      token = await req("bridge", {
        action: "create",
        name: "Device test",
        scope,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      assert.equal(token.status, 200);
      assert.match(token.data.token, /^kcb_/);
      assert.ok(
        !JSON.stringify((await req("bridge")).data).includes(token.data.token),
      );
      assert.equal(
        (
          await request(
            "bridge",
            { action: "edit", id: token.data.id, name: "foreign" },
            foreign.cookie,
          )
        ).status,
        404,
      );
      device = await agent("enroll", {
        token: token.data.token,
        name: "test device",
        platform: "linux",
      });
      assert.equal(device.status, 200);
      assert.equal(
        (
          await agent("enroll", {
            token: token.data.token,
            name: "again",
            platform: "linux",
          })
        ).status,
        401,
      );
      assert.equal(
        (await agent("poll", { paused: false, policy }, device.data.credential))
          .status,
        200,
      );
      assert.ok(
        !JSON.stringify((await req("bridge")).data).includes(
          device.data.credential,
        ),
      );
    },
  );
  const run = randomUUID(),
    task = randomUUID(),
    lease = randomUUID();
  await pool.query(
    "INSERT INTO runs(id,workspace_id,project_id,goal,status,max_steps) VALUES($1,$2,$3,'Bridge protocol fixture; no AI','running',20)",
    [run, w, p],
  );
  await pool.query(
    "INSERT INTO tasks(id,workspace_id,run_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Bridge fixture','No AI','running',$5,now()+interval '5 minutes')",
    [task, w, run, a, lease],
  );
  try {
    await t.test(
      "Bridge read travels through fenced outbound jobs and stores its receipt without a provider call",
      async () => {
        const before = Number(
          (await pool.query("SELECT count(*) n FROM model_calls")).rows[0].n,
        );
        const result = bridgeToolStep(
          task,
          lease,
          "bridge-read",
          "bridge_action",
          {
            device_id: device.data.id,
            action: "files.read",
            root: "docs",
            path: "hello.txt",
          },
        );
        let poll: any;
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 50));
          poll = await agent(
            "poll",
            { paused: false, policy },
            device.data.credential,
          );
          if (poll.data.job) break;
        }
        assert.ok(poll.data.job);
        const j = poll.data.job;
        assert.equal(j.project_id, p);
        assert.equal(
          (
            await agent(
              "authorize",
              { id: j.id, lease: randomUUID() },
              device.data.credential,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await agent(
              "authorize",
              { id: j.id, lease: j.lease },
              device.data.credential,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await agent(
              "complete",
              {
                id: j.id,
                lease: j.lease,
                result: {
                  ok: true,
                  content: "protocol fixture",
                  hash: "a".repeat(64),
                },
              },
              device.data.credential,
            )
          ).status,
          200,
        );
        assert.match((await result).result, /protocol fixture/);
        assert.equal(
          (
            await agent(
              "complete",
              { id: j.id, lease: j.lease, result: { ok: true } },
              device.data.credential,
            )
          ).status,
          409,
        );
        assert.equal(
          Number(
            (await pool.query("SELECT count(*) n FROM model_calls")).rows[0].n,
          ),
          before,
        );
      },
    );
    await t.test(
      "Uncertain local effects block further mutations until an explicit owner review without replay",
      async () => {
        const result = bridgeToolStep(
          task,
          lease,
          "bridge-uncertain",
          "bridge_action",
          {
            device_id: device.data.id,
            action: "files.read",
            root: "docs",
            path: "hello.txt",
          },
        );
        const settled = result.then(
          () => ({ ok: true }),
          (e) => ({ ok: false, error: e.message }),
        );
        let poll: any;
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 50));
          poll = await agent(
            "poll",
            { paused: false, policy },
            device.data.credential,
          );
          if (poll.data.job) break;
        }
        const j = poll.data.job;
        assert.ok(j);
        assert.equal(
          (
            await agent(
              "complete",
              {
                id: j.id,
                lease: j.lease,
                result: {
                  ok: false,
                  uncertain: true,
                  error: "protocol uncertainty fixture",
                },
              },
              device.data.credential,
            )
          ).status,
          200,
        );
        assert.equal((await settled).ok, false);
        await assert.rejects(
          bridgeToolStep(task, lease, "blocked-mutation", "bridge_action", {
            device_id: device.data.id,
            action: "files.write",
            root: "docs",
            path: "new.txt",
            content: "never execute",
          }),
        );
        const review = await req("bridge", {
          action: "review",
          id: token.data.id,
          job_id: j.id,
          note: "Local fixture state checked; no further effect.",
        });
        assert.equal(review.status, 200);
        const stored = (
          await pool.query(
            "SELECT status,result FROM bridge_jobs WHERE id=$1",
            [j.id],
          )
        ).rows[0];
        assert.equal(stored.status, "done");
        assert.equal(stored.result.executed_again, false);
      },
    );
    await t.test(
      "Bridge permission revisions invalidate exact approvals and revoke pending leased work",
      async () => {
        const { decisionConsent } =
          await import("../../src/server/decisions.ts");
        const { transaction } = await import("../../src/server/db.ts");
        await assert.rejects(
          transaction((c: any) =>
            decisionConsent(
              c,
              { id: task, workspace_id: w, run_id: run, agent_id: a },
              "bridge_action",
              {
                device_id: device.data.id,
                action: "files.write",
                root: "docs",
                path: "out.txt",
                content: "never execute",
              },
              task + ":blocked",
              {},
            ),
          ),
        );
        const changed = await req("bridge", {
          action: "edit",
          id: token.data.id,
          name: "Renamed",
          scope: { ...scope, capabilities: [] },
        });
        assert.equal(changed.status, 200);
        await assert.rejects(
          bridgeToolStep(task, lease, "after-revoke", "bridge_action", {
            device_id: device.data.id,
            action: "files.read",
            root: "docs",
            path: "hello.txt",
          }),
        );
        const r = await req("bridge", { action: "rotate", id: token.data.id });
        assert.equal(r.status, 200);
        assert.equal(
          (
            await agent(
              "poll",
              { paused: false, policy },
              device.data.credential,
            )
          ).status,
          401,
        );
        const d2 = await agent("enroll", {
          token: r.data.token,
          name: "same slot",
          platform: "linux",
        });
        assert.equal(d2.status, 200);
        assert.equal(d2.data.id, device.data.id);
        assert.equal(
          (await req("bridge", { action: "delete", id: token.data.id })).status,
          200,
        );
        assert.equal(
          (await agent("poll", { paused: false, policy }, d2.data.credential))
            .status,
          401,
        );
        assert.equal((await req("bridge")).data.tokens.length, 0);
        const previous = (
          await pool.query(
            "UPDATE bridge_jobs SET status='uncertain' WHERE task_id=$1 AND action='files.read' RETURNING id",
            [task],
          )
        ).rows[0];
        assert.equal(
          (
            await req("bridge", {
              action: "review",
              job_id: previous.id,
              note: "Device removed; local state checked and recorded.",
            })
          ).status,
          200,
        );
        assert.equal(
          Number(
            (
              await pool.query(
                "SELECT count(*) n FROM bridge_jobs WHERE task_id=$1",
                [task],
              )
            ).rows[0].n,
          ),
          2,
        );
      },
    );
  } finally {
    await pool.query(
      "UPDATE tasks SET status='canceled',lease_token=NULL WHERE id=$1",
      [task],
    );
    await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [run]);
  }
}
