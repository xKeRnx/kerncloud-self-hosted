import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { handle } from "../../src/server/api.ts";
import { csvCell } from "../../src/server/self-hosted-waitlist.ts";
export async function waitlistTests(t: any, { request, pool, admin }: any) {
  const path = "public/self-hosted-interest",
    email = "self-hosted@fixture.invalid";
  const post = (v: any) =>
    request(path, { email, locale: "de", consent: true, ...v });
  await t.test(
    "public waitlist requires consent, rejects unsupported input and never exposes membership",
    async () => {
      assert.equal((await post({ consent: false })).status, 400);
      assert.equal((await request(path)).status, 405);
      assert.equal((await post({ status: "qualified" })).status, 400);
      const first = await post({
        email: " Self-Hosted@fixture.invalid ",
        company: "=1+1",
        deployment: "server",
        use_case: "Internal support",
        team_size: "2-10",
      });
      assert.equal(first.status, 200, JSON.stringify(first.data));
      assert.deepEqual(first.data, { ok: true });
      const repeated = await post({ company: "Poisoned replacement" });
      assert.deepEqual(repeated.data, first.data);
      const rows = (
        await pool.query("SELECT * FROM self_hosted_interests WHERE email=$1", [
          email,
        ])
      ).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].company, "=1+1");
      assert.equal(rows[0].consent_version, "self-hosted-interest-v1");
      assert.ok(
        Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at) <=
          181 * 86400000,
      );
    },
  );
  await t.test(
    "honeypot avoids recording bots and email-based submission attempts are bounded",
    async () => {
      await post({
        email: "bot@fixture.invalid",
        website: "https://spam.invalid",
      });
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM self_hosted_interests WHERE email='bot@fixture.invalid'",
          )
        ).rows[0].n,
        0,
      );
      for (let i = 0; i < 3; i++)
        assert.equal(
          (await post({ email: "limited@fixture.invalid" })).status,
          200,
        );
      assert.equal(
        (await post({ email: "limited@fixture.invalid" })).status,
        429,
      );
    },
  );
  const signed = await request("auth/signup", {
    name: "Waitlist fixture",
    email: "waitlist-user@fixture.invalid",
    password: "waitlist-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(signed.status, 200);
  await t.test(
    "waitlist list, CSV and mutations are restricted to platform admins",
    async () => {
      const row = (
        await pool.query(
          "SELECT id,revision FROM self_hosted_interests WHERE email=$1",
          [email],
        )
      ).rows[0];
      assert.equal((await request("admin/self-hosted-interests")).status, 401);
      assert.equal(
        (await request("admin/self-hosted-interests", undefined, signed.cookie))
          .status,
        403,
      );
      assert.equal(
        (
          await request(
            "admin/self-hosted-interests",
            { action: "delete", ...row },
            signed.cookie,
          )
        ).status,
        403,
      );
      const csv = await handle(
        new NextRequest(
          "http://localhost:3100/api/admin/self-hosted-interests/export",
          { headers: { cookie: signed.cookie } },
        ),
        "admin/self-hosted-interests/export",
      );
      assert.equal(csv.status, 403);
    },
  );
  await t.test(
    "admin filtering, revisions, formula-safe CSV and permanent removal work",
    async () => {
      const list = await request(
        "admin/self-hosted-interests?q=self-hosted%40fixture.invalid",
        undefined,
        admin.cookie,
      );
      assert.equal(list.status, 200);
      assert.equal(list.data.total, 1);
      const row = list.data.items[0];
      assert.equal(
        (
          await request(
            "admin/self-hosted-interests",
            {
              action: "update",
              id: row.id,
              revision: row.revision,
              status: "qualified",
              note: "Wants own server",
            },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "admin/self-hosted-interests",
            {
              action: "update",
              id: row.id,
              revision: row.revision,
              status: "archived",
            },
            admin.cookie,
          )
        ).status,
        409,
      );
      const response = await handle(
        new NextRequest(
          "http://localhost:3100/api/admin/self-hosted-interests/export?q=self-hosted%40fixture.invalid",
          { headers: { cookie: admin.cookie } },
        ),
        "admin/self-hosted-interests/export",
      );
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Content-Type") ?? "", /text\/csv/);
      const text = await response.text();
      assert.ok(text.includes("'" + "=1+1"));
      assert.ok(text.includes("\r\n"));
      assert.ok(!text.includes("limited@fixture.invalid"));
      assert.ok(!text.includes("password"));
      assert.equal(
        csvCell("  =SUM(1)"),
        String.fromCharCode(34) + "'  =SUM(1)" + String.fromCharCode(34),
      );
      const updated = (
        await pool.query(
          "SELECT revision FROM self_hosted_interests WHERE id=$1",
          [row.id],
        )
      ).rows[0];
      assert.equal(
        (
          await request(
            "admin/self-hosted-interests",
            { action: "delete", id: row.id, revision: updated.revision },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM self_hosted_interests WHERE id=$1", [
            row.id,
          ])
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    "expired interest is hidden and a new explicit opt-in can renew it",
    async () => {
      await pool.query(
        "INSERT INTO self_hosted_interests(email,locale,consent_version,expires_at) VALUES('expired-interest@fixture.invalid','de','old',now()-interval '1 day')",
      );
      assert.equal(
        (
          await request(
            "admin/self-hosted-interests?q=expired-interest",
            undefined,
            admin.cookie,
          )
        ).data.total,
        0,
      );
      assert.equal(
        (await post({ email: "expired-interest@fixture.invalid" })).status,
        200,
      );
      assert.equal(
        (
          await request(
            "admin/self-hosted-interests?q=expired-interest",
            undefined,
            admin.cookie,
          )
        ).data.total,
        1,
      );
    },
  );
  await t.test(
    "account privacy export includes own interest and account deletion removes it without email",
    async () => {
      const address = "waitlist-user@fixture.invalid";
      await post({ email: address });
      const data = await request("privacy/export", undefined, signed.cookie);
      assert.equal(data.status, 200);
      assert.deepEqual(
        data.data.selfHostedInterests.map((r: any) => r.email),
        [address],
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM mail_outbox WHERE recipient=$1", [
            address,
          ])
        ).rowCount,
        0,
      );
      const deletion = await request(
        "privacy/delete",
        {
          password: "waitlist-fixture-password",
          confirmation: "DELETE ACCOUNT",
        },
        signed.cookie,
      );
      assert.equal(deletion.status, 200, JSON.stringify(deletion.data));
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM self_hosted_interests WHERE email=$1",
            [address],
          )
        ).rowCount,
        0,
      );
    },
  );
}
