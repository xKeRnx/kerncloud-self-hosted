import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyCompany,
  resolveCompanyText,
  invoiceIssuer,
} from "../src/core/company.ts";
test("Öffentliche Firmenplatzhalter können keine private Steuernummer oder HTML-Aktion einschleusen", () => {
  const c = {
    ...emptyCompany,
    legalName: "<img src=x onerror=attack()>",
    taxNumber: "private-tax-number",
  };
  const rendered = resolveCompanyText(
    "<p>{{company.legalName}} {{company.taxNumber}}</p>",
    c,
  );
  assert.ok(!rendered.text.includes("<img"));
  assert.ok(!rendered.text.includes(c.taxNumber));
  assert.deepEqual(rendered.unresolved, ["taxNumber"]);
  assert.match(invoiceIssuer(c), /private-tax-number/);
});
