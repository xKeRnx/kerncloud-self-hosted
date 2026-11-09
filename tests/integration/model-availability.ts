import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function modelAvailabilityTests(
  t: any,
  { request, pool, fixtureUrl, foreignCookie }: any,
) {
  await t.test(
    "Disabled model blocks chat and task creation with a useful translated error, without charging or bypassing tenant scope",
    async () => {
      const user = await request("auth/signup", {
        email: "disabled-model@test.local",
        name: "Disabled model fixture",
        password: "disabled-model-fixture-password",
        privacyAccepted: true,
      });
      assert.equal(user.status, 200);
      const cookie = user.cookie + "; kc_locale=en";
      const state = (await request("state", undefined, cookie)).data;
      const ws = state.workspace.id,
        agent = state.agents[0].id;
      const model = {
        name: "Disabled fixture",
        provider_name: "Local protocol fixture",
        endpoint: `${fixtureUrl}/v1`,
        model: "fixture-model",
        active: true,
        key: "disabled-model-fixture-secret",
        monitor_enabled: false,
      };
      const created = await request("models", model, cookie);
      assert.equal(created.status, 200);
      const mid = created.data.id;
      assert.equal(
        (await request("default-model", { modelId: mid }, cookie)).status,
        200,
      );
      assert.equal(
        (await request("models", { ...model, id: mid, active: false }, cookie))
          .status,
        200,
      );

      const counts = async () =>
        (
          await pool.query(
            `SELECT
      (SELECT count(*)::int FROM runs WHERE workspace_id=$1) runs,
      (SELECT count(*)::int FROM tasks WHERE workspace_id=$1) tasks,
      (SELECT count(*)::int FROM model_calls WHERE workspace_id=$1) calls,
      (SELECT count(*)::int FROM chat_messages WHERE workspace_id=$1) chat,
      (SELECT credits FROM workspace_context WHERE id=$1) credits`,
            [ws],
          )
        ).rows[0];
      const before = await counts();
      for (const [route, body] of [
        ["chat", { message: "No model must be called", agentIds: [agent] }],
        ["runs", { goal: "No model must be called", agentId: agent }],
      ] as const) {
        const result = await request(route, body, cookie);
        assert.equal(result.status, 409);
        assert.match(result.data.error, /selected AI model is disabled/);
        assert.doesNotMatch(result.data.error, /permission/);
      }
      assert.deepEqual(await counts(), before);

      await pool.query("UPDATE agents SET model_id=$2 WHERE id=$1", [
        agent,
        mid,
      ]);
      await pool.query(
        "UPDATE workspaces SET default_model_id=NULL WHERE id=$1",
        [ws],
      );
      const perAgent = await request(
        "chat",
        { message: "Disabled agent model", agentIds: [agent] },
        cookie,
      );
      assert.equal(perAgent.status, 409);
      assert.match(perAgent.data.error, /selected AI model is disabled/);
      await pool.query(
        "UPDATE agents SET model_id=NULL WHERE workspace_id=$1",
        [ws],
      );
      const none = await request(
        "chat",
        { message: "No active BYOK model", agentIds: [agent] },
        cookie,
      );
      assert.equal(none.status, 409);
      assert.match(none.data.error, /No active AI model is available/);
      assert.deepEqual(await counts(), before);

      const foreign = await request(
        "default-model",
        { modelId: mid },
        foreignCookie,
      );
      assert.equal(foreign.status, 403);
      assert.doesNotMatch(foreign.data.error, /deaktiviert|disabled/);

      const info = await request(
        "chat",
        { message: "Save information only", informationOnly: true },
        cookie,
      );
      assert.equal(info.status, 200);
      assert.deepEqual(await counts(), { ...before, chat: before.chat + 1 });

      const run = randomUUID(),
        task = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,workspace_id,goal,status,max_steps) VALUES($1,$2,'Disabled model waiting fixture','input_required',20)",
        [run, ws],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,model_id) VALUES($1,$2,$3,$4,'Waiting fixture','Fixture','input_required',$5)",
        [task, run, ws, agent, mid],
      );
      const waitingBefore = await counts();
      const resumed = await request(
        "chat",
        { message: "Answer to a waiting task", runId: run, agentIds: [agent] },
        cookie,
      );
      assert.equal(resumed.status, 409);
      assert.match(resumed.data.error, /selected AI model is disabled/);
      assert.equal(
        (await pool.query("SELECT status FROM tasks WHERE id=$1", [task]))
          .rows[0].status,
        "input_required",
      );
      assert.deepEqual(await counts(), waitingBefore);

      const translated = await request(
        "chat",
        { message: "Antwort", runId: run, agentIds: [agent] },
        user.cookie + "; kc_locale=de",
      );
      assert.equal(translated.status, 409);
      assert.match(translated.data.error, /KI-Modell ist deaktiviert/);

      assert.equal(
        (await request("models", { ...model, id: mid, active: true }, cookie))
          .status,
        200,
      );
      const { transaction } = await import("../../src/server/db.ts");
      const { providerFor } = await import("../../src/server/store.ts");
      const selected = await transaction((c) => providerFor(c, ws, mid));
      assert.equal(selected.provider.id, mid);
      assert.equal((await counts()).calls, 0);
      await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [run]);
      await pool.query("UPDATE tasks SET status='canceled' WHERE id=$1", [
        task,
      ]);
    },
  );
}
