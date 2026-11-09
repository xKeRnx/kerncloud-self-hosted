import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { NextRequest } from "next/server";
export async function customerManagementTests(
  t: any,
  { request, pool, handle, admin }: any,
) {
  assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"));
  const { hashToken, encrypt } = await import("../../src/server/security.ts");
  const proof = { password: "integration-admin-password", code: "" };
  const signed = await request("auth/signup", {
    name: "Managed customer fixture",
    email: "managed-customer@test.local",
    password: "managed-initial-password",
    privacyAccepted: true,
  });
  assert.equal(signed.status, 200);
  let cookie = signed.cookie;
  let state = (await request("state", undefined, cookie)).data;
  const user = state.user,
    account = state.workspace.account_id;
  const mutate = (action: string, extra: any = {}, override: any = {}) =>
    request(
      "admin/customers/" + user.id,
      {
        action,
        reason: "Local customer management fixture",
        proof,
        ...extra,
        ...override,
      },
      admin.cookie,
    );
  const raw = async (
    path: string,
    cookieValue = admin.cookie,
    body?: any,
    method = body === undefined ? "GET" : "POST",
  ) =>
    handle(
      new NextRequest("http://localhost:3100/api/" + path, {
        method,
        headers: {
          cookie: cookieValue,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      path.split("?")[0],
    );
  await t.test(
    "Kundenverwaltung ist adminpflichtig, suchbar und liefert keine Passwort- oder 2FA-Geheimnisse",
    async () => {
      assert.equal(
        (await request("admin/customers", undefined, cookie)).status,
        403,
      );
      const list = await raw(
        "admin/customers?q=managed-customer&status=active&page=1",
      );
      assert.equal(list.status, 200);
      const data = await list.json();
      assert.equal(data.users.length, 1);
      assert.equal(data.users[0].id, user.id);
      assert.match(list.headers.get("cache-control") ?? "", /no-store/);
      const detail = await request(
        "admin/customers/" + user.id,
        undefined,
        admin.cookie,
      );
      assert.equal(detail.status, 200);
      assert.ok(!JSON.stringify(detail.data).includes("password_hash"));
      assert.ok(!JSON.stringify(detail.data).includes("totp_secret"));
      assert.equal(
        (
          await mutate(
            "password",
            { newPassword: "fixture-not-applied", confirmEmail: user.email },
            { proof: { password: "invalid-admin-password" } },
          )
        ).status,
        401,
      );
    },
  );
  await t.test(
    "Einladungen verlangen Kundenaktivierung; Reset-Token sind gehasht, einmalig und ohne automatische Anmeldung",
    async () => {
      const invitation = await request(
        "admin/customers",
        {
          name: "Invited customer fixture",
          email: "invited-customer@test.local",
          send: false,
          reason: "Invitation protocol fixture",
          proof,
        },
        admin.cookie,
      );
      assert.equal(invitation.status, 200, invitation.data.error);
      const token = new URL(invitation.data.url).hash.slice(1);
      assert.equal(token.length, 64);
      assert.ok(!new URL(invitation.data.url).search);
      const row = (
        await pool.query("SELECT * FROM password_resets WHERE user_id=$1", [
          invitation.data.id,
        ])
      ).rows[0];
      assert.equal(row.id, hashToken(token));
      assert.notEqual(row.id, token);
      assert.equal(
        (
          await request("auth/login", {
            email: "invited-customer@test.local",
            password: "invited-customer-password",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("auth/password-reset", {
            token,
            password: "invited-customer-password",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("auth/password-reset", {
            token,
            password: "invited-customer-password",
            privacyAccepted: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("auth/password-reset", {
            token,
            password: "another-customer-password",
            privacyAccepted: true,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("auth/login", {
            email: "invited-customer@test.local",
            password: "invited-customer-password",
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "Direkt gesetzte Passwörter widerrufen alte Sitzungen und erzwingen einen neuen Kundenpasswortwechsel",
    async () => {
      assert.equal(
        (
          await mutate("password", {
            newPassword: "temporary-fixture-password",
            requireChange: true,
            confirmEmail: user.email,
          })
        ).status,
        200,
      );
      assert.equal((await request("state", undefined, cookie)).status, 401);
      const login = await request("auth/login", {
        email: user.email,
        password: "temporary-fixture-password",
      });
      assert.equal(login.status, 200);
      cookie = login.cookie;
      const restricted = await request("state", undefined, cookie);
      assert.equal(restricted.data.passwordChangeRequired, true);
      assert.equal(restricted.data.workspace, undefined);
      assert.equal((await request("agents", {}, cookie)).status, 428);
      assert.equal((await raw("attachments/upload", cookie, {})).status, 428);
      assert.equal(
        (
          await request(
            "profile/password",
            {
              current: "temporary-fixture-password",
              password: "temporary-fixture-password",
            },
            cookie,
          )
        ).status,
        400,
      );
      const changed = await request(
        "profile/password",
        {
          current: "temporary-fixture-password",
          password: "managed-final-password",
        },
        cookie,
      );
      assert.equal(changed.status, 200);
      cookie = changed.cookie;
      state = (await request("state", undefined, cookie)).data;
      assert.equal(state.user.password_change_required, false);
    },
  );
  await t.test(
    "Geschenke buchen genau einmal 0 EUR ohne Rechnung; Guthaben und Monatskontingent bleiben getrennt",
    async () => {
      await pool.query(
        "INSERT INTO account_step_usage(account_id,period,used) VALUES($1,to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),7) ON CONFLICT(account_id,period) DO UPDATE SET used=7",
        [account],
      );
      await pool.query("UPDATE accounts SET runtime_debt=60 WHERE id=$1", [
        account,
      ]);
      const id = randomUUID(),
        payload = {
          id,
          kind: "gift",
          planId: "pro",
          until: new Date(Date.now() + 86400000).toISOString(),
          credits: 5000,
          minutes: 5,
          receipt: false,
          customerMessage: "Complimentary fixture benefit",
        };
      assert.equal((await mutate("grant", payload)).status, 200);
      assert.equal((await mutate("grant", payload)).status, 200);
      assert.equal(
        (await mutate("grant", { ...payload, credits: 6000 })).status,
        409,
      );
      const a = (
        await pool.query("SELECT * FROM accounts WHERE id=$1", [account])
      ).rows[0];
      const monthlyCredits = (
        await pool.query("SELECT credits FROM plans WHERE id='pro'")
      ).rows[0].credits;
      assert.equal(a.credits, 5000 + monthlyCredits);
      assert.equal(a.runtime_purchased, 240);
      assert.equal(a.runtime_debt, 0);
      assert.equal(a.access_source, "gift");
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM account_grants WHERE account_id=$1",
            [account],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM invoices WHERE account_id=$1",
            [account],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT used FROM account_step_usage WHERE account_id=$1",
            [account],
          )
        ).rows[0].used,
        7,
      );
      const benefits = await request("account/benefits", undefined, cookie);
      assert.equal(benefits.status, 200);
      assert.equal(benefits.data.grants[0].amount_cents, 0);
      assert.ok(
        !JSON.stringify(benefits.data).includes(
          "Local customer management fixture",
        ),
      );
      assert.equal(
        (await raw("account/benefits/" + id + "/receipt", cookie)).status,
        404,
      );
      assert.equal(
        (
          await mutate("grant", {
            id: randomUUID(),
            kind: "adjustment",
            credits: -6000 - monthlyCredits,
            minutes: 0,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "Optionale Geschenkbelege sind sicher formatiert, kontogebunden und getrennt von Steuerrechnungen",
    async () => {
      const id = randomUUID();
      assert.equal(
        (
          await mutate("grant", {
            id,
            kind: "goodwill",
            credits: 1,
            minutes: 0,
            receipt: true,
            customerMessage: "<script>not executable</script>",
          })
        ).status,
        200,
      );
      const receipt = await raw("account/benefits/" + id + "/receipt", cookie);
      assert.equal(receipt.status, 200);
      const html = await receipt.text();
      assert.match(html, /0,00 EUR/);
      assert.match(html, /keine Umsatzsteuerrechnung/);
      assert.ok(!html.includes("<script>"));
      assert.match(
        receipt.headers.get("content-security-policy") ?? "",
        /sandbox/,
      );
      const foreign = (
        await request("auth/login", {
          email: "invited-customer@test.local",
          password: "invited-customer-password",
        })
      ).cookie;
      assert.equal(
        (await raw("account/benefits/" + id + "/receipt", foreign)).status,
        404,
      );
    },
  );
  await t.test(
    "Support-Lesemodus behält den Admin-Login, begrenzt Workspace-Zugriff und blockiert Upload, Zahlung und Sicherheitsänderungen",
    async () => {
      const original = (await request("state", undefined, admin.cookie)).data;
      const support = await request(
        "support/start",
        {
          userId: user.id,
          mode: "read",
          reason: "Read-only support fixture",
          confirmEmail: user.email,
          proof,
        },
        admin.cookie,
      );
      assert.equal(support.status, 200, support.data.error);
      const supportCookie = admin.cookie + "; " + support.cookie;
      const view = await request("state", undefined, supportCookie);
      const preferenceCount = Number(
        (await pool.query("SELECT count(*) n FROM user_workspace_preferences"))
          .rows[0].n,
      );
      const supportSelection = await request(
        "preferences/project",
        { id: view.data.workspace.project_id },
        supportCookie,
      );
      assert.equal(supportSelection.status, 200);
      assert.equal(supportSelection.data.saved, false);
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) n FROM user_workspace_preferences",
            )
          ).rows[0].n,
        ),
        preferenceCount,
        "support navigation must not change customer preferences",
      );
      assert.equal(view.status, 200);
      assert.equal(view.data.user.id, user.id);
      assert.equal(
        (await request("state", undefined, admin.cookie)).data.user.id,
        original.user.id,
      );
      for (const path of ["admin/customers", "privacy/export"])
        assert.equal(
          (await request(path, undefined, supportCookie)).status,
          403,
          path,
        );
      for (const path of [
        "profile/password",
        "billing/checkout",
        "agents",
        "environments/launch",
        "customer-hosts",
      ])
        assert.equal(
          (await request(path, {}, supportCookie)).status,
          403,
          path,
        );
      assert.equal(
        (await raw("attachments/upload", supportCookie, {})).status,
        403,
      );
      assert.equal(
        (await raw("state?workspaceId=" + original.workspace.id, supportCookie))
          .status,
        403,
      );
      assert.equal(
        (await request("support/exit", {}, supportCookie)).status,
        200,
      );
    },
  );
  await t.test(
    "Support-Schreibmodus protokolliert den Admin als Akteur und erlaubt keine Schlüssel- oder Rechteänderung",
    async () => {
      const support = await request(
        "support/start",
        {
          userId: user.id,
          mode: "write",
          reason: "Write support protocol fixture",
          confirmEmail: user.email,
          proof,
        },
        admin.cookie,
      );
      assert.equal(support.status, 200);
      const both = admin.cookie + "; " + support.cookie;
      assert.equal(
        (await request("execution/control", { action: "stop" }, both)).status,
        200,
      );
      assert.equal(
        (await request("execution/control", { action: "resume" }, both)).status,
        200,
      );
      for (const path of [
        "provider",
        "models",
        "connections",
        "environments/agents",
        "profile/security/disable",
        "privacy/delete",
        "billing/portal",
      ])
        assert.equal((await request(path, {}, both)).status, 403, path);
      assert.ok(
        (
          await pool.query(
            "SELECT 1 FROM audit WHERE action='admin.support.write' AND subject LIKE $1",
            [user.id + ":%"],
          )
        ).rowCount > 0,
      );
      await request("support/exit", {}, both);
    },
  );
  await t.test(
    "Supportablauf und widerrufene Elternsitzungen können sicher beendet werden, ohne Kunden-2FA zu umgehen",
    async () => {
      const fresh = await request("auth/login", {
        email: "admin@test.local",
        password: "integration-admin-password",
      });
      assert.equal(fresh.status, 200);
      const support = await request(
        "support/start",
        {
          userId: user.id,
          mode: "read",
          reason: "Expiry support protocol fixture",
          confirmEmail: user.email,
          proof,
        },
        fresh.cookie,
      );
      assert.equal(support.status, 200);
      const both = fresh.cookie + "; " + support.cookie;
      await pool.query(
        "UPDATE support_sessions SET expires_at=now()-interval '1 minute' WHERE parent_session=$1",
        [hashToken(fresh.cookie.split("=")[1])],
      );
      assert.equal((await request("state", undefined, both)).status, 401);
      assert.equal(
        (await request("support/status", undefined, both)).data.expired,
        true,
      );
      await pool.query("DELETE FROM sessions WHERE id=$1", [
        hashToken(fresh.cookie.split("=")[1]),
      ]);
      const exit = await request("support/exit", {}, both);
      assert.equal(exit.status, 200);
      assert.ok(exit.cookie.startsWith("kc_support="));
      assert.equal(
        (await request("state", undefined, fresh.cookie)).status,
        401,
      );
      assert.equal(
        (await request("state", undefined, admin.cookie)).status,
        200,
      );
    },
  );
  await t.test(
    "Zugangsende sperrt Modellaufrufe, neue Arbeit und Umgebungen, während Daten und Belege abrufbar bleiben",
    async () => {
      assert.equal(
        (
          await mutate("subscription", {
            planId: "pro",
            status: "active",
            until: new Date(Date.now() - 1000).toISOString(),
          })
        ).status,
        200,
      );
      assert.equal((await request("agents", {}, cookie)).status, 403);
      assert.equal((await raw("attachments/upload", cookie, {})).status, 403);
      const { consumeModelStep } =
          await import("../../src/server/execution-policy.ts"),
        { transaction } = await import("../../src/server/db.ts");
      await assert.rejects(
        () => transaction((c: any) => consumeModelStep(c, account)),
        (e: any) => e.status === 403,
      );
      assert.equal(
        (await request("runtime", undefined, cookie)).data.eligible,
        false,
      );
      assert.equal(
        (await request("privacy/export", undefined, cookie)).status,
        200,
      );
      assert.equal(
        (await request("account/benefits", undefined, cookie)).status,
        200,
      );
      assert.equal(
        (
          await mutate("subscription", {
            planId: "pro",
            status: "active",
            until: new Date(Date.now() + 86400000).toISOString(),
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "Abgelaufene Reset-Links und gesperrte Konten können keine Anmeldung wiederherstellen",
    async () => {
      const reset = await mutate("reset", { send: false });
      assert.equal(reset.status, 200);
      const token = new URL(reset.data.url).hash.slice(1);
      await pool.query(
        "UPDATE password_resets SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        [user.id],
      );
      assert.equal(
        (
          await request("auth/password-reset", {
            token,
            password: "blocked-reset-password",
          })
        ).status,
        400,
      );
      assert.equal((await mutate("suspend", { suspended: true })).status, 200);
      assert.equal(
        (
          await request("auth/login", {
            email: user.email,
            password: "managed-final-password",
          })
        ).status,
        401,
      );
      assert.equal((await mutate("reset", { send: false })).status, 409);
      assert.equal((await mutate("suspend", { suspended: false })).status, 200);
      cookie = (
        await request("auth/login", {
          email: user.email,
          password: "managed-final-password",
        })
      ).cookie;
    },
  );
  await t.test(
    "Echte SMTP-Protokoll-Fixture liefert Reset-Mail, maskiert Konfiguration und bewahrt bestehende 2FA",
    async () => {
      const messages: string[] = [];
      const smtp = createServer((socket) => {
        socket.setEncoding("utf8");
        socket.write("220 fixture SMTP\r\n");
        let buffer = "",
          data = false,
          body = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          while (buffer.includes("\r\n")) {
            const at = buffer.indexOf("\r\n"),
              line = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            if (data) {
              if (line === ".") {
                messages.push(body);
                body = "";
                data = false;
                socket.write("250 accepted\r\n");
              } else body += line + "\r\n";
            } else if (line.startsWith("EHLO"))
              socket.write("250-fixture\r\n250 SIZE 500000\r\n");
            else if (line === "DATA") {
              data = true;
              socket.write("354 data\r\n");
            } else if (line === "QUIT") {
              socket.end("221 bye\r\n");
            } else socket.write("250 ok\r\n");
          }
        });
      });
      await new Promise<void>((resolve) =>
        smtp.listen(0, "127.0.0.1", resolve),
      );
      const address = smtp.address();
      assert.ok(address && typeof address !== "string");
      try {
        const mail = {
          enabled: true,
          host: "127.0.0.1",
          port: address.port,
          mode: "local",
          username: "",
          from: "noreply@fixture.invalid",
          proof,
        };
        assert.equal(
          (await request("admin/mail", mail, admin.cookie)).status,
          200,
        );
        assert.equal(
          (
            await request(
              "admin/mail",
              { action: "verify", proof },
              admin.cookie,
            )
          ).status,
          200,
        );
        assert.equal(messages.length, 0);
        const config = await request("admin/mail", undefined, admin.cookie);
        assert.ok(!("password" in config.data));
        assert.equal(
          (
            await request(
              "admin/mail",
              { ...mail, host: "smtp.example.com" },
              admin.cookie,
            )
          ).status,
          400,
        );
        const secret = "JBSWY3DPEHPK3PXP";
        await pool.query(
          "INSERT INTO account_security(user_id,totp_secret) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET totp_secret=EXCLUDED.totp_secret",
          [user.id, encrypt(secret)],
        );
        const unknown = await request("auth/password-forgot", {
            email: "no-matching-customer@fixture.invalid",
          }),
          known = await request("auth/password-forgot", { email: user.email });
        assert.deepEqual(known.data, unknown.data);
        const { deliverNextMail } = await import("../../src/server/mail.ts");
        for (let i = 0; i < 100 && !messages.length; i++) {
          await deliverNextMail();
          await new Promise((r) => setTimeout(r, 50));
        }
        assert.equal(messages.length, 1);
        const text = messages[0].replace(/=\r\n/g, "");
        assert.ok(!text.includes("managed-final-password"));
        assert.ok(text.includes("/reset-password#"));
        const match = text.match(/reset-password#([a-f0-9]{64})/);
        assert.ok(match);
        const token = match[1];
        const resetResults = await Promise.all([
          request("auth/password-reset", {
            token,
            password: "managed-after-mail-password",
          }),
          request("auth/password-reset", {
            token,
            password: "managed-after-mail-password",
          }),
        ]);
        assert.deepEqual(
          resetResults.map((r: any) => r.status).sort(),
          [200, 400],
        );
        const login = await request("auth/login", {
          email: user.email,
          password: "managed-after-mail-password",
        });
        assert.equal(login.status, 200);
        assert.equal(login.data.mfaRequired, true);
        assert.ok(
          (
            await pool.query(
              "SELECT 1 FROM account_security WHERE user_id=$1 AND totp_secret IS NOT NULL",
              [user.id],
            )
          ).rowCount > 0,
        );
        assert.equal(
          (await mutate("mfa_reset", { confirmEmail: user.email })).status,
          200,
        );
        cookie = (
          await request("auth/login", {
            email: user.email,
            password: "managed-after-mail-password",
          })
        ).cookie;
        const payloads = (
          await pool.query(
            "SELECT payload FROM mail_outbox WHERE user_id=$1 AND status='sent'",
            [user.id],
          )
        ).rows;
        assert.ok(payloads.length > 0);
        assert.ok(payloads.every((p: any) => p.payload === null));
      } finally {
        await pool.query(
          "UPDATE settings SET value=jsonb_set(value,'{enabled}','false') WHERE id='mail'",
        );
        await new Promise<void>((resolve) => smtp.close(() => resolve()));
      }
    },
  );
  await t.test(
    "Interne Verwaltung wird exportiert, Sitzungsgeheimnisse nicht; eigene Admin-Sperre bleibt verboten",
    async () => {
      const exported = await request("privacy/export", undefined, cookie);
      assert.equal(exported.status, 200);
      assert.ok(exported.data.complimentary_benefits.grants.length >= 2);
      assert.ok(exported.data.customer_notes.length);
      assert.ok(exported.data.support_access.length);
      assert.ok(!JSON.stringify(exported.data).includes("parent_session"));
      assert.ok(!JSON.stringify(exported.data).includes("fingerprint"));
      assert.ok(!JSON.stringify(exported.data).includes("password_hash"));
      const actor = (await request("state", undefined, admin.cookie)).data.user;
      const self = await request(
        "admin/customers/" + actor.id,
        {
          action: "suspend",
          suspended: true,
          reason: "Forbidden self suspension fixture",
          proof,
        },
        admin.cookie,
      );
      assert.equal(self.status, 409);
    },
  );
  await t.test(
    "Rollenänderungen widerrufen Sitzungen und können die eigene Adminrolle nicht entfernen",
    async () => {
      assert.equal(
        (await mutate("role", { role: "admin", confirmEmail: user.email }))
          .status,
        200,
      );
      assert.equal((await request("state", undefined, cookie)).status, 401);
      const promoted = await request("auth/login", {
        email: user.email,
        password: "managed-after-mail-password",
      });
      assert.equal(promoted.status, 200);
      assert.equal(
        (await request("state", undefined, promoted.cookie)).data.user.role,
        "admin",
      );
      assert.equal(
        (await mutate("role", { role: "user", confirmEmail: user.email }))
          .status,
        200,
      );
      assert.equal(
        (await request("state", undefined, promoted.cookie)).status,
        401,
      );
      cookie = (
        await request("auth/login", {
          email: user.email,
          password: "managed-after-mail-password",
        })
      ).cookie;
    },
  );
}
