import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { emptyCompany, invoiceIssuer } from "../../src/core/company.ts";
export async function einvoiceTests(
  t: any,
  { request, pool, handle, admin }: any,
) {
  const { processEinvoice, queueStripeEinvoice, importStripeEinvoice } =
    await import("../../src/server/einvoices.ts");
  const { decrypt } = await import("../../src/server/security.ts");
  const { transaction } = await import("../../src/server/db.ts");
  const proof = { password: "integration-admin-password", code: "" };
  const c = {
    ...emptyCompany,
    legalName: "Invoice TEST SELLER",
    street: "Teststraße 1",
    postalCode: "10115",
    city: "Berlin",
    email: "seller@example.invalid",
    phone: "+49 30 123456",
    taxNumber: "12/345/67890",
    version: 200,
  };
  const saved = (
    await pool.query("SELECT value FROM settings WHERE id='company'")
  ).rows[0]?.value;
  const customer = await request("auth/signup", {
    email: "invoice-customer@test.local",
    password: "invoice-customer-password",
    name: "Invoice customer",
    privacyAccepted: true,
  });
  const foreign = await request("auth/signup", {
    email: "invoice-foreign@test.local",
    password: "invoice-foreign-password",
    name: "Other customer",
    privacyAccepted: true,
  });
  const state = await request("state", undefined, customer.cookie),
    account = state.data.workspace.account_id;
  const input = {
    buyer: {
      name: "Invoice TEST BUYER",
      street: "Musterweg 2",
      postalCode: "20095",
      city: "Hamburg",
      country: "DE",
      email: "buyer@example.invalid",
      reference: "TEST-BUYER",
    },
    serviceStart: "2026-10-01",
    serviceEnd: "2026-10-31",
    dueDate: "2099-01-01",
    lines: [
      {
        description: "TEST service, one month",
        quantityMilli: 1000,
        unitNetCents: 4900,
      },
    ],
    paidCents: 0,
    paymentText: "TESTDATEN - keine reale Forderung",
  };
  const raw = (path: string, cookie = customer.cookie) =>
    handle(
      new NextRequest("http://localhost:3100/api/" + path, {
        headers: { cookie },
      }),
      path,
    );
  let companyVersion = 200;
  const issue = (id: string, extra: any = {}) =>
    request(
      "admin/einvoices",
      {
        id,
        action: "issue",
        accountId: account,
        invoice: input,
        expectedCompanyVersion: companyVersion,
        expectedGrossCents: companyVersion === 200 ? 4900 : 5831,
        confirmEmail: input.buyer.email,
        reason: "Local invoice protocol fixture",
        proof,
        ...extra,
      },
      admin.cookie,
    );
  const waitIssued = async (id: string) => {
    await processEinvoice();
    for (let n = 0; n < 160; n++) {
      const row = (
        await pool.query("SELECT * FROM einvoices WHERE id=$1", [id])
      ).rows[0];
      if (row.status === "issued") return row;
      if (row.status === "failed") {
        assert.fail(
          JSON.stringify({
            error: row.error,
            reports: JSON.parse(decrypt(row.reports)),
          }),
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.fail("Invoice job did not finish");
  };
  let original: any, regular: any, originalBytes: Buffer;
  try {
    await pool.query("UPDATE settings SET value=$1 WHERE id='company'", [c]);
    await t.test(
      "E-Rechnungen: Adminnachweis, Empfängerbestätigung und idempotente Nummernvergabe",
      async () => {
        assert.equal(
          (await request("admin/einvoices", undefined, customer.cookie)).status,
          403,
        );
        assert.equal(
          (
            await issue(randomUUID(), {
              proof: { password: "incorrect" },
              reason: "Missing admin proof fixture",
            })
          ).status,
          401,
        );
        assert.equal(
          (await issue(randomUUID(), { confirmEmail: "wrong@example.invalid" }))
            .status,
          400,
        );
        assert.equal(
          (await issue(randomUUID(), { expectedCompanyVersion: 199 })).status,
          409,
        );
        const id = randomUUID();
        assert.equal((await issue(id)).status, 200);
        assert.equal((await issue(id)).status, 200);
        assert.equal(
          (await issue(id, { invoice: { ...input, paidCents: 1 } })).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM einvoices WHERE id=$1",
              [id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (await raw(`billing/einvoices/${id}/zugferd.pdf`)).status,
          409,
        );
        // Changing tax settings after queuing must never change the frozen invoice.
        await pool.query("UPDATE settings SET value=$1 WHERE id='company'", [
          { ...c, taxTreatment: "regular", version: 201 },
        ]);
        companyVersion = 201;
        original = await waitIssued(id);
        const doc = JSON.parse(decrypt(original.document));
        assert.equal(doc.vatCents, 0);
        assert.equal(doc.grossCents, 4900);
      },
    );
    await t.test(
      "Geprüfte ZUGFeRD-/XRechnung-Downloads sind mandantengetrennt und unveränderlich",
      async () => {
        const response = await raw(
          `billing/einvoices/${original.id}/zugferd.pdf`,
        );
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-type") ?? "",
          /application\/pdf/,
        );
        assert.match(response.headers.get("cache-control") ?? "", /no-store/);
        originalBytes = Buffer.from(await response.arrayBuffer());
        assert.equal(
          createHash("sha256").update(originalBytes).digest("hex"),
          original.hashes.zugferd,
        );
        const xml = await raw(`billing/einvoices/${original.id}/xrechnung.xml`);
        assert.equal(xml.status, 200);
        assert.match(await xml.text(), /§ 19 UStG/);
        assert.equal(
          (
            await raw(
              `billing/einvoices/${original.id}/zugferd.pdf`,
              foreign.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (await raw("billing/einvoices", foreign.cookie)).status,
          200,
        );
        assert.equal(
          (await (await raw("billing/einvoices", foreign.cookie)).json())
            .invoices.length,
          0,
        );
        await assert.rejects(
          pool.query("UPDATE einvoices SET document='changed' WHERE id=$1", [
            original.id,
          ]),
          /immutable/,
        );
        await assert.rejects(
          pool.query("DELETE FROM einvoices WHERE id=$1", [original.id]),
          /retained/,
        );
        assert.deepEqual(
          Buffer.from(
            await (
              await raw(`billing/einvoices/${original.id}/zugferd.pdf`)
            ).arrayBuffer(),
          ),
          originalBytes,
        );
      },
    );
    await t.test(
      "Späterer Steuerwechsel gilt nur für neue Rechnungen; Storno verwendet ursprüngliche Steuer",
      async () => {
        const id = randomUUID();
        assert.equal((await issue(id)).status, 200);
        regular = await waitIssued(id);
        assert.equal(JSON.parse(decrypt(regular.document)).vatCents, 931);
        const creditId = randomUUID();
        assert.equal(
          (
            await request(
              "admin/einvoices",
              {
                id: creditId,
                action: "credit",
                originalId: original.id,
                confirmNumber: original.number,
                reason: "Complete fixture reversal",
                proof,
              },
              admin.cookie,
            )
          ).status,
          200,
        );
        const credit = await waitIssued(creditId),
          doc = JSON.parse(decrypt(credit.document));
        assert.equal(doc.vatCents, 0);
        assert.equal(doc.original.number, original.number);
        assert.equal(Number(credit.amount), -4900);
        assert.equal(
          (
            await request(
              "admin/einvoices",
              {
                id: randomUUID(),
                action: "credit",
                originalId: original.id,
                confirmNumber: original.number,
                reason: "Duplicate reversal fixture",
                proof,
              },
              admin.cookie,
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      "Stripe-Abgleich übernimmt dieselbe Rechnungsnummer, blockiert Widersprüche und erzeugt keine Zahlung",
      async () => {
        // Import complete finalized data only, while Stripe is disabled. Never access an external API.
        const number = "STRIPE-TEST-" + randomUUID().slice(0, 8),
          id = "in_" + randomUUID(),
          stamp = Math.floor(Date.now() / 1000);
        const invoice = {
          id,
          number,
          status: "paid",
          currency: "eur",
          created: stamp,
          status_transitions: { finalized_at: stamp },
          customer_name: input.buyer.name,
          customer_email: input.buyer.email,
          customer_address: {
            line1: input.buyer.street,
            postal_code: input.buyer.postalCode,
            city: input.buyer.city,
            country: "DE",
          },
          footer: invoiceIssuer({
            ...c,
            taxTreatment: "regular",
            version: 201,
          }),
          total: 5831,
          total_excluding_tax: 4900,
          total_taxes: [{ amount: 931 }],
          lines: {
            has_more: false,
            data: [
              {
                description: "Stripe TEST position",
                subtotal: 4900,
                discount_amounts: [],
                period: { start: stamp, end: stamp },
                quantity: 1,
              },
            ],
          },
        };
        await pool.query(
          "INSERT INTO invoices(id,account_id,number,status,currency,amount) VALUES($1,$2,$3,'paid','eur',5831)",
          [id, account, number],
        );
        await transaction(async (tx) => {
          await queueStripeEinvoice(tx, account, invoice);
          await queueStripeEinvoice(tx, account, invoice);
        });
        for (let n = 0; n < 30; n++) await importStripeEinvoice();
        const imported = (
          await pool.query("SELECT * FROM einvoices WHERE source_id=$1", [id])
        ).rows;
        assert.equal(imported.length, 1);
        assert.equal(imported[0].number, number);
        assert.equal(JSON.parse(decrypt(imported[0].document)).dueCents, 0);
        // Validate it through the same production generation path.
        await waitIssued(imported[0].id);
        const badId = "in_" + randomUUID();
        await pool.query(
          "INSERT INTO invoices(id,account_id,number,status,currency,amount) VALUES($1,$2,$3,'paid','eur',5832)",
          [badId, account, number + "BAD"],
        );
        await transaction((tx) =>
          queueStripeEinvoice(tx, account, {
            ...invoice,
            id: badId,
            number: number + "BAD",
            total: 5832,
          }),
        );
        await importStripeEinvoice();
        assert.equal(
          (
            await pool.query(
              "SELECT status FROM stripe_einvoice_jobs WHERE invoice_id=$1",
              [badId],
            )
          ).rows[0].status,
          "blocked",
        );
        assert.equal(
          (
            await pool.query("SELECT 1 FROM einvoices WHERE source_id=$1", [
              badId,
            ])
          ).rowCount,
          0,
        );
      },
    );
    await t.test(
      "Rechnungsanschrift wird exportiert, Kontolöschung erhält die gesetzlichen Belege ohne fremden Zugriff",
      async () => {
        assert.equal(
          (await request("billing/recipient", input.buyer, customer.cookie))
            .status,
          200,
        );
        const exported = await request(
          "privacy/export",
          undefined,
          customer.cookie,
        );
        assert.deepEqual(exported.data.billingRecipient.buyer, input.buyer);
        assert.ok(exported.data.electronicInvoices.length >= 3);
        assert.equal(
          (
            await request(
              "privacy/delete",
              {
                password: "invoice-customer-password",
                confirmation: "KONTO LÖSCHEN",
              },
              customer.cookie,
            )
          ).status,
          200,
        );
        const retained = (
          await pool.query(
            "SELECT account_id,status FROM einvoices WHERE id=$1",
            [original.id],
          )
        ).rows[0];
        assert.equal(retained.account_id, null);
        assert.equal(retained.status, "issued");
        assert.equal(
          (
            await raw(
              `billing/einvoices/${original.id}/zugferd.pdf`,
              foreign.cookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await raw(
              `admin/einvoices/${original.id}/zugferd.pdf`,
              admin.cookie,
            )
          ).status,
          200,
        );
      },
    );
  } finally {
    await pool.query("UPDATE settings SET value=$1 WHERE id='company'", [
      saved ?? emptyCompany,
    ]);
  }
}
