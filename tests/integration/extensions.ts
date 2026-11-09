import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import Stripe from "stripe";
import type { TestContext } from "node:test";
export async function extensions(
  t: TestContext,
  {
    request,
    pool,
    handle,
    alice,
    bob,
    admin,
    a,
    b,
    fixtureUrl,
  }: Record<string, any>,
) {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const { githubLocation } = await import("../../src/server/materials.ts");
  const withWorkspace = (cookie: string, id: string) =>
    `${cookie}; kc_workspace=${id}`;
  let uploadId = "",
    pricedId = "",
    ws2 = "";
  await t.test(
    "Bestandsmigration erhält Plan, Guthaben und verschlüsselte Zugangsdaten",
    async () => {
      const row = (
        await pool.query(
          "SELECT * FROM workspace_context WHERE id='migration-workspace'",
        )
      ).rows[0];
      assert.equal(row.credits, 12345);
      assert.equal(row.plan_id, "starter");
      assert.equal(row.subscription_status, "local_test");
      const legacy = (
        await pool.query(
          "SELECT p.secret=m.secret AS same FROM providers p JOIN model_offerings m ON m.id=p.workspace_id WHERE p.workspace_id='migration-workspace'",
        )
      ).rows[0];
      assert.equal(legacy.same, true);
      const { readFileSync } = await import("node:fs");
      await pool.query(readFileSync("src/server/schema.sql", "utf8"));
      await pool.query(readFileSync("src/server/migrations/002.sql", "utf8"));
      await pool.query(readFileSync("src/server/migrations/003.sql", "utf8"));
      assert.equal(
        (
          await pool.query(
            "SELECT credits FROM accounts WHERE id='migration-workspace'",
          )
        ).rows[0].credits,
        12345,
      );
    },
  );
  await t.test(
    "Mehrere Workspaces teilen ein Konto und Guthaben; Limits und Fremdzugriff greifen",
    async () => {
      const result = await request(
        "workspaces",
        { name: "Alice Projekt zwei" },
        alice.cookie,
      );
      assert.equal(result.status, 200, JSON.stringify(result.data));
      ws2 = result.data.id;
      const next = await request(
        "state",
        undefined,
        withWorkspace(alice.cookie, ws2),
      );
      assert.equal(next.status, 200);
      assert.equal(next.data.agents.length, 3);
      assert.equal(next.data.tasks.length, 0);
      assert.equal(next.data.workspace.account_id, a.workspace.account_id);
      assert.equal(next.data.workspaces.length, 2);
      assert.equal(
        (await request("workspaces", { name: "Über dem Limit" }, alice.cookie))
          .status,
        402,
      );
      assert.equal(
        (await request("state", undefined, withWorkspace(bob.cookie, ws2)))
          .status,
        403,
      );
      assert.equal(
        (await request("workspaces/select", { id: ws2 }, bob.cookie)).status,
        403,
      );
      const adminGrant = await request(
        "admin/workspace",
        { id: a.workspace.id, plan_id: "starter", creditAdjustment: 20000 },
        admin.cookie,
      );
      assert.equal(adminGrant.status, 200);
      const balance = (
        await request("state", undefined, withWorkspace(alice.cookie, ws2))
      ).data.workspace.credits;
      assert.equal(balance, 20000);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM accounts WHERE owner_id=$1",
            [a.user.id],
          )
        ).rows[0].count,
        1,
      );
    },
  );
  await t.test(
    "Chat-Upload verarbeitet Text, DOCX und PDF; verbietet Binärdateien und fremde Anhänge",
    async () => {
      async function upload(
        name: string,
        data: Uint8Array | string,
        cookie = alice.cookie,
      ) {
        const form = new FormData();
        form.append(
          "files",
          new File(
            [typeof data === "string" ? data : new Uint8Array(data)],
            name,
          ),
        );
        const req = new NextRequest(
          "http://localhost:3100/api/attachments/upload",
          { method: "POST", headers: { cookie }, body: form },
        );
        const r = await handle(req, "attachments/upload");
        return { status: r.status, data: await r.json() };
      }
      const text = await upload(
        "briefing.md",
        "Wichtige Projektdaten: Die Zielgruppe ist Support. FILE_CONTEXT_2026",
      );
      assert.equal(text.status, 200, JSON.stringify(text.data));
      uploadId = text.data.ids[0];
      const docx = zipSync({
        "word/document.xml": strToU8(
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX &amp; Kontext</w:t></w:r></w:p></w:body></w:document>',
        ),
      });
      const word = await upload("briefing.docx", docx);
      assert.equal(word.status, 200, JSON.stringify(word.data));
      assert.match(
        (
          await request(
            `attachments/${word.data.ids[0]}`,
            undefined,
            alice.cookie,
          )
        ).data.content,
        /DOCX & Kontext/,
      );
      // Small valid text PDF, generated entirely as a protocol fixture.
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      ];
      const content = "BT /F1 12 Tf 40 200 Td (PDF Kontext) Tj ET";
      objects.push(
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      );
      let pdf = "%PDF-1.4\n",
        offsets = [0];
      objects.forEach((o, i) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
      });
      const xref = Buffer.byteLength(pdf);
      pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
        .join(
          "",
        )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
      const document = await upload("briefing.pdf", pdf);
      assert.equal(document.status, 200, JSON.stringify(document.data));
      assert.match(
        (
          await request(
            `attachments/${document.data.ids[0]}`,
            undefined,
            alice.cookie,
          )
        ).data.content,
        /PDF Kontext/,
      );
      assert.equal((await upload("malware.exe", "binary")).status, 415);
      assert.equal(
        (await upload("binary.txt", new Uint8Array([0, 1, 2]))).status,
        415,
      );
      assert.equal(
        (await request(`attachments/${uploadId}`, undefined, bob.cookie))
          .status,
        404,
      );
      assert.equal(
        (
          await request(
            "runs",
            {
              goal: "Fremde Datei darf nicht zugänglich sein.",
              agentId: b.agents[0].id,
              attachmentIds: [uploadId],
            },
            bob.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "chat",
            {
              message: "Nur Info",
              informationOnly: true,
              attachmentIds: [uploadId],
            },
            withWorkspace(alice.cookie, ws2),
          )
        ).status,
        403,
      );
      assert.deepEqual(
        githubLocation("https://github.com/owner/repository.git"),
        { owner: "owner", repo: "repository" },
      );
      assert.throws(() => githubLocation("http://127.0.0.1/private"));
      assert.throws(() => githubLocation("https://github.com.evil.test/o/r"));
      assert.throws(() => githubLocation("https://github.com/o/r/tree/main"));
      const originalFetch = globalThis.fetch;
      const mocked = t.mock.method(
        globalThis,
        "fetch",
        async (input: any, options: any) => {
          const url = String(input);
          if (!url.startsWith("https://api.github.com/"))
            return originalFetch(input, options);
          const map: Record<string, unknown> = {
            "/repos/example/fixture": { default_branch: "main" },
            "/repos/example/fixture/commits/main": {
              sha: "commit_fixture_2026",
              commit: { tree: { sha: "tree_fixture" } },
            },
            "/repos/example/fixture/git/trees/tree_fixture?recursive=1": {
              tree: [
                {
                  path: "README.md",
                  type: "blob",
                  size: 50,
                  sha: "blob_fixture",
                },
                { path: "binary.png", type: "blob", size: 10, sha: "binary" },
              ],
            },
            "/repos/example/fixture/git/blobs/blob_fixture": {
              encoding: "base64",
              content: Buffer.from("REPO_CONTEXT_FIXTURE").toString("base64"),
            },
          };
          return Response.json(
            map[new URL(url).pathname + new URL(url).search] ?? {},
            {
              status: map[new URL(url).pathname + new URL(url).search]
                ? 200
                : 404,
            },
          );
        },
      );
      try {
        const imported = await request(
          "attachments/github",
          {
            url: "https://github.com/example/fixture",
            token: "ephemeral-fixture-token",
          },
          alice.cookie,
        );
        assert.equal(imported.status, 200, JSON.stringify(imported.data));
        assert.equal(imported.data.imported, 1);
        assert.equal(imported.data.commit, "commit_fixture_2026");
        assert.ok(
          !JSON.stringify(
            (await request("privacy/export", undefined, alice.cookie)).data,
          ).includes("ephemeral-fixture-token"),
        );
      } finally {
        mocked.mock.restore();
      }
    },
  );
  await t.test(
    "Modellkatalog mit drei Angeboten, eigenen Tarifen und gesperrten Fremdänderungen",
    async () => {
      for (let i = 0; i < 3; i++) {
        const result = await request(
          "admin/models",
          {
            name: `Angebot ${i + 1}`,
            provider_name: `Provider ${i + 1}`,
            endpoint: `${fixtureUrl}/v1`,
            model: i === 0 ? "priced-stream" : "fixture-model",
            key: "new-catalog-secret",
            input_rate: 2,
            output_rate: 8,
            base_credits: 3,
          },
          admin.cookie,
        );
        assert.equal(result.status, 200, JSON.stringify(result.data));
        if (i === 0) pricedId = result.data.id;
      }
      const state = (await request("state", undefined, alice.cookie)).data;
      assert.ok(
        state.models.filter((m: any) => m.workspace_id === null).length >= 3,
      );
      assert.ok(!JSON.stringify(state).includes("new-catalog-secret"));
      assert.equal(
        (
          await request(
            "models",
            {
              id: pricedId,
              name: "Hacked",
              provider_name: "Hacked",
              endpoint: `${fixtureUrl}/v1`,
              model: "hacked",
            },
            alice.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await request("admin/models", { name: "Forbidden" }, alice.cookie))
          .status,
        403,
      );
      const nova = state.agents.find((a: any) => a.name === "Nova");
      assert.equal(
        (await request("agents", { ...nova, model_id: pricedId }, alice.cookie))
          .status,
        200,
      );
      const foreignAgent = (
        await request("state", undefined, withWorkspace(alice.cookie, ws2))
      ).data.agents[0];
      assert.equal(
        (
          await request(
            "agents",
            { ...foreignAgent, model_id: a.workspace.id },
            withWorkspace(alice.cookie, ws2),
          )
        ).status,
        403,
      );
    },
  );
  await t.test(
    "Gruppenchat: @-Routing, Information ohne KI-Aufruf, zugeordnete Dateien und echte SSE-Deltas",
    async () => {
      const before = (
        await pool.query("SELECT count(*)::int AS count FROM model_calls")
      ).rows[0].count;
      const info = await request(
        "chat",
        {
          message: "Zusätzliche Infos für später.",
          informationOnly: true,
          attachmentIds: [uploadId],
        },
        alice.cookie,
      );
      assert.equal(info.status, 200);
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM model_calls"))
          .rows[0].count,
        before,
      );
      const state = (await request("state", undefined, alice.cookie)).data;
      const echo = state.agents.find((a: any) => a.name === "Echo");
      const own = await request(
        "models",
        {
          name: "Datei-Modell",
          provider_name: "Anderer Anbieter",
          endpoint: `${fixtureUrl}/v2`,
          model: "file-stream",
          key: "file-fixture-secret",
        },
        alice.cookie,
      );
      assert.equal(own.status, 200);
      assert.equal(
        (
          await request(
            "agents",
            { ...echo, model_id: own.data.id },
            alice.cookie,
          )
        ).status,
        200,
      );
      const started = await request(
        "chat",
        {
          message: "@Nova @Echo prüft bitte das Briefing.",
          agentIds: [state.agents[0].id],
          attachmentIds: [uploadId],
        },
        alice.cookie,
      );
      assert.equal(started.status, 200, JSON.stringify(started.data));
      let sawLive = false,
        finished: any;
      for (let i = 0; i < 100; i++) {
        await pause(100);
        sawLive =
          sawLive ||
          Boolean(
            (
              await pool.query(
                "SELECT d.id FROM model_deltas d JOIN model_calls m ON m.id=d.call_id WHERE d.run_id=$1 AND m.status='reserved'",
                [started.data.id],
              )
            ).rowCount,
          );
        finished = (await request("state", undefined, alice.cookie)).data;
        if (
          finished.runs.find((r: any) => r.id === started.data.id)?.status ===
          "completed"
        )
          break;
      }
      assert.equal(
        finished.runs.find((r: any) => r.id === started.data.id)?.status,
        "completed",
        JSON.stringify(finished.tasks),
      );
      assert.equal(sawLive, true);
      const tasks = finished.tasks.filter(
        (x: any) => x.run_id === started.data.id,
      );
      assert.equal(tasks.length, 2);
      assert.deepEqual(
        tasks.map((x: any) => x.agent_id).sort(),
        [echo.id, state.agents.find((a: any) => a.name === "Nova").id].sort(),
      );
      const answers = finished.chat.filter(
        (m: any) => m.run_id === started.data.id && m.agent_id,
      );
      assert.equal(answers.length, 2);
      assert.ok(
        answers.some((m: any) => m.content.includes("FILE_CONTEXT_2026")),
      );
      const calls = (
        await pool.query("SELECT * FROM model_calls WHERE run_id=$1", [
          started.data.id,
        ])
      ).rows;
      const priced = calls.find((c: any) => c.model_id === pricedId);
      assert.equal(priced.charged_credits, 6);
      assert.equal(priced.input_tokens, 1000);
      assert.equal(priced.output_tokens, 100);
      assert.equal(calls.filter((c: any) => c.managed).length, 1);
      const second = (
        await request("state", undefined, withWorkspace(alice.cookie, ws2))
      ).data;
      assert.equal(second.workspace.credits, 20000 - 6);
      assert.equal(second.chat.length, 0);
      assert.equal(second.attachments.length, 0);
      const abort = new AbortController();
      const response = await handle(
        new NextRequest(
          `http://localhost:3100/api/live?workspaceId=${a.workspace.id}`,
          { headers: { cookie: alice.cookie }, signal: abort.signal },
        ),
        "live",
      );
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      const reader = response.body!.getReader();
      const live = new TextDecoder().decode((await reader.read()).value);
      assert.match(live, /FILE_CONTEXT_2026/);
      abort.abort();
      await reader.cancel();
      const echoTask = tasks.find((task: any) => task.agent_id === echo.id);
      await pool.query("UPDATE runs SET status='running' WHERE id=$1", [
        started.data.id,
      ]);
      await pool.query(
        "UPDATE tasks SET status='input_required',error='Rückfrage der Fixture' WHERE id=$1",
        [echoTask.id],
      );
      const followup = await request(
        "chat",
        {
          message: "@Echo hier die ergänzende Antwort.",
          runId: started.data.id,
          agentIds: [echo.id],
        },
        alice.cookie,
      );
      assert.equal(followup.status, 200, JSON.stringify(followup.data));
      assert.equal(followup.data.id, started.data.id);
      for (let i = 0; i < 60; i++) {
        await pause(100);
        if (
          (
            await pool.query("SELECT status FROM runs WHERE id=$1", [
              started.data.id,
            ])
          ).rows[0].status === "completed"
        )
          break;
      }
      assert.equal(
        (
          await pool.query("SELECT status FROM runs WHERE id=$1", [
            started.data.id,
          ])
        ).rows[0].status,
        "completed",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM tasks WHERE run_id=$1",
            [started.data.id],
          )
        ).rows[0].count,
        2,
      );
    },
  );
  await t.test(
    "Profil, vollständiger Datenexport, versionierte Rechtstexte und Analyse mit Einwilligung",
    async () => {
      assert.equal(
        (
          await request(
            "profile",
            {
              name: "Alice Example",
              company: "Beispielfirma",
              billing_email: "billing@example.test",
              address: "Testanschrift",
              vat_id: "DE-Test",
            },
            alice.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("profile", undefined, alice.cookie)).data.company,
        "Beispielfirma",
      );
      assert.equal(
        (await request("profile", undefined, bob.cookie)).data.company,
        undefined,
      );
      const legal = {
        key: "impressum",
        title: "Test-Impressum",
        content:
          "Reiner Testtext für die Prüfung der Speicher- und Veröffentlichungsfunktion. Keine echten Firmendaten.",
        published: true,
      };
      assert.equal(
        (await request("admin/legal", legal, alice.cookie)).status,
        403,
      );
      assert.equal(
        (await request("admin/legal", legal, admin.cookie)).status,
        200,
      );
      assert.equal((await request("legal/impressum")).data.version, 1);
      await request(
        "admin/legal",
        { ...legal, content: legal.content + " Version zwei." },
        admin.cookie,
      );
      assert.equal((await request("legal/impressum")).data.version, 2);
      const html =
        '<h2>Kontakt</h2><p><strong>Lokale Testfirma</strong> – Beispielangaben ausschließlich zur Prüfung formatierter Rechtstexte.</p><ul><li>Eintrag</li></ul><a href="https://example.test">Website</a><script>alert(1)</script>';
      assert.equal(
        (
          await request(
            "admin/legal-preview",
            { content: html, format: "html" },
            alice.cookie,
          )
        ).status,
        403,
      );
      const preview = await request(
        "admin/legal-preview",
        { content: html, format: "html" },
        admin.cookie,
      );
      assert.equal(preview.status, 200);
      assert.match(preview.data.html, /<strong>Lokale Testfirma<\/strong>/);
      assert.doesNotMatch(preview.data.html, /script|alert\(/);
      assert.equal(
        (
          await request(
            "admin/legal",
            { ...legal, content: html, format: "html" },
            admin.cookie,
          )
        ).status,
        200,
      );
      const formatted = await request("legal/impressum");
      assert.equal(formatted.data.version, 3);
      assert.equal(formatted.data.format, "html");
      assert.match(formatted.data.html, /<h2>Kontakt<\/h2>/);
      assert.doesNotMatch(formatted.data.content, /script|alert\(/);
      assert.equal(
        (
          await request(
            "admin/legal",
            {
              ...legal,
              content: "<p><br></p><script>" + "x".repeat(100) + "</script>",
              format: "html",
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal((await request("legal/impressum")).data.version, 3);
      assert.equal(
        (
          await request(
            "admin/legal",
            {
              ...legal,
              key: "cookies",
              content: html,
              format: "html",
              published: false,
            },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal((await request("legal/cookies")).status, 404);
      const previous = (
        await pool.query(
          "SELECT value FROM settings WHERE id='legal-history:impressum:2'",
        )
      ).rows[0].value;
      assert.equal(previous.format, "text");
      assert.match(previous.content, /Version zwei/);
      const analytics = {
        kind: "page",
        page: "/workspace/chat?private=secret",
        referrer: "https://example.test/path?secret=hidden",
        consent: true,
      };
      assert.equal(
        (await request("analytics/event", analytics, alice.cookie)).data
          .recorded,
        false,
      );
      assert.equal(
        (
          await request(
            "admin/site",
            {
              brand: "KeRnCloud",
              analyticsEnabled: true,
              analyticsRetention: 30,
            },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await request(
            "analytics/event",
            { ...analytics, consent: false },
            alice.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (await request("analytics/event", analytics, alice.cookie)).status,
        200,
      );
      assert.equal(
        (
          await request(
            "analytics/event",
            { ...analytics, kind: "click", target: "nav-chat" },
            alice.cookie,
          )
        ).status,
        200,
      );
      const range = {
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date(Date.now() + 86400000).toISOString(),
        bucket: "day",
        bots: "exclude",
      };
      const report = await request("admin/analytics", range, admin.cookie);
      assert.equal(report.status, 200);
      assert.equal(report.data.totals.users, 1);
      assert.equal(report.data.totals.clicks, 1);
      assert.equal(report.data.pages[0].page, "/workspace/chat");
      assert.equal(report.data.referrers[0].referrer, "example.test");
      assert.equal(
        (await request("admin/analytics", range, alice.cookie)).status,
        403,
      );
      const exp = await request("privacy/export", undefined, alice.cookie);
      assert.equal(exp.data.workspaces.length, 2);
      assert.ok(
        exp.data.workspaces.some((w: any) =>
          w.attachments.some((f: any) =>
            f.content.includes("FILE_CONTEXT_2026"),
          ),
        ),
      );
      assert.equal(exp.data.billingProfile.company, "Beispielfirma");
      assert.ok(!JSON.stringify(exp.data).includes("new-catalog-secret"));
    },
  );
  const { memoryTests } = await import("./memory.ts");
  const { contentTests } = await import("./content.ts");
  await contentTests(t, { request, pool, admin, alice });
  const { securityInfrastructureTests } =
    await import("./security-infrastructure.ts");
  await securityInfrastructureTests(t, {
    request,
    pool,
    handle,
    alice,
    bob,
    admin,
    a,
  });
  const { selfServiceTests } = await import("./self-service.ts");
  await selfServiceTests(t, { request, pool, handle, alice, bob, admin, a });
  await t.test(
    "API-Sprache folgt der manuellen Auswahl und lässt Workspace-Inhalte unverändert",
    async () => {
      const englishCookie = alice.cookie + "; kc_locale=en";
      const english = await request(
        "unknown-language-fixture-route",
        undefined,
        englishCookie,
      );
      assert.equal(english.status, 404);
      assert.equal(english.data.error, "Function not found.");
      const german = await request(
        "unknown-language-fixture-route",
        undefined,
        alice.cookie + "; kc_locale=de",
      );
      assert.equal(german.data.error, "Funktion nicht gefunden.");
      const invalid = await request("models", {}, englishCookie);
      assert.equal(invalid.status, 400);
      assert.equal(invalid.data.error, "Please check your input.");
      const enState = (await request("state", undefined, englishCookie)).data;
      const deState = (await request("state", undefined, alice.cookie)).data;
      assert.equal(enState.workspace.name, deState.workspace.name);
      assert.deepEqual(
        enState.agents.map((x: any) => [x.name, x.instructions]),
        deState.agents.map((x: any) => [x.name, x.instructions]),
      );
    },
  );
  const { agentEnvironmentTests } = await import("./agent-environments.ts");
  await agentEnvironmentTests(t, { request, pool, alice, bob, admin, a });
  await memoryTests(t, { request, pool, alice, bob, admin, a, b, fixtureUrl });
  await t.test(
    "Stripe bleibt deaktiviert, Secrets bleiben verborgen und Webhooks benötigen gültige Signaturen",
    async () => {
      assert.equal(
        (
          await request(
            "billing/checkout",
            { planId: "starter", termsAccepted: true },
            alice.cookie,
          )
        ).status,
        409,
      );
      const configured = await request(
        "admin/billing",
        {
          enabled: false,
          mode: "test",
          secret: "sk_test_local_fixture_only",
          webhookSecret: "whsec_fixture",
          returnUrl: "http://localhost:3100",
          automaticTax: false,
        },
        admin.cookie,
      );
      assert.equal(configured.status, 200, JSON.stringify(configured.data));
      assert.ok(
        !JSON.stringify(
          (await request("admin/site", undefined, admin.cookie)).data,
        ).includes("sk_test_local_fixture_only"),
      );
      assert.equal(
        (await request("billing/invoices", undefined, alice.cookie)).data
          .invoices.length,
        0,
      );
      async function webhook(signature: string, raw: string) {
        const r = await handle(
          new NextRequest("http://localhost:3100/api/billing/webhook", {
            method: "POST",
            headers: { "stripe-signature": signature },
            body: raw,
          }),
          "billing/webhook",
        );
        return r;
      }
      const raw = JSON.stringify({
        id: "evt_fixture",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: { id: "cs_fixture", customer: "cus_unknown" } },
      });
      assert.equal((await webhook("invalid", raw)).status, 400);
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload: raw,
        secret: "whsec_fixture",
      });
      assert.equal((await webhook(signature, raw)).status, 200);
      assert.equal((await webhook(signature, raw)).status, 200);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM billing_events WHERE id='evt_fixture'",
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await request(
            "billing/invoices/in_foreign/download",
            undefined,
            alice.cookie,
          )
        ).status,
        404,
      );
      const { applyStripeEvent } = await import("../../src/server/business.ts");
      await pool.query(
        "UPDATE accounts SET stripe_customer_id='cus_alice_fixture' WHERE id=$1",
        [a.workspace.account_id],
      );
      await pool.query(
        "UPDATE plans SET stripe_price_id='price_fixture' WHERE id='starter'",
      );
      const balance = (
        await pool.query("SELECT credits FROM accounts WHERE id=$1", [
          a.workspace.account_id,
        ])
      ).rows[0].credits;
      const subscription = {
        id: "sub_fixture",
        customer: "cus_alice_fixture",
        status: "active",
        items: { data: [{ price: { id: "price_fixture" } }] },
      } as unknown as Stripe.Subscription;
      const paid = {
        id: "evt_paid_fixture",
        type: "invoice.paid",
        data: {
          object: {
            id: "in_fixture",
            customer: "cus_alice_fixture",
            number: "KC-FIXTURE-01",
            status: "paid",
            currency: "eur",
            amount_due: 1900,
            billing_reason: "subscription_cycle",
            created: Math.floor(Date.now() / 1000),
            invoice_pdf: "https://pay.stripe.com/invoice/fixture/pdf",
          },
        },
      } as unknown as Stripe.Event;
      await applyStripeEvent(paid, subscription);
      await applyStripeEvent(
        { ...paid, id: "evt_other_delivery" },
        subscription,
      );
      assert.equal(
        (
          await pool.query("SELECT credits FROM accounts WHERE id=$1", [
            a.workspace.account_id,
          ])
        ).rows[0].credits,
        balance + 100000,
      );
      assert.equal(
        (await request("billing/invoices", undefined, alice.cookie)).data
          .invoices[0].number,
        "KC-FIXTURE-01",
      );
      assert.equal(
        (
          await request(
            "billing/invoices/in_fixture/download",
            undefined,
            bob.cookie,
          )
        ).status,
        404,
      );
      const canceled = {
        ...subscription,
        status: "canceled",
      } as Stripe.Subscription;
      await applyStripeEvent(
        {
          id: "evt_canceled_fixture",
          type: "customer.subscription.deleted",
          data: {
            object: { id: "sub_fixture", customer: "cus_alice_fixture" },
          },
        } as unknown as Stripe.Event,
        canceled,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT subscription_status FROM accounts WHERE id=$1",
            [a.workspace.account_id],
          )
        ).rows[0].subscription_status,
        "canceled",
      );
    },
  );
}
