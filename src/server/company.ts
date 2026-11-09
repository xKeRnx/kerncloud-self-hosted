import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { pool, transaction, audit } from "./db.ts";
import { HttpError, requireAdmin } from "./auth.ts";
import { prove } from "./customer-admin.ts";
import { throttleSecurity } from "./mfa.ts";
import type { User } from "../core/types.ts";
import {
  emptyCompany,
  normalizeCompany,
  companyIssues,
  resolveCompanyText,
  invoiceIssuer,
  escapeCompany,
  type Company,
} from "../core/company.ts";
import { legalTemplate, type LegalKey } from "../core/legal-templates.ts";
import { renderLegalHtml } from "./legal-html.ts";
import { encrypt } from "./security.ts";
export async function companyProfile(): Promise<Company> {
  return normalizeCompany(
    (await pool.query("SELECT value FROM settings WHERE id='company'")).rows[0]
      ?.value,
  );
}
export async function resolvedLegalHtml(page: any, company?: Company) {
  return renderLegalHtml(
    resolveCompanyText(
      page.content,
      page.company_snapshot
        ? normalizeCompany(page.company_snapshot)
        : (company ?? (await companyProfile())),
      page.locale ?? "de",
      page.format === "html",
    ).text,
    page.format ?? "text",
  );
}
export function validateLegalPublication(page: any, company: Company) {
  const resolved = resolveCompanyText(
    page.content,
    company,
    page.locale ?? "de",
    page.format === "html",
  );
  if (
    resolved.unresolved.length ||
    /\[BITTE ERGÄNZEN|\[COMPLETE|\{\{company\./i.test(resolved.text)
  )
    throw new HttpError(
      400,
      "Vor Veröffentlichung alle Firmendaten und Platzhalter ergänzen.",
    );
  if (page.template) {
    const issues = companyIssues(company, page.key);
    if (issues.length)
      throw new HttpError(
        400,
        "Vor Veröffentlichung ergänzen: " + issues.join(", "),
      );
    if (!page.reviewed)
      throw new HttpError(
        400,
        "Die Vorlage zuerst auf den tatsächlichen Betrieb abstimmen und als geprüft bestätigen.",
      );
  }
  return resolved.text;
}
export async function companyAdmin(
  req: NextRequest,
  user: User,
  path: string,
  body: any,
  method: string,
) {
  requireAdmin(user);
  if (path === "legal-template" && method === "GET") {
    const key = z
      .enum(["impressum", "datenschutz", "agb", "cookies", "widerruf"])
      .parse(req.nextUrl.searchParams.get("key"));
    const locale = z
      .enum(["de", "en"])
      .parse(req.nextUrl.searchParams.get("locale") ?? "en");
    const c = await companyProfile(),
      result = legalTemplate(key, locale, c);
    return {
      ...result,
      html: await resolvedLegalHtml(result, c),
      missing: companyIssues(c, key),
    };
  }
  const c = await companyProfile();
  if (path === "company/invoice-profile" && method === "GET")
    return {
      country: c.country,
      taxTreatment: c.taxTreatment,
      issuer: invoiceIssuer(c),
      missing: companyIssues(c, "invoice"),
      company: c,
    };
  if (path === "company/invoice-preview" && method === "GET") {
    const html = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Rechnungsvorlage</title><style>body{font:16px system-ui;max-width:800px;margin:50px auto;padding:20px}pre{white-space:pre-wrap;font:inherit}aside{padding:20px;background:#fff0be}</style><body><aside>MUSTER – KEINE RECHNUNG. Es wurde keine Forderung oder Zahlung angelegt.</aside><h1>Rechnungsvorlage</h1><h2>Leistendes Unternehmen</h2><pre>${escapeCompany(invoiceIssuer(c))}</pre><h2>Rechnungsempfänger</h2><p>Name und vollständige Rechnungsanschrift des Kunden</p><h2>Rechnungsangaben</h2><p>Rechnungsnummer, Ausstellungsdatum, Leistungszeitraum, Leistungsbeschreibung, Betrag und Zahlungsstatus werden aus der tatsächlichen Buchung übernommen.</p><p>Originalrechnungen von Stripe behalten ihre Ausstellerdaten. Diese Firmendaten werden bei neuen Buchungen als Rechnungsfußzeile übertragen. Rechtsname, Anschrift, Steuerregistrierung und Zahlungsregeln müssen zusätzlich korrekt im Stripe-Konto stehen.</p></body></html>`;
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="kerncloud-rechnungsvorlage.html"',
        "Content-Security-Policy":
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  }
  if (path !== "company") throw new HttpError(404, "Firmenfunktion fehlt.");
  if (method === "GET")
    return {
      company: c,
      missing: companyIssues(c),
      invoiceMissing: companyIssues(c, "invoice"),
      invoiceSync: (
        await pool.query(
          "SELECT status,count(*)::int count FROM invoice_profile_jobs WHERE company_version=$1 GROUP BY status",
          [c.version],
        )
      ).rows,
    };
  if (method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
  await throttleSecurity("admin-proof:" + user.id);
  const fields: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(emptyCompany).filter(
    (k) => !["version", "checkoutReviewed"].includes(k),
  ))
    fields[key] = z
      .string()
      .trim()
      .max(
        ["processors", "transfers", "retention", "serviceTerms"].includes(key)
          ? 10000
          : 500,
      )
      .default(String(emptyCompany[key as keyof Company]));
  const value = z.object(fields).parse(body.company) as unknown as Company;
  value.country = z.literal("DE").parse(value.country);
  value.taxTreatment = z
    .enum(["small_business", "regular"])
    .parse(value.taxTreatment);
  value.audience = z
    .enum(["both", "business", "consumer"])
    .parse(value.audience);
  value.disputeMode = z
    .enum(["unset", "none", "voluntary", "required"])
    .parse(value.disputeMode);
  value.checkoutReviewed = z
    .boolean()
    .parse(body.company.checkoutReviewed ?? false);
  for (const email of [value.email, value.privacyEmail])
    if (email) z.string().email().max(254).parse(email);
  for (const address of [value.website, value.authorityUrl])
    if (address) {
      z.string().url().parse(address);
      const u = new URL(address);
      if (
        u.username ||
        u.password ||
        !["https:", "http:"].includes(u.protocol) ||
        u.search ||
        u.hash
      )
        throw new HttpError(
          400,
          "Öffentliche URLs ohne Zugangsdaten, Suchparameter oder Fragment verwenden.",
        );
    }
  const why = z.string().trim().min(5).max(1000).parse(body.reason);
  return transaction(async (tx) => {
    await prove(tx, user, req, body);
    await tx.query("SELECT pg_advisory_xact_lock(6820192027)");
    const old = normalizeCompany(
      (
        await tx.query(
          "SELECT value FROM settings WHERE id='company' FOR UPDATE",
        )
      ).rows[0]?.value,
    );
    value.version = old.version + 1;
    await tx.query(
      "INSERT INTO settings(id,value) VALUES('company',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
      [JSON.stringify(value)],
    );
    const pages = (
      await tx.query(
        "SELECT id,value FROM settings WHERE id LIKE 'legal:%' FOR UPDATE",
      )
    ).rows;
    for (const { id, value: page } of pages) {
      if (!page.content?.includes("{{company.")) continue;
      const key = id.split(":").at(-1) as LegalKey;
      const snapshot = {
        ...page,
        rendered_content: await resolvedLegalHtml(page, old),
      };
      await tx.query(
        "INSERT INTO settings(id,value) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [
          id.replace("legal:", "legal-history:") + ":" + page.version,
          JSON.stringify(snapshot),
        ],
      );
      let published = Boolean(page.published);
      if (published)
        try {
          validateLegalPublication({ ...page, key }, value);
        } catch {
          published = false;
        }
      await tx.query("UPDATE settings SET value=$2 WHERE id=$1", [
        id,
        JSON.stringify({
          ...page,
          published,
          company_snapshot: undefined,
          version: (page.version ?? 0) + 1,
          companyVersion: value.version,
          updated_at: new Date().toISOString(),
        }),
      ]);
    }
    await tx.query(
      "UPDATE settings SET value=value||$1::jsonb WHERE id='billing'",
      [
        JSON.stringify({
          country: "DE",
          taxTreatment: value.taxTreatment,
          ...(value.taxTreatment === "small_business"
            ? { automaticTax: false }
            : {}),
        }),
      ],
    );
    const billing = (
      await tx.query("SELECT value FROM settings WHERE id='billing'")
    ).rows[0]?.value;
    if (
      billing?.enabled &&
      billing.secret &&
      !companyIssues(value, "invoice").length
    ) {
      await tx.query(
        "UPDATE invoice_profile_jobs SET status='obsolete',finished_at=now() WHERE status='queued'",
      );
      await tx.query(
        "INSERT INTO invoice_profile_jobs(id,account_id,company_version,customer_id,footer) SELECT $1||':'||a.id,a.id,$2,a.stripe_customer_id,$3 FROM accounts a WHERE a.stripe_customer_id IS NOT NULL ON CONFLICT DO NOTHING",
        [String(value.version), value.version, encrypt(invoiceIssuer(value))],
      );
    }
    await audit(
      tx,
      user.id,
      "admin.company.update",
      "company:" + value.version,
    );
    await tx.query(
      "INSERT INTO customer_notes(id,user_id,actor_id,content) VALUES(gen_random_uuid()::text,$1,$1,$2)",
      [user.id, "company: " + why],
    );
    return { ok: true, version: value.version, missing: companyIssues(value) };
  });
}
export async function companyInvoiceSettings() {
  const c = await companyProfile();
  return c.legalName ? { footer: invoiceIssuer(c) } : undefined;
}
export async function assertCompanyCheckout(mode: string) {
  if (mode !== "live") return;
  const c = await companyProfile(),
    missing = [
      ...companyIssues(c, "invoice"),
      ...companyIssues(c, "datenschutz"),
      ...companyIssues(c, "agb"),
    ];
  if (missing.length || !c.checkoutReviewed)
    throw new HttpError(
      409,
      "Vor Live-Verkäufen Firmendaten, Rechtstexte und Bestellablauf vervollständigen und prüfen.",
    );
  for (const key of [
    "impressum",
    "datenschutz",
    "agb",
    ...(c.audience === "business" ? [] : ["widerruf"]),
  ]) {
    const page = (
      await pool.query("SELECT value FROM settings WHERE id=$1", [
        "legal:" + key,
      ])
    ).rows[0]?.value;
    if (!page?.published)
      throw new HttpError(409, "Veröffentlichter Rechtstext fehlt: " + key);
    validateLegalPublication(page, c);
  }
  const mail = (await pool.query("SELECT value FROM settings WHERE id='mail'"))
    .rows[0]?.value;
  if (!mail?.enabled)
    throw new HttpError(
      409,
      "Vor Live-Verkäufen SMTP für Vertragsbestätigungen einrichten.",
    );
}
