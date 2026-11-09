import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import type { TestContext } from "node:test";
import { totpCode } from "../../src/core/totp.ts";
export async function securityInfrastructureTests(
  t: TestContext,
  { request, pool, handle, alice, bob, admin, a }: Record<string, any>,
) {
  await t.test(
    "Authenticator-2FA: Einrichtung, verpflichtender zweiter Faktor, Wiederverwendung und Recovery",
    async () => {
      const status = await request("profile/security", undefined, alice.cookie);
      assert.equal(status.data.enabled, false);
      assert.equal(
        (
          await request(
            "profile/security/setup",
            { password: "wrong" },
            alice.cookie,
          )
        ).status,
        401,
      );
      const setup = await request(
        "profile/security/setup",
        { password: "alice-strong-password" },
        alice.cookie,
      );
      assert.equal(setup.status, 200, JSON.stringify(setup.data));
      assert.match(setup.data.qr, /^data:image\/png;base64,/);
      const secret = setup.data.secret,
        code = totpCode(secret);
      assert.equal(
        (
          await request(
            "profile/security/enable",
            { password: "alice-strong-password", code: "00000x" },
            alice.cookie,
          )
        ).status,
        401,
      );
      const oldCookie = alice.cookie,
        enabled = await request(
          "profile/security/enable",
          { password: "alice-strong-password", code },
          alice.cookie,
        );
      assert.equal(enabled.status, 200);
      assert.equal(enabled.data.recoveryCodes.length, 10);
      alice.cookie = enabled.cookie;
      assert.equal((await request("state", undefined, oldCookie)).status, 401);
      const stored = (
        await pool.query("SELECT * FROM account_security WHERE user_id=$1", [
          a.user.id,
        ])
      ).rows[0];
      assert.ok(!stored.totp_secret.includes(secret));
      assert.ok(
        !JSON.stringify(stored.recovery_hashes).includes(
          enabled.data.recoveryCodes[0],
        ),
      );
      const login = await request("auth/login", {
        email: "alice@test.local",
        password: "alice-strong-password",
      });
      assert.equal(login.data.mfaRequired, true);
      assert.match(login.cookie, /kc_login_challenge=/);
      assert.equal(
        (await request("state", undefined, login.cookie)).status,
        401,
      );
      assert.equal(
        (await request("auth/mfa", { code }, login.cookie)).status,
        401,
      );
      const signed = await request(
        "auth/mfa",
        { code: enabled.data.recoveryCodes[0] },
        login.cookie,
      );
      assert.equal(signed.status, 200);
      alice.cookie = signed.cookie;
      assert.equal(
        (
          await request(
            "auth/mfa",
            { code: enabled.data.recoveryCodes[1] },
            login.cookie,
          )
        ).status,
        401,
      );
      const again = await request("auth/login", {
        email: "alice@test.local",
        password: "alice-strong-password",
      });
      assert.equal(
        (
          await request(
            "auth/mfa",
            { code: enabled.data.recoveryCodes[0] },
            again.cookie,
          )
        ).status,
        401,
      );
      const future = totpCode(secret, Date.now() + 30000),
        next = await request("auth/mfa", { code: future }, again.cookie);
      assert.equal(next.status, 200);
      alice.cookie = next.cookie;
      assert.equal(
        (
          await request(
            "profile/password",
            {
              current: "alice-strong-password",
              password: "alice-new-strong-password",
            },
            alice.cookie,
          )
        ).status,
        401,
      );
      const changed = await request(
        "profile/password",
        {
          current: "alice-strong-password",
          password: "alice-new-strong-password",
          code: enabled.data.recoveryCodes[1],
        },
        alice.cookie,
      );
      assert.equal(changed.status, 200);
      alice.cookie = changed.cookie;
      const { completeIdentity } = await import("../../src/server/oauth.ts");
      await completeIdentity(
        "github",
        {
          subject: "fixture-alice-github",
          email: "external-alice@example.test",
          name: "Alice",
        },
        { link_user_id: a.user.id, intent: "link", privacy: false },
      );
      const social = await completeIdentity(
        "github",
        {
          subject: "fixture-alice-github",
          email: "external-alice@example.test",
          name: "Alice",
        },
        { link_user_id: null, intent: "login", privacy: false },
      );
      assert.ok(social.challenge);
      assert.equal(social.token, undefined);
      const exportData = (
        await request("privacy/export", undefined, alice.cookie)
      ).data;
      assert.ok(!JSON.stringify(exportData).includes(secret));
      assert.ok(
        !JSON.stringify(exportData).includes(enabled.data.recoveryCodes[2]),
      );
      assert.equal(exportData.security.enabled, true);
      const disabled = await request(
        "profile/security/disable",
        {
          password: "alice-new-strong-password",
          code: enabled.data.recoveryCodes[2],
        },
        alice.cookie,
      );
      assert.equal(disabled.status, 200);
      alice.cookie = disabled.cookie;
      assert.equal(
        (await request("profile/security", undefined, alice.cookie)).data
          .enabled,
        false,
      );
    },
  );
  await t.test(
    "OAuth: Signatur, Audience, Nonce, bestätigte E-Mail, State und keine automatische Kontoverknüpfung",
    async () => {
      const previousCookie = alice.cookie;
      const unlinked = await request(
        "profile/oauth/unlink",
        { provider: "github", password: "alice-new-strong-password" },
        alice.cookie,
      );
      assert.equal(unlinked.status, 200);
      alice.cookie = unlinked.cookie;
      assert.equal(
        (await request("state", undefined, previousCookie)).status,
        401,
      );
      assert.equal(
        (await request("profile/security", undefined, alice.cookie)).data
          .identities.length,
        0,
      );
      const {
        verifyGoogleIdentity,
        verifyMicrosoftIdentity,
        completeIdentity,
      } = await import("../../src/server/oauth.ts");
      const { privateKey, publicKey } = await generateKeyPair("RS256"),
        jwk = await exportJWK(publicKey);
      jwk.kid = "fixture-key";
      const keys = createLocalJWKSet({ keys: [jwk] });
      const token = await new SignJWT({
        email: "verified@example.test",
        email_verified: true,
        nonce: "fixture-nonce",
        name: "Test",
      })
        .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
        .setIssuer("https://accounts.google.com")
        .setAudience("fixture-client")
        .setSubject("google-subject")
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(privateKey);
      assert.equal(
        (
          await verifyGoogleIdentity(
            token,
            "fixture-client",
            "fixture-nonce",
            keys,
          )
        ).email,
        "verified@example.test",
      );
      await assert.rejects(() =>
        verifyGoogleIdentity(token, "other-client", "fixture-nonce", keys),
      );
      await assert.rejects(() =>
        verifyGoogleIdentity(token, "fixture-client", "wrong-nonce", keys),
      );
      const other = await generateKeyPair("RS256"),
        bad = await new SignJWT({
          email: "verified@example.test",
          email_verified: true,
          nonce: "fixture-nonce",
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
          .setIssuer("https://accounts.google.com")
          .setAudience("fixture-client")
          .setSubject("bad")
          .setExpirationTime("2m")
          .sign(other.privateKey);
      await assert.rejects(() =>
        verifyGoogleIdentity(bad, "fixture-client", "fixture-nonce", keys),
      );
      const tid = "9188040d-6c67-4c5b-b112-36a304b66dad";
      const msToken = await new SignJWT({
        tid,
        ver: "2.0",
        email: "contact@example.test",
        nonce: "ms-nonce",
      })
        .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
        .setIssuer(`https://login.microsoftonline.com/${tid}/v2.0`)
        .setAudience("ms-client")
        .setSubject("ms-user")
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(privateKey);
      assert.equal(
        (await verifyMicrosoftIdentity(msToken, "ms-client", "ms-nonce", keys))
          .subject,
        `${tid}:ms-user`,
      );
      await assert.rejects(() =>
        verifyMicrosoftIdentity(msToken, "wrong-client", "ms-nonce", keys),
      );
      await assert.rejects(() =>
        verifyMicrosoftIdentity(msToken, "ms-client", "wrong-nonce", keys),
      );
      const wrongIssuer = await new SignJWT({
        tid,
        ver: "2.0",
        email: "contact@example.test",
        nonce: "ms-nonce",
      })
        .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
        .setIssuer(
          "https://login.microsoftonline.com/00000000-0000-4000-a000-000000000000/v2.0",
        )
        .setAudience("ms-client")
        .setSubject("ms-user")
        .setExpirationTime("2m")
        .sign(privateKey);
      await assert.rejects(() =>
        verifyMicrosoftIdentity(wrongIssuer, "ms-client", "ms-nonce", keys),
      );
      await completeIdentity(
        "microsoft",
        {
          subject: tid + ":alice-ms",
          email: "contact-ms@example.test",
          name: "Alice",
        },
        { link_user_id: a.user.id, intent: "link", privacy: false },
      );
      assert.ok(
        (
          await completeIdentity(
            "microsoft",
            {
              subject: tid + ":alice-ms",
              email: "changed-contact@example.test",
              name: "Alice",
            },
            { link_user_id: null, intent: "login", privacy: false },
          )
        ).token,
      );
      await assert.rejects(() =>
        completeIdentity(
          "google",
          {
            subject: "account-takeover-attempt",
            email: "alice@test.local",
            name: "Intruder",
          },
          { link_user_id: null, intent: "signup", privacy: true },
        ),
      );
      assert.equal(
        (await request("admin/security", {}, alice.cookie)).status,
        403,
      );
      const cfg = {
        publicUrl: "http://localhost:3100",
        providers: {
          google: {
            enabled: true,
            clientId: "fixture-client",
            secret: "test-oauth-secret",
          },
          github: { enabled: false, clientId: "", secret: "" },
        },
      };
      assert.equal(
        (await request("admin/security", cfg, admin.cookie)).status,
        200,
      );
      assert.ok(
        !JSON.stringify(
          (await request("admin/security", undefined, admin.cookie)).data,
        ).includes("test-oauth-secret"),
      );
      const start = await handle(
        new NextRequest("http://localhost:3100/api/auth/oauth/google/start"),
        "auth/oauth/google/start",
      );
      assert.equal(start.status, 303);
      const location = new URL(start.headers.get("location")!);
      assert.equal(location.origin, "https://accounts.google.com");
      assert.equal(location.searchParams.get("code_challenge_method"), "S256");
      const state = location.searchParams.get("state"),
        cookie = start.headers.get("set-cookie")!.split(";")[0];
      const mismatch = await handle(
        new NextRequest(
          `http://localhost:3100/api/auth/oauth/google/callback?state=${state}`,
        ),
        "auth/oauth/google/callback",
      );
      assert.equal(mismatch.status, 303);
      assert.match(mismatch.headers.get("location")!, /oauthError=failed/);
      const cancel = await handle(
        new NextRequest(
          `http://localhost:3100/api/auth/oauth/google/callback?state=${state}`,
          { headers: { cookie } },
        ),
        "auth/oauth/google/callback",
      );
      assert.equal(cancel.status, 303);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS n FROM oauth_states"))
          .rows[0].n,
        0,
      );
      cfg.providers.google.enabled = false;
      await request("admin/security", cfg, admin.cookie);
    },
  );
  await t.test(
    "Infrastruktur: Adminrechte, Server-Token, Mandanten, Lease-Fencing und unklare Containeraktionen",
    async () => {
      assert.equal(
        (await request("admin/infrastructure", undefined, alice.cookie)).status,
        403,
      );
      const host = (
        await request(
          "admin/infrastructure",
          { action: "createHost", name: "Fixture Docker host", kind: "docker" },
          admin.cookie,
        )
      ).data;
      async function agent(path: string, body: unknown, token = host.token) {
        const r = await handle(
          new NextRequest(
            `http://localhost:3100/api/infrastructure/agent/${path}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                authorization: `Bearer ${token}`,
                "x-host-id": host.id,
              },
              body: JSON.stringify(body),
            },
          ),
          `infrastructure/agent/${path}`,
        );
        return { status: r.status, data: await r.json() };
      }
      const inventory = {
        version: "fixture Docker",
        hostname: "test-host",
        cpuCount: 2,
        memoryTotal: 1024,
        memoryFree: 512,
        load: [0, 0, 0],
        commandsEnabled: true,
        containers: [
          {
            id: "fixture-container",
            name: "fixture",
            image: "alpine:3.22",
            state: "running",
            health: "healthy",
            environmentId: null,
            cpuPercent: 1,
            memoryBytes: 100,
            startedAt: null,
            Env: ["SHOULD_NOT_STORE_SECRET"],
          },
        ],
      };
      assert.equal((await agent("heartbeat", inventory, "wrong")).status, 401);
      assert.equal((await agent("heartbeat", inventory)).status, 200);
      const view = (
        await request("admin/infrastructure", undefined, admin.cookie)
      ).data;
      assert.ok(!JSON.stringify(view).includes(host.token));
      assert.ok(!JSON.stringify(view).includes("SHOULD_NOT_STORE_SECRET"));
      const spec = {
        action: "template",
        id: "fixture-dev",
        name: "Fixture",
        image: "alpine:3.22",
        command: ["sleep", "infinity"],
        cpu: 1,
        memory_mb: 128,
        container_port: 0,
        network: false,
        enabled: true,
        user_id: "1000:1000",
        read_only: true,
        access_mode: "code-server",
      };
      assert.equal(
        (
          await request(
            "admin/infrastructure",
            { ...spec, user_id: "0:0" },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request("admin/infrastructure", spec, admin.cookie)).status,
        200,
      );
      const deployment = {
        action: "deploy",
        workspaceId: a.workspace.id,
        hostId: host.id,
        templateId: "fixture-dev",
        name: "Fixture customer environment",
      };
      assert.equal(
        (await request("admin/infrastructure", deployment, admin.cookie))
          .status,
        409,
      );
      await request(
        "admin/infrastructure",
        { action: "host", id: host.id, enabled: true, provisioning: true },
        admin.cookie,
      );
      const created = await request(
        "admin/infrastructure",
        deployment,
        admin.cookie,
      );
      assert.equal(created.status, 200);
      const id = created.data.id;
      assert.ok(
        (
          await request("environments", undefined, alice.cookie)
        ).data.environments.some((e: any) => e.id === id),
      );
      assert.equal(
        (await request("environments", undefined, bob.cookie)).data.environments
          .length,
        0,
      );
      const regular = JSON.stringify(
        (await request("admin/infrastructure", undefined, admin.cookie)).data,
      );
      assert.ok(!regular.includes("accessPassword"));
      assert.equal(
        (await request("environments/access", { id }, bob.cookie)).status,
        409,
      );
      const job = (await agent("claim", {})).data.job;
      assert.ok(job.spec.accessPassword.length >= 24);
      assert.ok(!regular.includes(job.spec.accessPassword));
      assert.equal(job.environmentId, id);
      assert.equal(
        (
          await request(
            "admin/infrastructure",
            { action: "environment", id, operation: "stop" },
            admin.cookie,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await agent("complete", {
            id: job.id,
            lease: randomUUID(),
            ok: true,
            resourceId: "fake",
          })
        ).status,
        409,
      );
      const success = {
        id: job.id,
        lease: job.lease,
        ok: true,
        resourceId: "fixture-owned",
        endpoint: "https://unapproved-public.test",
      };
      assert.equal((await agent("complete", success)).status, 200);
      assert.equal((await agent("complete", success)).status, 200);
      let env = (
        await request("admin/infrastructure", undefined, admin.cookie)
      ).data.environments.find((e: any) => e.id === id);
      assert.equal(env.endpoint, null);
      await request(
        "admin/infrastructure",
        { action: "environment", id, operation: "start" },
        admin.cookie,
      );
      const startJob = (await agent("claim", {})).data.job;
      await agent("complete", {
        id: startJob.id,
        lease: startJob.lease,
        ok: true,
        resourceId: "fixture-owned",
        endpoint: "http://127.0.0.1:45678/",
      });
      const access = await request("environments/access", { id }, alice.cookie);
      assert.equal(access.status, 200);
      assert.equal(access.data.password, job.spec.accessPassword);
      assert.equal(
        (await request("environments/access", { id }, bob.cookie)).status,
        409,
      );
      assert.ok(
        !JSON.stringify(
          (await request("admin/infrastructure", undefined, admin.cookie)).data,
        ).includes(job.spec.accessPassword),
      );

      assert.equal(
        (
          await request(
            "admin/infrastructure",
            {
              action: "environment",
              id,
              operation: "reset",
              confirmation: "wrong",
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      await request(
        "admin/infrastructure",
        {
          action: "environment",
          id,
          operation: "reset",
          confirmation: deployment.name,
        },
        admin.cookie,
      );
      const reset = (await agent("claim", {})).data.job;
      await pool.query(
        "UPDATE environment_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [reset.id],
      );
      await agent("heartbeat", inventory);
      env = (
        await request("admin/infrastructure", undefined, admin.cookie)
      ).data.environments.find((e: any) => e.id === id);
      assert.equal(env.status, "uncertain");
      assert.equal(
        (
          await agent("complete", {
            id: reset.id,
            lease: reset.lease,
            ok: true,
          })
        ).status,
        409,
      );
      await request(
        "admin/infrastructure",
        { action: "environment", id, operation: "reconcile" },
        admin.cookie,
      );
      const retry = (await agent("claim", {})).data.job;
      assert.equal(retry.id, reset.id);
      assert.equal(retry.generation, reset.generation);
      assert.notEqual(retry.lease, reset.lease);
      await agent("complete", {
        id: retry.id,
        lease: retry.lease,
        ok: true,
        resourceId: "fixture-owned-reset",
      });
      await request(
        "admin/infrastructure",
        {
          action: "environment",
          id,
          operation: "delete",
          confirmation: deployment.name,
        },
        admin.cookie,
      );
      const remove = (await agent("claim", {})).data.job;
      await agent("complete", { id: remove.id, lease: remove.lease, ok: true });
      env = (
        await request("admin/infrastructure", undefined, admin.cookie)
      ).data.environments.find((e: any) => e.id === id);
      assert.equal(env.status, "deleted");
    },
  );
}
