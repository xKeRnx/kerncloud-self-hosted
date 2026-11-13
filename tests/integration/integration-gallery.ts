import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appToolStep } from "../../src/server/work-apps.ts";

export async function integrationGalleryTests(
  t: any,
  { request, pool, owner, member, ws, agent, foreignWorkspace }: any,
) {
  const project = (
    await pool.query(
      "SELECT id FROM workspace_projects WHERE workspace_id=$1 ORDER BY created_at LIMIT 1",
      [ws],
    )
  ).rows[0].id;
  const foreign = (
    await pool.query(
      "SELECT id FROM workspace_projects WHERE workspace_id=$1 LIMIT 1",
      [foreignWorkspace],
    )
  ).rows[0].id;
  let connection = "";
  const fixture = "discord-protocol-fixture-secret";
  await t.test(
    "integration gallery encrypts tokens, denies foreign projects, retains grants on token replacement and never returns secrets",
    async () => {
      const input = {
        service_id: "discord",
        name: "Discord protocol fixture",
        token: fixture,
        project_ids: [project],
      };
      assert.equal(
        (
          await request(
            "suite/apps/token",
            input,
            member.cookie + "; kc_workspace=" + ws,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "suite/apps/token",
            { ...input, project_ids: [foreign] },
            owner.cookie,
          )
        ).status,
        400,
      );
      const saved = await request("suite/apps/token", input, owner.cookie);
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      connection = saved.data.id;
      const row = (
        await pool.query("SELECT * FROM work_app_connections WHERE id=$1", [
          connection,
        ])
      ).rows[0];
      assert.ok(!row.credential.includes(fixture));
      assert.deepEqual(row.agent_ids, []);
      assert.equal(row.write_enabled, false);
      assert.deepEqual(row.project_ids, [project]);
      const list = await request("suite/apps", undefined, owner.cookie);
      assert.equal(list.status, 200);
      assert.ok(list.data.catalog.some((s: any) => s.id === "discord"));
      assert.ok(!JSON.stringify(list.data).includes(fixture));
      assert.equal(
        (
          await request(
            "suite/apps",
            {
              id: connection,
              action: "configure",
              agent_ids: [agent],
              project_ids: [foreign],
            },
            owner.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "suite/apps",
            {
              id: connection,
              action: "configure",
              agent_ids: [agent],
              project_ids: [project],
              write_enabled: true,
            },
            owner.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "suite/apps/token",
            {
              ...input,
              id: connection,
              token: "rotated-protocol-fixture-secret",
            },
            owner.cookie,
          )
        ).status,
        200,
      );
      const rotated = (
        await pool.query("SELECT * FROM work_app_connections WHERE id=$1", [
          connection,
        ])
      ).rows[0];
      assert.deepEqual(rotated.agent_ids, [agent]);
      assert.deepEqual(rotated.project_ids, [project]);
      assert.equal(rotated.write_enabled, true);
      assert.ok(rotated.revision > row.revision);
    },
  );
  await t.test(
    "connection health is scoped, throttled and detects JSON-level provider failures without leaking upstream bodies",
    async () => {
      const original = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (url: any, init: any) => {
        calls++;
        assert.equal(String(url), "https://discord.com/api/v10/users/@me");
        assert.equal(
          init.headers.Authorization,
          "Bot rotated-protocol-fixture-secret",
        );
        assert.equal(init.redirect, "error");
        return new Response(
          JSON.stringify({ id: "protocol-fixture-bot", username: "Fixture" }),
        );
      };
      try {
        assert.equal(
          (
            await request(
              "suite/apps/check",
              { id: connection },
              member.cookie + "; kc_workspace=" + ws,
            )
          ).status,
          403,
        );
        const check = await request(
          "suite/apps/check",
          { id: connection },
          owner.cookie,
        );
        assert.equal(check.status, 200, JSON.stringify(check.data));
        assert.equal(check.data.health, "ok");
        assert.equal(calls, 1);
        assert.equal(
          (await request("suite/apps/check", { id: connection }, owner.cookie))
            .status,
          429,
        );
        assert.equal(calls, 1);
        const failed = await request(
          "suite/apps/token",
          {
            service_id: "slack",
            name: "Slack protocol fixture",
            token: "slack-protocol-fixture-secret",
          },
          owner.cookie,
        );
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: "invalid_auth",
              secret: "must-not-store-upstream-fixture",
            }),
          );
        const result = await request(
          "suite/apps/check",
          { id: failed.data.id },
          owner.cookie,
        );
        assert.equal(result.status, 200);
        assert.equal(result.data.health, "error");
        assert.ok(
          !JSON.stringify(result.data).includes(
            "must-not-store-upstream-fixture",
          ),
        );
        await request(
          "suite/apps",
          { id: failed.data.id, action: "disconnect" },
          owner.cookie,
        );
      } finally {
        globalThis.fetch = original;
      }
    },
  );
  await t.test(
    "agent integration execution enforces project grants and exact write approval before provider calls",
    async () => {
      const rid = randomUUID(),
        tid = randomUUID(),
        lease = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,workspace_id,project_id,goal,max_steps) VALUES($1,$2,$3,'Integration protocol fixture',10)",
        [rid, ws, project],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions,status,lease_token,lease_until) VALUES($1,$2,$3,$4,'Integration fixture','Protocol fixture only','running',$5,now()+interval '5 minutes')",
        [tid, rid, ws, agent, lease],
      );
      const original = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = async (url: any) => {
        calls++;
        assert.equal(String(url), "https://discord.com/api/v10/users/@me");
        return new Response(JSON.stringify({ id: "fixture-bot" }));
      };
      try {
        await request(
          "suite/apps",
          {
            id: connection,
            action: "configure",
            agent_ids: [agent],
            project_ids: [],
            write_enabled: true,
          },
          owner.cookie,
        );
        await assert.rejects(() =>
          appToolStep(tid, lease, "blocked-project", {
            connection_id: connection,
            operation: "service_read",
            input: { action: "identity" },
          }),
        );
        assert.equal(calls, 0);
        await request(
          "suite/apps",
          {
            id: connection,
            action: "configure",
            agent_ids: [agent],
            project_ids: [project],
            write_enabled: true,
          },
          owner.cookie,
        );
        const result = await appToolStep(tid, lease, "read-fixture", {
          connection_id: connection,
          operation: "service_read",
          input: { action: "identity" },
        });
        assert.equal(calls, 1);
        assert.match(result.result, /fixture-bot/);
        assert.ok(!result.result.includes("secret"));
        await assert.rejects(() =>
          appToolStep(tid, lease, "write-without-consent", {
            connection_id: connection,
            operation: "service_write",
            input: {
              action: "send",
              channel_id: "123",
              text: "Protocol fixture",
            },
          }),
        );
        assert.equal(calls, 1);
        await request(
          "suite/apps",
          { id: connection, action: "disconnect" },
          owner.cookie,
        );
        await assert.rejects(() =>
          appToolStep(tid, lease, "revoked-fixture", {
            connection_id: connection,
            operation: "service_read",
            input: { action: "identity" },
          }),
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = original;
        await pool.query("DELETE FROM runs WHERE id=$1", [rid]);
        await pool.query("DELETE FROM work_app_connections WHERE id=$1", [
          connection,
        ]);
      }
    },
  );
}
