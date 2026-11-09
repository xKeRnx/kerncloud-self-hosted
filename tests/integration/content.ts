import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
export async function contentTests(
  t: TestContext,
  { request, pool, admin, alice }: Record<string, any>,
) {
  await t.test(
    "Sprachverwaltung, lokalisierte Seiten und Entwurfsisolation",
    async () => {
      assert.equal(
        (
          await request(
            "admin/languages",
            { enabled: ["de", "en"], defaultLocale: "en" },
            alice.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await request("admin/pages", undefined, alice.cookie)).status,
        403,
      );
      assert.equal(
        (
          await request(
            "admin/languages",
            { enabled: [], defaultLocale: "de" },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "admin/languages",
            { enabled: ["de"], defaultLocale: "en" },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "admin/languages",
            { enabled: ["de", "en"], defaultLocale: "de" },
            admin.cookie,
          )
        ).status,
        200,
      );
      const block = {
        id: randomUUID(),
        type: "text",
        content:
          '<h2>HELLO_PUBLIC_DE</h2><p onclick="evil()">Safe <strong>text</strong></p><script>SECRET_EVIL</script>',
        label: "",
        href: "",
      };
      const draft = {
        slug: "integration-about",
        placements: ["header", "footer", "workspace"],
        sortOrder: 7,
        translations: {
          de: {
            title: "Über uns",
            description: "Deutsche Seite",
            published: true,
            blocks: [block],
          },
          en: {
            title: "PRIVATE_EN_DRAFT",
            description: "",
            published: false,
            blocks: [
              {
                ...block,
                id: randomUUID(),
                content: "<p>PRIVATE_EN_CONTENT</p>",
              },
            ],
          },
        },
      };
      assert.equal(
        (await request("admin/pages", draft, alice.cookie)).status,
        403,
      );
      const created = await request("admin/pages", draft, admin.cookie);
      assert.equal(created.status, 200, JSON.stringify(created.data));
      let page = (
        await request("admin/pages", undefined, admin.cookie)
      ).data.pages.find((p: any) => p.id === created.data.id);
      assert.equal(page.version, 1);
      let site = (await request("site")).data;
      assert.equal(site.customPages.length, 1);
      assert.equal(site.customPages[0].title, "Über uns");
      assert.ok(!JSON.stringify(site).includes("PRIVATE_EN"));
      assert.ok(!JSON.stringify(site).includes("HELLO_PUBLIC_DE"));
      const publicDe = await request("pages/integration-about");
      assert.equal(publicDe.status, 200);
      assert.match(publicDe.data.blocks[0].content, /<strong>text<\/strong>/);
      assert.ok(
        !publicDe.data.blocks[0].content.match(/onclick|<script|SECRET_EVIL/),
      );
      assert.equal(
        (await request("pages/integration-about", undefined, "kc_locale=en"))
          .status,
        404,
      );
      assert.equal(
        (
          await request(
            "admin/pages",
            { ...draft, slug: "../bad" },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "admin/pages",
            {
              ...draft,
              slug: "integration-evil",
              translations: {
                ...draft.translations,
                de: {
                  ...draft.translations.de,
                  blocks: [
                    {
                      ...block,
                      type: "cta",
                      label: "Bad",
                      href: "javascript:alert(1)",
                    },
                  ],
                },
              },
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "admin/pages",
            {
              ...draft,
              slug: "integration-evil",
              translations: {
                ...draft.translations,
                de: {
                  ...draft.translations.de,
                  blocks: [
                    {
                      ...block,
                      type: "cta",
                      label: "Bad",
                      href: "/\\evil.test",
                    },
                  ],
                },
              },
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      page.translations.en = {
        title: "About us",
        description: "English page",
        published: true,
        blocks: [
          {
            ...block,
            id: randomUUID(),
            type: "cta",
            content: "<p>HELLO_PUBLIC_EN</p>",
            label: "Start",
            href: "/signup",
          },
        ],
      };
      assert.equal(
        (await request("admin/pages", page, admin.cookie)).status,
        200,
      );
      assert.equal(
        (await request("admin/pages", page, admin.cookie)).status,
        409,
      );
      assert.ok(
        (
          await pool.query("SELECT 1 FROM settings WHERE id=$1", [
            `content-history:${page.id}:1`,
          ])
        ).rowCount,
      );
      assert.equal(
        (await request("pages/integration-about", undefined, "kc_locale=en"))
          .data.title,
        "About us",
      );
      assert.equal(
        (await request("admin/pages", draft, admin.cookie)).status,
        409,
      );
      assert.equal(
        (
          await request(
            "admin/languages",
            { enabled: ["de"], defaultLocale: "de" },
            admin.cookie,
          )
        ).status,
        200,
      );
      site = (await request("site")).data;
      assert.equal(site.customPages.length, 1);
      assert.equal(site.languages.enabled[0], "de");
      assert.equal(
        (
          await request(
            "admin/languages",
            { enabled: ["de", "en"], defaultLocale: "de" },
            admin.cookie,
          )
        ).status,
        200,
      );
      const englishLegal = {
        key: "impressum",
        locale: "en",
        title: "Legal notice",
        format: "html",
        published: true,
        content:
          "<h2>ENGLISH_LEGAL</h2><p>This is a published English legal test fixture for integration checks.</p>",
      };
      assert.equal(
        (await request("admin/legal", englishLegal, admin.cookie)).status,
        200,
      );
      assert.match(
        (await request("legal/impressum", undefined, "kc_locale=en")).data
          .content,
        /ENGLISH_LEGAL/,
      );
      assert.ok(
        !(await request("legal/impressum")).data.content.includes(
          "ENGLISH_LEGAL",
        ),
      );
      page = (
        await request("admin/pages", undefined, admin.cookie)
      ).data.pages.find((p: any) => p.id === created.data.id);
      assert.equal(
        (
          await request(
            "admin/pages",
            { ...page, archived: true },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.equal((await request("pages/integration-about")).status, 404);
      assert.equal((await request("site")).data.customPages.length, 0);
    },
  );
  await t.test(
    "Analytics: rollierende 24h/30d/365d, Bots und stündliche Details",
    async () => {
      assert.equal(
        (await request("admin/analytics-summary", undefined, alice.cookie))
          .status,
        403,
      );
      const [oldSite] = (
        await pool.query("SELECT value FROM settings WHERE id='site'")
      ).rows;
      await request(
        "admin/site",
        { brand: "KeRnCloud", analyticsEnabled: true, analyticsRetention: 365 },
        admin.cookie,
      );
      const before = (
        await request("admin/analytics-summary", undefined, admin.cookie)
      ).data;
      const fixture = "/analytics-window-fixture";
      for (const [hours, bot] of [
        [2, false],
        [48, false],
        [960, false],
        [2, true],
      ])
        await pool.query(
          "INSERT INTO analytics_events(kind,page,target,referrer,bot,created_at) VALUES('page',$1,'','',$2,now()-($3*interval '1 hour'))",
          [fixture, bot, hours],
        );
      const report = await request(
        "admin/analytics-summary",
        undefined,
        admin.cookie,
      );
      assert.equal(report.status, 200);
      assert.equal(report.data.retentionDays, 365);
      for (const [i, increment] of [1, 2, 3].entries()) {
        const a = report.data.periods[i],
          b = before.periods[i];
        assert.equal(a.views - b.views, increment);
        assert.equal(Date.parse(a.to) - Date.parse(a.from), a.days * 86400000);
      }
      const range = {
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date().toISOString(),
        bucket: "hour",
        bots: "exclude",
      };
      const hourly = await request("admin/analytics", range, admin.cookie);
      assert.equal(hourly.status, 200);
      assert.equal(
        hourly.data.pages.find((p: any) => p.page === fixture).count,
        1,
      );
      const bots = await request(
        "admin/analytics",
        { ...range, bots: "only" },
        admin.cookie,
      );
      assert.equal(
        bots.data.pages.find((p: any) => p.page === fixture).count,
        1,
      );
      assert.equal(
        (
          await request(
            "admin/analytics",
            {
              ...range,
              from: new Date(Date.now() - 32 * 86400000).toISOString(),
            },
            admin.cookie,
          )
        ).status,
        400,
      );
      await pool.query("DELETE FROM analytics_events WHERE page=$1", [fixture]);
      await request("admin/site", oldSite.value, admin.cookie);
    },
  );
}
