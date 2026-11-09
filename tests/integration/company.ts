import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { emptyCompany } from "../../src/core/company.ts";
export async function companyTests(
  t: any,
  { request, pool, handle, admin }: any,
) {
  const proof = { password: "integration-admin-password", code: "" };
  const raw = async (path: string, cookie = admin.cookie) =>
    handle(
      new NextRequest("http://localhost:3100/api/" + path, {
        headers: { cookie },
      }),
      path.split("?")[0],
    );
  const company = {
    ...emptyCompany,
    legalName: "Fixture Owner & Example",
    street: "Teststraße 1",
    postalCode: "10115",
    city: "Berlin",
    email: "operator@fixture.invalid",
    phone: "+49 30 000000",
    website: "https://fixture.invalid",
    taxNumber: "PRIVATE-TAX-FIXTURE-000",
    disputeMode: "none",
    hosting: "Local fixture host; no external processing",
    processors: "Local SMTP fixture and mock payment/model providers only",
    transfers: "No external transfers in this isolated protocol fixture",
    retention: "Fixture data only; reset by the integration suite",
    authority: "Fixture supervisory authority, test address",
    authorityUrl: "https://authority.fixture.invalid",
    serviceTerms:
      "Monthly fixture plan; renews monthly, cancellable at period end. No real purchases.",
    checkoutReviewed: true,
  };
  let giftId = "",
    customer: any;
  await t.test(
    "Vorlagen verlangen vollständige Angaben; private Steuernummern bleiben aus öffentlichen Rechtstexten entfernt",
    async () => {
      const before = await raw("admin/legal-template?key=impressum&locale=de");
      assert.equal(before.status, 200);
      const draft = await before.json();
      assert.equal(draft.published, false);
      assert.match(draft.html, /BITTE ERGÄNZEN/);
      assert.equal(
        (
          await request(
            "admin/legal",
            { ...draft, published: true, reviewed: true },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal((await raw("admin/company", "")).status, 401);
      assert.equal(
        (
          await request(
            "admin/company",
            {
              company,
              reason: "Fixture company configuration",
              proof: { password: "wrong" },
            },
            admin.cookie,
          )
        ).status,
        401,
      );
      const saved = await request(
        "admin/company",
        { company, reason: "Fixture company configuration", proof },
        admin.cookie,
      );
      assert.equal(saved.status, 200, JSON.stringify(saved.data));
      for (const key of [
        "impressum",
        "datenschutz",
        "agb",
        "cookies",
        "widerruf",
      ])
        for (const locale of ["de", "en"]) {
          const r = await raw(
              `admin/legal-template?key=${key}&locale=${locale}`,
            ),
            template = await r.json();
          assert.equal(r.status, 200);
          assert.ok(!template.html.includes(company.taxNumber));
          assert.ok(!template.html.includes("ec.europa.eu/consumers/odr"));
          assert.equal(
            (
              await request(
                "admin/legal",
                { ...template, published: true, reviewed: false },
                admin.cookie,
              )
            ).status,
            400,
          );
          const published = await request(
            "admin/legal",
            { ...template, published: true, reviewed: true },
            admin.cookie,
          );
          assert.equal(published.status, 200, JSON.stringify(published.data));
        }
      const publicText = await raw("legal/impressum?lang=en", "");
      assert.equal(publicText.status, 200);
      const text = JSON.stringify(await publicText.json());
      assert.ok(text.includes("Fixture Owner"));
      assert.ok(!text.includes(company.taxNumber));
      assert.ok(!text.includes("{{company."));
      const invoice = await raw("admin/company/invoice-profile");
      const invoiceData = await invoice.json();
      assert.ok(invoiceData.issuer.includes(company.taxNumber));
      assert.equal(invoiceData.taxTreatment, "small_business");
    },
  );
  await t.test(
    "Firmendaten aktualisieren verknüpfte Texte mit Historie; alte Geschenkbelege behalten ihren Aussteller",
    async () => {
      customer = (
        await pool.query(
          "SELECT id FROM users WHERE email='managed-customer@test.local'",
        )
      ).rows[0];
      assert.ok(customer);
      giftId = randomUUID();
      const grant = await request(
        "admin/customers/" + customer.id,
        {
          action: "grant",
          id: giftId,
          kind: "goodwill",
          credits: 1,
          minutes: 0,
          receipt: true,
          reason: "Fixture issuer snapshot",
          proof,
        },
        admin.cookie,
      );
      assert.equal(grant.status, 200, JSON.stringify(grant.data));
      const old = (
        await pool.query(
          "SELECT value FROM settings WHERE id='legal:impressum'",
        )
      ).rows[0].value;
      const changed = await request(
        "admin/company",
        {
          company: {
            ...company,
            legalName: "New Fixture Owner <script>not executable</script>",
          },
          reason: "Fixture renamed operator",
          proof,
        },
        admin.cookie,
      );
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      const current = (
        await pool.query(
          "SELECT value FROM settings WHERE id='legal:impressum'",
        )
      ).rows[0].value;
      assert.equal(current.version, old.version + 1);
      const archive = (
        await pool.query("SELECT value FROM settings WHERE id=$1", [
          "legal-history:impressum:" + old.version,
        ])
      ).rows[0].value;
      assert.ok(
        archive.rendered_content.includes("Fixture Owner &amp; Example"),
      );
      const publicPage = await raw("legal/impressum", "");
      const html = (await publicPage.json()).html;
      assert.ok(html.includes("New Fixture Owner"));
      assert.ok(!html.includes("<script>"));
      const receipt = await raw(
        `admin/customers/${customer.id}/grants/${giftId}`,
      );
      assert.equal(receipt.status, 200);
      const receiptHtml = await receipt.text();
      assert.ok(receiptHtml.includes("Fixture Owner &amp; Example"));
      assert.ok(!receiptHtml.includes("New Fixture Owner"));
      assert.equal((await raw("admin/company/invoice-preview")).status, 200);
    },
  );
  await t.test(
    "Öffentliche Kündigung und Widerruf erfassen genau einmal den Eingang, ohne fremde Verträge preiszugeben oder Stripe zu ändern",
    async () => {
      const id = randomUUID(),
        body = {
          id,
          kind: "cancel",
          name: "Protocol fixture consumer",
          email: "managed-customer@test.local",
          contract: "Unknown fixture contract; no account enumeration",
          terminationType: "ordinary",
          requestedEnd: "",
        };
      const [first, second] = await Promise.all([
        request("contracts/declarations", body),
        request("contracts/declarations", body),
      ]);
      assert.equal(first.status, 200, JSON.stringify(first.data));
      assert.equal(second.status, 200, JSON.stringify(second.data));
      assert.equal(first.data.receivedAt, second.data.receivedAt);
      assert.match(first.data.statement, /jetzt kündigen/);
      assert.match(first.data.statement, /nächstmöglich/);
      assert.equal(
        (
          await request("contracts/declarations", {
            ...body,
            contract: "different",
          })
        ).status,
        409,
      );
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) n FROM contract_declarations WHERE id=$1",
              [id],
            )
          ).rows[0].n,
        ),
        1,
      );
      const row = (
        await pool.query("SELECT * FROM contract_declarations WHERE id=$1", [
          id,
        ])
      ).rows[0];
      assert.ok(row.confirmation_id);
      const queued = (
        await pool.query("SELECT payload,status FROM mail_outbox WHERE id=$1", [
          row.confirmation_id,
        ])
      ).rows[0];
      assert.equal(queued.status, "queued");
      assert.ok(!queued.payload.includes(body.contract));
      const withdrawal = await request("contracts/declarations", {
        ...body,
        id: randomUUID(),
        kind: "withdraw",
      });
      assert.equal(withdrawal.status, 200);
      assert.match(withdrawal.data.statement, /Widerruf bestätigen/);
      const list = await raw("admin/contracts");
      const listed = await list.json();
      assert.ok(listed.rows.length >= 2);
      assert.ok(!JSON.stringify(listed).includes("fingerprint"));
      assert.ok(!JSON.stringify(listed).includes("payload"));
      assert.equal((await raw("admin/contracts", "")).status, 401);
      const stripeBefore = (
        await pool.query(
          "SELECT stripe_subscription_id,subscription_status FROM accounts WHERE owner_id=$1",
          [customer.id],
        )
      ).rows[0];
      assert.equal(
        (
          await request(
            "admin/contracts",
            { id, reason: "Fixture processed; no Stripe action", proof },
            admin.cookie,
          )
        ).status,
        200,
      );
      assert.deepEqual(
        (
          await pool.query(
            "SELECT stripe_subscription_id,subscription_status FROM accounts WHERE owner_id=$1",
            [customer.id],
          )
        ).rows[0],
        stripeBefore,
      );
      const login = await request("auth/login", {
        email: body.email,
        password: "managed-after-mail-password",
      });
      const exported = await request("privacy/export", undefined, login.cookie);
      assert.equal(exported.status, 200);
      assert.equal(exported.data.contract_declarations.length, 2);
    },
  );
  await t.test(
    "Unvollständige Firmenänderung nimmt Platzhalterseiten aus der Veröffentlichung; Live-Verkauf bleibt gesperrt",
    async () => {
      const changed = await request(
        "admin/company",
        {
          company: { ...company, email: "" },
          reason: "Fixture incomplete company profile",
          proof,
        },
        admin.cookie,
      );
      assert.equal(changed.status, 200);
      const legal = (
        await pool.query(
          "SELECT value FROM settings WHERE id='legal:impressum'",
        )
      ).rows[0].value;
      assert.equal(legal.published, false);
      const { assertCompanyCheckout } =
        await import("../../src/server/company.ts");
      await assert.rejects(
        () => assertCompanyCheckout("live"),
        (e: any) => e.status === 409,
      );
      await request(
        "admin/company",
        { company, reason: "Fixture restore complete profile", proof },
        admin.cookie,
      );
    },
  );
  await t.test(
    "Rechnungsprofil-Synchronisation arbeitet einmalig und getrennt von Zahlungen mit einer lokalen Anbieter-Fixture",
    async () => {
      const { syncInvoiceProfiles } =
        await import("../../src/server/invoice-profile-sync.ts");
      const { encrypt } = await import("../../src/server/security.ts");
      const profile = (
        await pool.query("SELECT value FROM settings WHERE id='company'")
      ).rows[0].value;
      const account = (
        await pool.query("SELECT id FROM accounts WHERE owner_id=$1", [
          customer.id,
        ])
      ).rows[0].id;
      const id = randomUUID();
      await pool.query(
        "INSERT INTO invoice_profile_jobs(id,account_id,company_version,customer_id,footer) VALUES($1,$2,$3,'cus_local_fixture',$4)",
        [id, account, profile.version, encrypt("Local invoice footer fixture")],
      );
      let calls = 0;
      const update = async (
        customerId: string,
        footer: string,
        key: string,
      ) => {
        assert.equal(customerId, "cus_local_fixture");
        assert.equal(footer, "Local invoice footer fixture");
        assert.equal(key, "kc-issuer-" + id);
        calls++;
      };
      await Promise.all([
        syncInvoiceProfiles(update),
        syncInvoiceProfiles(update),
      ]);
      await syncInvoiceProfiles(update);
      assert.equal(calls, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT status FROM invoice_profile_jobs WHERE id=$1",
            [id],
          )
        ).rows[0].status,
        "done",
      );
      assert.equal(
        (
          await request("worker/maintenance", {
            workerId: "unauthorised-fixture",
          })
        ).status,
        401,
      );
    },
  );
}
