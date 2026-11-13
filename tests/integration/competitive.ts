import { NextRequest } from "next/server";
import { handle } from "../../src/server/api.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transaction } from "../../src/server/db.ts";
import { encrypt } from "../../src/server/security.ts";
import { createRun } from "../../src/server/store.ts";
import { officeArtifact } from "../../src/server/office.ts";
import { artifactResponse, runArchive } from "../../src/server/artifacts.ts";
import { unzipSync, strFromU8 } from "fflate";
import { tickQuality } from "../../src/server/quality.ts";
import { decisionConsent, createDecision } from "../../src/server/decisions.ts";
import { integrationGalleryTests } from "./integration-gallery.ts";
export async function competitiveTests(t: any, { request, pool, admin }: any) {
  const owner = await request("auth/signup", {
    name: "Suite Owner",
    email: "suite-owner@test.local",
    password: "suite-owner-password",
    privacyAccepted: true,
  });
  const member = await request("auth/signup", {
    name: "Suite Member",
    email: "suite-member@test.local",
    password: "suite-member-password",
    privacyAccepted: true,
  });
  assert.equal(owner.status, 200);
  assert.equal(member.status, 200);
  const a = (await request("state", undefined, owner.cookie)).data,
    b = (await request("state", undefined, member.cookie)).data,
    ws = a.workspace.id,
    agent = a.agents[0].id,
    shared = member.cookie + "; kc_workspace=" + ws;
  await pool.query(
    "UPDATE accounts SET plan_id='business',subscription_status='local_test' WHERE id=$1",
    [a.workspace.account_id],
  );
  let invite = "";
  await t.test(
    "Invites are email-bound, expiring, hashed, single-use, and viewers cannot edit or approve",
    async () => {
      let r = await request(
        "team",
        { action: "invite", email: b.user.email, role: "viewer" },
        owner.cookie,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      invite = new URL(r.data.invite_url).searchParams.get("invite")!;
      assert.equal(
        (await request("team/accept", { token: invite }, owner.cookie)).status,
        403,
      );
      assert.equal(
        (await request("team/accept", { token: invite }, member.cookie)).status,
        200,
      );
      assert.equal(
        (await request("team/accept", { token: invite }, member.cookie)).status,
        403,
      );
      const state = await request("state", undefined, shared);
      assert.equal(state.status, 200, JSON.stringify(state.data));
      assert.equal(state.data.workspace.membership_role, "viewer");
      assert.deepEqual(state.data.ledger, []);
      assert.equal(
        (await request("chat", { content: "not allowed" }, shared)).status,
        403,
      );
      assert.equal((await request("billing/portal", {}, shared)).status, 403);
      assert.equal(
        (
          await request(
            "team",
            { action: "invite", email: "no@test.local", role: "admin" },
            shared,
          )
        ).status,
        403,
      );
    },
  );
  await t.test(
    "Multipart uploads enforce viewer/editor roles before parsing the request",
    async () => {
      const upload = async () => {
        const form = new FormData();
        form.append(
          "files",
          new File(["Editor fixture upload"], "role-fixture.txt", {
            type: "text/plain",
          }),
        );
        return handle(
          new NextRequest("http://localhost:3100/api/attachments/upload", {
            method: "POST",
            headers: { cookie: shared },
            body: form,
          }),
          "attachments/upload",
        );
      };
      assert.equal((await upload()).status, 403);
      await request(
        "team",
        { action: "role", id: b.user.id, role: "editor" },
        owner.cookie,
      );
      const accepted = await upload();
      assert.equal(accepted.status, 200, await accepted.text());
      await request(
        "team",
        { action: "role", id: b.user.id, role: "viewer" },
        owner.cookie,
      );
    },
  );
  await t.test(
    "Search and excerpts are workspace scoped, with immutable source hashes and no model calls",
    async () => {
      const ids = [];
      for (const w of [ws, b.workspace.id])
        ids.push(
          (
            await pool.query(
              "INSERT INTO chat_messages(workspace_id,author,content) VALUES($1,'Fixture','UniqueNeko source line one\nline two') RETURNING id",
              [w],
            )
          ).rows[0].id,
        );
      const r = await request(
        "knowledge/search",
        { query: "UniqueNeko" },
        shared,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.results.length, 1);
      assert.equal(r.data.model_calls, 0);
      assert.ok(
        r.data.results.every(
          (v: any) => v.preview.length <= 600 && !v.preview.includes("<b>"),
        ),
      );
      const read = await request(
        "knowledge/read",
        { kind: "conversation", id: String(ids[0]), lines: 1 },
        shared,
      );
      assert.equal(read.status, 200);
      assert.match(read.data.sha256, /^[a-f0-9]{64}$/);
      assert.ok(!read.data.content.includes("line two"));
      assert.equal(
        (
          await request(
            "knowledge/read",
            { kind: "conversation", id: String(ids[1]) },
            shared,
          )
        ).status,
        404,
      );
    },
  );
  await t.test(
    "Briefings deduplicate, respect viewer rights, and read state is per human user",
    async () => {
      assert.equal(
        (await request("briefings/refresh", {}, shared)).status,
        403,
      );
      const r = await request("briefings/refresh", {}, owner.cookie);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const id = r.data.notifications[0].id;
      await request("briefings/refresh", {}, owner.cookie);
      assert.equal(
        (await request("briefings", undefined, owner.cookie)).data.notifications
          .length,
        1,
      );
      await request("briefings/read", { id }, shared);
      assert.ok(
        (await request("briefings", undefined, shared)).data.notifications[0]
          .read_at,
      );
      assert.equal(
        (await request("briefings", undefined, owner.cookie)).data
          .notifications[0].read_at,
        null,
      );
    },
  );
  await t.test(
    "Model-off state blocks a metered quality test; OAuth setup does not imply a connected account",
    async () => {
      const r = await request(
        "suite/quality/start",
        {
          action: "start",
          agent_id: agent,
          model_id: randomUUID(),
          token_limit: 10000,
          credit_limit: 100,
        },
        owner.cookie,
      );
      assert.notEqual(r.status, 200);
      assert.equal(
        (
          await request(
            "suite/apps/connect",
            { provider: "google", name: "Fixture" },
            owner.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (await request("admin/work-apps", undefined, member.cookie)).status,
        403,
      );
      const apps = await request("suite/apps", undefined, shared);
      assert.equal(apps.status, 200);
      assert.deepEqual(apps.data.connections, []);
    },
  );
  const model = randomUUID();
  await pool.query(
    "INSERT INTO model_offerings(id,workspace_id,name,provider_name,endpoint,model,secret,active,monitor_enabled) VALUES($1,$2,'Protocol fixture only','Fixture','http://127.0.0.1:9/v1','suite-fixture',$3,true,false)",
    [model, ws, encrypt("local-protocol-fixture-secret")],
  );
  await t.test(
    "Quality cases allocate a fixed aggregate budget and concurrent ticks cannot start duplicate runs",
    async () => {
      const r = await request(
        "suite/quality/start",
        {
          action: "start",
          agent_id: agent,
          model_id: model,
          token_limit: 10000,
          credit_limit: 100,
        },
        owner.cookie,
      );
      assert.equal(r.status, 200, JSON.stringify(r.data));
      await Promise.all([tickQuality(), tickQuality()]);
      const qs = (
        await pool.query(
          "SELECT q.*,r.token_limit,r.credit_limit FROM quality_cases q JOIN quality_evaluations e ON e.id=q.evaluation_id LEFT JOIN runs r ON r.id=q.run_id WHERE e.workspace_id=$1 ORDER BY q.position",
          [ws],
        )
      ).rows;
      assert.equal(qs.filter((q: any) => q.run_id).length, 1);
      assert.equal(qs[0].token_limit, 5000);
      assert.equal(qs[0].credit_limit, 50);
      const tasks = (
        await pool.query("SELECT * FROM tasks WHERE run_id=$1", [qs[0].run_id])
      ).rows;
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].model_id, model);
      await request(
        "suite/quality/start",
        { action: "cancel", id: qs[0].evaluation_id },
        owner.cookie,
      );
      await tickQuality();
      assert.equal(
        (
          await pool.query("SELECT status FROM runs WHERE id=$1", [
            qs[0].run_id,
          ])
        ).rows[0].status,
        "canceled",
      );
    },
  );
  await t.test(
    "Office files download as real binary ZIP packages, preview safely, archive correctly and reject other tenants",
    async () => {
      const w = (
        await pool.query("SELECT * FROM workspace_context WHERE id=$1", [ws])
      ).rows[0];
      const run = await createRun(
        w,
        "Office protocol fixture",
        agent,
        [],
        false,
        [agent],
        "",
        { tokenLimit: 1000, creditLimit: 0, quality: undefined },
      );
      const task = (
        await pool.query("SELECT * FROM tasks WHERE run_id=$1", [run.id])
      ).rows[0];
      for (const ext of ["docx", "xlsx", "pptx"]) {
        const f = await transaction((c) =>
          officeArtifact(c, task, {
            name: "editable." + ext,
            title: "Fixture & report",
            paragraphs: ["Test body"],
            sheets: [
              {
                name: "Budget",
                rows: [
                  ["Label", "Value"],
                  ["Total", 42],
                ],
              },
            ],
            slides: [{ title: "One", bullets: ["Hello"] }],
          }),
        );
        const response = await artifactResponse(ws, f.artifact_id, "download"),
          data = new Uint8Array(await response.arrayBuffer());
        assert.ok(unzipSync(data)["[Content_Types].xml"]);
        const preview = await artifactResponse(ws, f.artifact_id, "preview");
        assert.match(
          preview.headers.get("content-security-policy")!,
          /sandbox/,
        );
        assert.ok((await preview.text()).includes("Fixture") || ext !== "docx");
        await assert.rejects(() =>
          artifactResponse(b.workspace.id, f.artifact_id, "download"),
        );
      }
      const archive = unzipSync(
        new Uint8Array(await (await runArchive(ws, run.id)).arrayBuffer()),
      );
      assert.ok(unzipSync(archive["editable.xlsx"])["xl/workbook.xml"]);
      await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [
        run.id,
      ]);
    },
  );
  await t.test(
    "App writes require exact approval and revoking a connection revision invalidates approval",
    async () => {
      const rid = randomUUID(),
        tid = randomUUID(),
        conn = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'App fixture',10)",
        [rid, ws],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions) VALUES($1,$2,$3,$4,'Fixture','Fixture')",
        [tid, rid, ws, agent],
      );
      await pool.query(
        "INSERT INTO work_app_connections(id,workspace_id,provider,name,credential,agent_ids,write_enabled) VALUES($1,$2,'google','Fixture',$3,$4,true)",
        [
          conn,
          ws,
          encrypt('{"access_token":"fixture"}'),
          JSON.stringify([agent]),
        ],
      );
      const task = { id: tid, run_id: rid, workspace_id: ws, agent_id: agent },
        args = {
          connection_id: conn,
          operation: "mail_send",
          input: {
            to: "fixture@example.test",
            subject: "Test",
            text: "Never actually sent",
          },
        };
      await assert.rejects(() =>
        transaction((c) =>
          decisionConsent(c, task, "app_action", args, "op", {}),
        ),
      );
      await transaction((c) =>
        createDecision(
          c,
          task,
          {
            kind: "approval",
            question: "Send fixture?",
            action: "Send fixture",
            proposal: { tool: "app_action", args },
          },
          "fixture",
        ),
      );
      await pool.query(
        "UPDATE decisions SET status='approved' WHERE task_id=$1",
        [tid],
      );
      await transaction((c) =>
        decisionConsent(c, task, "app_action", args, "op", {}),
      );
      await assert.rejects(() =>
        transaction((c) =>
          decisionConsent(
            c,
            task,
            "app_action",
            { ...args, input: { ...args.input, to: "different@example.test" } },
            "op2",
            {},
          ),
        ),
      );
      await pool.query(
        "UPDATE work_app_connections SET revision=revision+1 WHERE id=$1",
        [conn],
      );
      await assert.rejects(() =>
        transaction((c) =>
          decisionConsent(c, task, "app_action", args, "op", {}),
        ),
      );
      await pool.query("DELETE FROM work_app_connections WHERE id=$1", [conn]);
      await pool.query("UPDATE runs SET status='canceled' WHERE id=$1", [rid]);
    },
  );
  await t.test(
    "Work-app OAuth fixture binds PKCE/state to the originating session and stores tokens encrypted",
    async () => {
      const config = await request(
        "admin/work-apps",
        {
          publicUrl: "http://localhost:3100",
          providers: {
            google: {
              enabled: true,
              clientId: "oauth-protocol-fixture",
              secret: "oauth-protocol-fixture-secret",
            },
          },
        },
        admin.cookie,
      );
      assert.equal(config.status, 200, JSON.stringify(config.data));
      const start = await request(
        "suite/apps/connect",
        { provider: "google", name: "Protocol fixture", write: false },
        owner.cookie,
      );
      assert.equal(start.status, 200, JSON.stringify(start.data));
      const target = new URL(start.data.url);
      assert.ok(target.searchParams.get("code_challenge"));
      const st = target.searchParams.get("state")!;
      const callback = async (cookie: string) =>
        handle(
          new NextRequest(
            "http://localhost:3100/api/suite/apps/callback/google?state=" +
              st +
              "&code=fixture-code",
            { headers: { cookie } },
          ),
          "suite/apps/callback/google",
        );
      assert.equal((await callback(member.cookie)).status, 403);
      const original = globalThis.fetch;
      let exchanged = 0;
      globalThis.fetch = async (input: any, init: any) => {
        if (String(input) === "https://oauth2.googleapis.com/token") {
          exchanged++;
          assert.ok(String(init.body).includes("code_verifier="));
          return new Response(
            JSON.stringify({
              access_token: "oauth-fixture-access-value",
              refresh_token: "oauth-fixture-refresh-value",
              expires_in: 3600,
              scope: "https://www.googleapis.com/auth/drive.readonly",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return original(input, init);
      };
      try {
        assert.equal((await callback(owner.cookie)).status, 303);
        assert.equal((await callback(owner.cookie)).status, 403);
        assert.equal(exchanged, 1);
        const row = (
          await pool.query(
            "SELECT * FROM work_app_connections WHERE workspace_id=$1",
            [ws],
          )
        ).rows[0];
        assert.ok(!row.credential.includes("oauth-fixture-access-value"));
        assert.deepEqual(row.agent_ids, []);
        assert.equal(row.write_enabled, false);
        const list = (await request("suite/apps", undefined, owner.cookie))
          .data;
        assert.ok(!JSON.stringify(list).includes("oauth-fixture-access-value"));
        await request(
          "suite/apps",
          { id: row.id, action: "disconnect" },
          owner.cookie,
        );
      } finally {
        globalThis.fetch = original;
        await pool.query("DELETE FROM settings WHERE id='work_apps'");
      }
    },
  );
  await integrationGalleryTests(t, {
    request,
    pool,
    owner,
    member,
    ws,
    agent,
    foreignWorkspace: b.workspace.id,
  });
  await t.test(
    "Revoking membership immediately removes shared workspace access",
    async () => {
      await request("team", { action: "remove", id: b.user.id }, owner.cookie);
      assert.equal((await request("state", undefined, shared)).status, 403);
    },
  );
}
