export const emptyCompany = {
  legalName: "",
  tradingName: "KeRnCloud",
  legalForm: "Einzelunternehmen",
  representative: "",
  street: "",
  postalCode: "",
  city: "",
  country: "DE",
  email: "",
  phone: "",
  website: "",
  register: "",
  registerNumber: "",
  vatId: "",
  economicId: "",
  taxNumber: "",
  taxTreatment: "small_business",
  audience: "both",
  disputeMode: "unset",
  disputeBody: "",
  privacyEmail: "",
  dpo: "",
  hosting: "",
  processors: "",
  transfers: "",
  retention: "",
  authority: "",
  authorityUrl: "",
  serviceTerms: "",
  checkoutReviewed: false,
  version: 0,
};
export type Company = typeof emptyCompany;
export const companyFieldLabels: Record<string, [string, string]> = {
  legalName: [
    "Vollständiger rechtlicher Name / Vor- und Nachname des Inhabers",
    "Full legal name / proprietor’s full name",
  ],
  tradingName: ["Geschäftsbezeichnung", "Trading name"],
  legalForm: ["Rechtsform", "Legal form"],
  representative: ["Vertretungsberechtigte Person", "Legal representative"],
  street: [
    "Straße und Hausnummer (ladungsfähige Anschrift)",
    "Street and number (service address)",
  ],
  postalCode: ["Postleitzahl", "Postal code"],
  city: ["Ort", "City"],
  email: ["Öffentliche Kontakt-E-Mail", "Public contact email"],
  phone: ["Telefon / direkter Kontakt", "Phone / direct contact"],
  website: ["Öffentliche Website (https://…)", "Public website (https://…)"],
  register: [
    "Register und Registergericht (falls eingetragen)",
    "Register and registry court (if registered)",
  ],
  registerNumber: ["Registernummer", "Registration number"],
  vatId: [
    "USt-IdNr. (falls vorhanden; öffentlich)",
    "VAT ID (if assigned; public)",
  ],
  economicId: [
    "Wirtschafts-IdNr. (falls vorhanden; öffentlich)",
    "Business identification number (if assigned; public)",
  ],
  taxNumber: [
    "Steuernummer (nur Abrechnung; nie im Impressum)",
    "Tax number (billing only; never in legal notice)",
  ],
  privacyEmail: [
    "Datenschutz-Kontakt (leer = Kontakt-E-Mail)",
    "Privacy email (empty = contact email)",
  ],
  dpo: [
    "Datenschutzbeauftragter und Kontakt (falls bestellt)",
    "Data protection officer and contact (if appointed)",
  ],
  hosting: [
    "Hosting: Anbieter, Anschrift und Verarbeitungsland",
    "Hosting: provider, address and processing country",
  ],
  processors: [
    "Weitere Empfänger: SMTP, Stripe, KI-Anbieter, OAuth und ggf. AV-Verträge",
    "Other recipients: SMTP, Stripe, AI, OAuth and processing agreements",
  ],
  transfers: [
    "Drittlandtransfers: tatsächliche Länder, Garantien und Bezugsmöglichkeiten",
    "International transfers: actual countries, safeguards and access details",
  ],
  retention: [
    "Tatsächliche Speicher- und Löschfristen inkl. Logs, Backups und Rechnungen",
    "Actual retention/deletion periods including logs, backups and invoices",
  ],
  authority: [
    "Zuständige Datenschutzaufsicht mit Anschrift",
    "Competent data protection authority and address",
  ],
  authorityUrl: [
    "Website der Datenschutzaufsicht",
    "Data protection authority website",
  ],
  serviceTerms: [
    "Bestellablauf und Tarifdetails: Vertragsschluss, Laufzeit, Verlängerung, Kündigung, Zusatzguthaben",
    "Order and plan details: contract formation, term, renewal, cancellation, extra balances",
  ],
  disputeBody: [
    "Schlichtungsstelle: Name, Anschrift und Website bei Teilnahme/Pflicht",
    "Dispute resolution body: name, address and website if participating/required",
  ],
};
export function normalizeCompany(value: Partial<Company> = {}): Company {
  return { ...emptyCompany, ...value };
}
export function escapeCompany(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function companyIssues(
  c: Company,
  kind:
    | "impressum"
    | "datenschutz"
    | "agb"
    | "cookies"
    | "widerruf"
    | "invoice" = "impressum",
) {
  const keys = [
    "legalName",
    "legalForm",
    "street",
    "postalCode",
    "city",
    "email",
    "website",
  ];
  if (!["Einzelunternehmen", "Freiberuflich"].includes(c.legalForm))
    keys.push("representative", "register", "registerNumber");
  if (kind === "datenschutz")
    keys.push(
      "hosting",
      "processors",
      "transfers",
      "retention",
      "authority",
      "authorityUrl",
    );
  if (kind === "agb") keys.push("serviceTerms");
  if (kind === "invoice" && !(c.taxNumber || c.vatId)) keys.push("taxNumber");
  const missing = keys
    .filter((k) => !String(c[k as keyof Company] ?? "").trim())
    .map((k) => companyFieldLabels[k]?.[0] ?? k);
  if (c.disputeMode === "unset" && ["impressum", "agb"].includes(kind))
    missing.push("Angaben zur Verbraucherstreitbeilegung");
  if (["voluntary", "required"].includes(c.disputeMode) && !c.disputeBody)
    missing.push("Zuständige Verbraucherschlichtungsstelle");
  return missing;
}
// Deliberate allowlist: private invoice tax numbers can never be inserted into public legal pages.
export function companyTokens(
  c: Company,
  locale = "de",
): Record<string, string> {
  const address = [
    c.street,
    [c.postalCode, c.city].filter(Boolean).join(" "),
    "Deutschland",
  ].join("\n");
  const identity = [
    c.legalName,
    c.legalForm,
    c.representative &&
      (locale === "en" ? "Represented by: " : "Vertreten durch: ") +
        c.representative,
    address,
  ]
    .filter(Boolean)
    .join("\n");
  const optionalRegistration = [
    c.register,
    c.registerNumber,
    c.vatId && "USt-IdNr.: " + c.vatId,
    c.economicId && "Wirtschafts-IdNr.: " + c.economicId,
  ]
    .filter(Boolean)
    .join("\n");
  const dispute =
    c.disputeMode === "none"
      ? locale === "en"
        ? "We are neither willing nor obliged to participate in dispute resolution before a consumer arbitration board."
        : "Wir sind weder bereit noch verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen."
      : ["voluntary", "required"].includes(c.disputeMode)
        ? (locale === "en"
            ? "Consumer dispute resolution: "
            : "Verbraucherstreitbeilegung: ") + c.disputeBody
        : "";
  const taxNotice =
    c.taxTreatment === "small_business"
      ? locale === "en"
        ? "VAT exemption under section 19(1) of the German VAT Act; no VAT is charged."
        : "Steuerbefreiung für Kleinunternehmer gemäß § 19 Abs. 1 UStG. Es wird keine Umsatzsteuer ausgewiesen."
      : locale === "en"
        ? "Prices include applicable VAT for consumers; business offers identify any net pricing explicitly."
        : "Verbraucherpreise verstehen sich einschließlich anwendbarer Umsatzsteuer; etwaige Nettopreise für Unternehmer werden ausdrücklich als solche gekennzeichnet.";
  const result: Record<string, string> = {
    identity,
    address,
    registration: optionalRegistration,
    dispute,
    taxNotice,
  };
  for (const key of [
    "legalName",
    "tradingName",
    "legalForm",
    "representative",
    "street",
    "postalCode",
    "city",
    "email",
    "phone",
    "website",
    "vatId",
    "economicId",
    "hosting",
    "processors",
    "transfers",
    "retention",
    "authority",
    "authorityUrl",
    "serviceTerms",
  ])
    result[key] = String(c[key as keyof Company]);
  result.privacyEmail = c.privacyEmail || c.email;
  result.dpo =
    c.dpo ||
    (locale === "en"
      ? "Please contact the controller using the details above."
      : "Bitte wenden Sie sich an den oben genannten Verantwortlichen.");
  return result;
}
export function resolveCompanyText(
  content: string,
  company: Company,
  locale = "de",
  html = true,
) {
  const values = companyTokens(company, locale),
    unresolved: string[] = [];
  const text = content.replace(
    /\{\{company\.([a-zA-Z]+)\}\}/g,
    (match, key: string) => {
      if (
        !(key in values) ||
        (!values[key] &&
          !["registration", "representative", "phone"].includes(key))
      ) {
        unresolved.push(key);
        return `[BITTE ERGÄNZEN: ${key}]`;
      }
      return html
        ? escapeCompany(values[key]).replace(/\n/g, "<br>")
        : values[key];
    },
  );
  return { text, unresolved };
}
export function invoiceIssuer(c: Company) {
  return [
    c.legalName,
    c.tradingName !== c.legalName ? c.tradingName : "",
    c.street,
    [c.postalCode, c.city].filter(Boolean).join(" "),
    "Deutschland",
    c.email,
    c.vatId
      ? "USt-IdNr.: " + c.vatId
      : c.taxNumber
        ? "Steuernummer: " + c.taxNumber
        : "",
    c.taxTreatment === "small_business" ? companyTokens(c).taxNotice : "",
  ]
    .filter(Boolean)
    .join("\n");
}
