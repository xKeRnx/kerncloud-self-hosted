import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyCompany } from "../src/core/company.ts";
import { prepareInvoice, creditInvoice } from "../src/core/einvoice.ts";
import { buildInvoiceFormats } from "../src/server/invoice-formats.ts";
const out = join(process.cwd(), "output/pdf");
await mkdir(out, { recursive: true });
const company = {
  ...emptyCompany,
  legalName: "KeRnCloud TESTDATEN",
  street: "Beispielstraße 1",
  postalCode: "10115",
  city: "Berlin",
  email: "invoice@example.invalid",
  phone: "+49 30 123456",
  taxNumber: "12/345/67890",
  version: 1,
};
const input = {
  buyer: {
    name: "Beispielkunde TESTDATEN",
    street: "Musterweg 7",
    postalCode: "20095",
    city: "Hamburg",
    country: "DE",
    email: "buyer@example.invalid",
    reference: "TEST-BUYER-123",
  },
  serviceStart: "2026-10-01",
  serviceEnd: "2026-10-31",
  dueDate: "2026-11-03",
  lines: [
    {
      description: "TESTDATEN: KeRnCloud Abonnement, ein Monat",
      quantityMilli: 1000,
      unitNetCents: 4900,
    },
  ],
  paymentText: "Testrechnung zur Formatprüfung. Keine Zahlungsaufforderung.",
  paidCents: 0,
};
const small = prepareInvoice(company, input, "TEST-2026-000001", "2026-10-20");
const regular = prepareInvoice(
  { ...company, taxTreatment: "regular", version: 2 },
  input,
  "TEST-2026-000002",
  "2026-10-20",
);
const credit = creditInvoice(small, "TEST-2026-000003", "2026-10-20");
for (const [name, doc] of [
  ["small-business", small],
  ["regular-vat", regular],
  ["credit-note", credit],
] as const) {
  try {
    const result = await buildInvoiceFormats(doc);
    for (const format of ["xrechnung", "facturx", "zugferd"] as const)
      await writeFile(
        join(out, `${name}.${format === "zugferd" ? "pdf" : format + ".xml"}`),
        result[format],
      );
    await writeFile(
      join(out, `${name}.reports.json`),
      JSON.stringify(result.reports, null, 2),
    );
    console.log(
      JSON.stringify({
        name,
        valid: true,
        pdfBytes: result.zugferd.length,
        validators: result.validators,
      }),
    );
  } catch (e: any) {
    await writeFile(
      join(out, `${name}.reports.json`),
      JSON.stringify(e.reports ?? { error: e.message }, null, 2),
    );
    console.error(JSON.stringify({ name, valid: false, error: e.message }));
    process.exitCode = 1;
    break;
  }
}
