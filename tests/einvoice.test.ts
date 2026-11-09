import test from "node:test";
import assert from "node:assert/strict";
import { emptyCompany } from "../src/core/company.ts";
import {
  prepareInvoice,
  invoiceXml,
  creditInvoice,
  lineAmount,
  SMALL_BUSINESS_NOTE,
} from "../src/core/einvoice.ts";
const company = {
  ...emptyCompany,
  legalName: "Test seller",
  street: "Testweg 1",
  postalCode: "10115",
  city: "Berlin",
  email: "seller@example.invalid",
  phone: "+49 30 123",
  taxNumber: "12/345/67890",
  version: 1,
};
const input = {
  buyer: {
    name: "Test buyer",
    street: "Musterweg 2",
    postalCode: "10115",
    city: "Berlin",
    country: "DE",
    email: "buyer@example.invalid",
    reference: "TEST-REF",
  },
  serviceStart: "2026-10-01",
  serviceEnd: "2026-10-31",
  dueDate: "2026-11-03",
  lines: [
    { description: "Monthly service", quantityMilli: 1000, unitNetCents: 4900 },
  ],
  paidCents: 0,
};
test("Kleinunternehmer: Steuerbefreiung E mit §19-Hinweis, keine Umsatzsteuer und keine rückwirkende Änderung", () => {
  const c = { ...company },
    d = prepareInvoice(c, input, "TEST-1", "2026-10-20");
  c.taxTreatment = "regular";
  assert.equal(d.vatCents, 0);
  assert.equal(d.grossCents, 4900);
  assert.equal(d.taxTreatment, "small_business");
  const xml = invoiceXml(d, "xrechnung");
  assert.match(xml, /<ram:CategoryCode>E<\/ram:CategoryCode>/);
  assert.ok(xml.includes(SMALL_BUSINESS_NOTE));
  assert.match(xml, /xrechnung_3.0/);
});
test("Regelbesteuerung rechnet centgenau; bereits gezahlte Beträge ändern die Steuer nicht", () => {
  const d = prepareInvoice(
    { ...company, taxTreatment: "regular" },
    { ...input, paidCents: 1000 },
    "TEST-2",
    "2026-10-20",
  );
  assert.equal(d.netCents, 4900);
  assert.equal(d.vatCents, 931);
  assert.equal(d.grossCents, 5831);
  assert.equal(d.dueCents, 4831);
  assert.equal(lineAmount(333, 101), 34);
  assert.equal(lineAmount(1, 500), 1);
});
test("Rechnungskorrektur behält den ursprünglichen Aussteller und Steuerstand mit Referenz", () => {
  const d = prepareInvoice(company, input, "TEST-3", "2026-10-20"),
    credit = creditInvoice(d, "TEST-4", "2026-10-21");
  assert.deepEqual(credit.seller, d.seller);
  assert.equal(credit.vatRate, 0);
  assert.equal(credit.original?.number, "TEST-3");
  assert.equal(credit.type, "credit_note");
  assert.match(invoiceXml(credit, "xrechnung"), /<ram:TypeCode>381/);
  assert.throws(() => creditInvoice(credit, "TEST-5", "2026-10-22"));
});
test("Unvollständige und nicht unterstützte Steuerfälle werden vor Ausstellung abgewiesen", () => {
  for (const data of [
    { ...input, buyer: { ...input.buyer, country: "FR" } },
    { ...input, serviceEnd: "2026-02-30" },
    { ...input, paidCents: 999999 },
    { ...input, lines: [{ ...input.lines[0], unitNetCents: -1 }] },
    { ...input, serviceEnd: "2026-09-01" },
  ])
    assert.throws(() => prepareInvoice(company, data, "TEST", "2026-10-20"));
  assert.throws(() =>
    prepareInvoice(
      { ...company, taxNumber: "", vatId: "" },
      input,
      "TEST",
      "2026-10-20",
    ),
  );
});
test("XML-Inhalte sind escaped, Steuerzeichen werden abgewiesen und Formatvarianten teilen dieselben Beträge", () => {
  const d = prepareInvoice(
    company,
    { ...input, buyer: { ...input.buyer, name: "A & <script>" } },
    "TEST",
    "2026-10-20",
  );
  for (const profile of ["facturx", "xrechnung"] as const) {
    const xml = invoiceXml(d, profile);
    assert.ok(xml.includes("A &amp; &lt;script&gt;"));
    assert.ok(!xml.includes("<script>"));
    assert.ok(
      xml.includes("<ram:GrandTotalAmount>49.00</ram:GrandTotalAmount>"),
    );
  }
  assert.throws(() =>
    prepareInvoice(
      company,
      { ...input, buyer: { ...input.buyer, name: "Bad\u0000buyer" } },
      "TEST",
      "2026-10-20",
    ),
  );
});
