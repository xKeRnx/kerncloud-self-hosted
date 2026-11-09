import { z } from "zod";
import type { Company } from "./company.ts";

const text = (max = 200) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/.test(v),
      "Ungültige Steuerzeichen",
    );
export const invoiceDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Ungültiges Datum");
export const buyerSchema = z.object({
  name: text(),
  street: text(),
  postalCode: text(20),
  city: text(100),
  country: z.literal("DE").default("DE"),
  email: z.string().trim().email().max(254),
  reference: text(100),
});
export type InvoiceBuyer = z.infer<typeof buyerSchema>;
export const invoiceInputSchema = z.object({
  buyer: buyerSchema,
  serviceStart: invoiceDate,
  serviceEnd: invoiceDate,
  dueDate: invoiceDate,
  lines: z
    .array(
      z.object({
        description: text(600),
        quantityMilli: z.number().int().min(1).max(1000000000),
        unitNetCents: z.number().int().min(0).max(100000000),
      }),
    )
    .min(1)
    .max(100),
  paidCents: z.number().int().min(0).max(10000000000).default(0),
  paymentText: text(500).default(
    "Zahlbar bis zum angegebenen Fälligkeitsdatum.",
  ),
});
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;
export type InvoiceDocument = InvoiceInput & {
  number: string;
  issueDate: string;
  type: "invoice" | "credit_note";
  currency: "EUR";
  seller: {
    name: string;
    street: string;
    postalCode: string;
    city: string;
    country: "DE";
    email: string;
    phone: string;
    taxNumber: string;
    vatId: string;
  };
  companyVersion: number;
  taxTreatment: "small_business" | "regular";
  vatRate: 0 | 19;
  netCents: number;
  vatCents: number;
  grossCents: number;
  dueCents: number;
  lineNetCents: number[];
  original?: { number: string; issueDate: string };
};
export const SMALL_BUSINESS_NOTE =
  "Steuerbefreiung für Kleinunternehmer gemäß § 19 UStG. Es wird keine Umsatzsteuer berechnet.";
export function money(cents: number) {
  return (cents / 100).toFixed(2);
}
export function lineAmount(quantityMilli: number, unitNetCents: number) {
  return Number((BigInt(quantityMilli) * BigInt(unitNetCents) + 500n) / 1000n);
}
export function prepareInvoice(
  company: Company,
  input: unknown,
  number: string,
  issueDate: string,
): InvoiceDocument {
  invoiceDate.parse(issueDate);
  const parsed = invoiceInputSchema.parse(input);
  const limits = {
    legalName: 200,
    street: 200,
    postalCode: 20,
    city: 100,
    email: 254,
    phone: 80,
  };
  for (const key of [
    "legalName",
    "street",
    "postalCode",
    "city",
    "email",
    "phone",
  ] as const)
    text(limits[key]).parse(company[key]);
  z.string().email().parse(company.email);
  if (!company.taxNumber && !company.vatId)
    throw new Error("Steuernummer oder USt-IdNr. des Ausstellers fehlt.");
  if (company.country !== "DE")
    throw new Error(
      "Der Rechnungssteller muss für diesen Rechnungslauf in Deutschland sitzen.",
    );
  if (!["small_business", "regular"].includes(company.taxTreatment))
    throw new Error("Umsatzsteuerregelung fehlt.");
  if (parsed.serviceEnd < parsed.serviceStart || parsed.dueDate < issueDate)
    throw new Error("Leistungszeitraum oder Fälligkeit prüfen.");
  const lineNetCents = parsed.lines.map((l) =>
    lineAmount(l.quantityMilli, l.unitNetCents),
  );
  const netCents = lineNetCents.reduce((a, b) => a + b, 0);
  if (netCents < 1 || netCents > 10000000000)
    throw new Error("Rechnungsbetrag außerhalb des erlaubten Bereichs.");
  const vatRate = company.taxTreatment === "small_business" ? 0 : 19;
  const vatCents = Number((BigInt(netCents) * BigInt(vatRate) + 50n) / 100n),
    grossCents = netCents + vatCents;
  if (parsed.paidCents > grossCents)
    throw new Error("Bereits gezahlter Betrag übersteigt den Rechnungsbetrag.");
  return {
    ...parsed,
    number,
    issueDate,
    type: "invoice",
    currency: "EUR",
    seller: {
      name: company.legalName,
      street: company.street,
      postalCode: company.postalCode,
      city: company.city,
      country: "DE",
      email: company.email,
      phone: company.phone,
      taxNumber: company.taxNumber,
      vatId: company.vatId,
    },
    companyVersion: company.version,
    taxTreatment: company.taxTreatment as InvoiceDocument["taxTreatment"],
    vatRate,
    lineNetCents,
    netCents,
    vatCents,
    grossCents,
    dueCents: grossCents - parsed.paidCents,
  };
}
export function creditInvoice(
  original: InvoiceDocument,
  number: string,
  issueDate: string,
): InvoiceDocument {
  if (original.type !== "invoice")
    throw new Error("Nur eine Rechnung kann vollständig storniert werden.");
  return {
    ...original,
    number,
    issueDate,
    type: "credit_note",
    paidCents: 0,
    dueCents: original.grossCents,
    dueDate: issueDate,
    paymentText:
      "Vollständige Rechnungskorrektur. Eine etwaige Erstattung wird gesondert abgewickelt.",
    original: { number: original.number, issueDate: original.issueDate },
  };
}
export function xmlEscape(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
const el = (name: string, value: unknown, attrs = "") =>
  `<${name}${attrs}>${xmlEscape(value)}</${name}>`;
const date = (name: string, value: string) =>
  `<${name}>${el("udt:DateTimeString", value.replaceAll("-", ""), ' format="102"')}</${name}>`;
export function invoiceXml(
  d: InvoiceDocument,
  profile: "xrechnung" | "facturx",
) {
  const category = d.taxTreatment === "small_business" ? "E" : "S";
  const tax = (header = false) =>
    `<ram:ApplicableTradeTax>${header ? el("ram:CalculatedAmount", money(d.vatCents)) : ""}${el("ram:TypeCode", "VAT")}${header && category === "E" ? el("ram:ExemptionReason", SMALL_BUSINESS_NOTE) : ""}${header ? el("ram:BasisAmount", money(d.netCents)) : ""}${el("ram:CategoryCode", category)}${el("ram:RateApplicablePercent", d.vatRate.toFixed(2))}</ram:ApplicableTradeTax>`;
  const address = (a: InvoiceBuyer | InvoiceDocument["seller"]) =>
    `<ram:PostalTradeAddress>${el("ram:PostcodeCode", a.postalCode)}${el("ram:LineOne", a.street)}${el("ram:CityName", a.city)}${el("ram:CountryID", a.country)}</ram:PostalTradeAddress>`;
  const email = (v: string) =>
    `<ram:URIUniversalCommunication>${el("ram:URIID", v, ' schemeID="EM"')}</ram:URIUniversalCommunication>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter>${el("ram:ID", "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0")}</ram:BusinessProcessSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter>${el("ram:ID", profile === "xrechnung" ? "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0" : "urn:cen.eu:en16931:2017")}</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>${el("ram:ID", d.number)}${el("ram:TypeCode", d.type === "credit_note" ? "381" : "380")}${date("ram:IssueDateTime", d.issueDate)}${category === "E" ? `<ram:IncludedNote>${el("ram:Content", SMALL_BUSINESS_NOTE)}</ram:IncludedNote>` : ""}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${d.lines.map((l, i) => `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument>${el("ram:LineID", i + 1)}</ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct>${el("ram:Name", l.description)}</ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice>${el("ram:ChargeAmount", money(l.unitNetCents))}</ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery>${el("ram:BilledQuantity", (l.quantityMilli / 1000).toFixed(3), ' unitCode="C62"')}</ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement>${tax()}<ram:SpecifiedTradeSettlementLineMonetarySummation>${el("ram:LineTotalAmount", money(d.lineNetCents[i]))}</ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`).join("\n")}
<ram:ApplicableHeaderTradeAgreement>${el("ram:BuyerReference", d.buyer.reference)}<ram:SellerTradeParty>${el("ram:ID", d.seller.vatId || d.seller.taxNumber)}${el("ram:Name", d.seller.name)}<ram:DefinedTradeContact>${el("ram:PersonName", d.seller.name)}<ram:TelephoneUniversalCommunication>${el("ram:CompleteNumber", d.seller.phone)}</ram:TelephoneUniversalCommunication><ram:EmailURIUniversalCommunication>${el("ram:URIID", d.seller.email)}</ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>${address(d.seller)}${email(d.seller.email)}${d.seller.vatId ? `<ram:SpecifiedTaxRegistration>${el("ram:ID", d.seller.vatId, ' schemeID="VA"')}</ram:SpecifiedTaxRegistration>` : ""}${d.seller.taxNumber ? `<ram:SpecifiedTaxRegistration>${el("ram:ID", d.seller.taxNumber, ' schemeID="FC"')}</ram:SpecifiedTaxRegistration>` : ""}</ram:SellerTradeParty><ram:BuyerTradeParty>${el("ram:Name", d.buyer.name)}${address(d.buyer)}${email(d.buyer.email)}</ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery/>
<ram:ApplicableHeaderTradeSettlement>${el("ram:PaymentReference", d.number)}${el("ram:InvoiceCurrencyCode", "EUR")}<ram:SpecifiedTradeSettlementPaymentMeans>${el("ram:TypeCode", "1")}${el("ram:Information", d.paymentText)}</ram:SpecifiedTradeSettlementPaymentMeans>${tax(true)}<ram:BillingSpecifiedPeriod>${date("ram:StartDateTime", d.serviceStart)}${date("ram:EndDateTime", d.serviceEnd)}</ram:BillingSpecifiedPeriod><ram:SpecifiedTradePaymentTerms>${el("ram:Description", d.paymentText)}${date("ram:DueDateDateTime", d.dueDate)}</ram:SpecifiedTradePaymentTerms><ram:SpecifiedTradeSettlementHeaderMonetarySummation>${el("ram:LineTotalAmount", money(d.netCents))}${el("ram:ChargeTotalAmount", "0.00")}${el("ram:AllowanceTotalAmount", "0.00")}${el("ram:TaxBasisTotalAmount", money(d.netCents))}${el("ram:TaxTotalAmount", money(d.vatCents), ' currencyID="EUR"')}${el("ram:GrandTotalAmount", money(d.grossCents))}${el("ram:TotalPrepaidAmount", money(d.paidCents))}${el("ram:DuePayableAmount", money(d.dueCents))}</ram:SpecifiedTradeSettlementHeaderMonetarySummation>${d.original ? `<ram:InvoiceReferencedDocument>${el("ram:IssuerAssignedID", d.original.number)}<ram:FormattedIssueDateTime>${el("qdt:DateTimeString", d.original.issueDate.replaceAll("-", ""), ' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" format="102"')}</ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ""}</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>`;
}
