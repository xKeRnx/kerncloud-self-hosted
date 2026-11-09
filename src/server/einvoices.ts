import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { NextRequest } from "next/server";
import { z } from "zod";
import type { User, Workspace } from "../core/types.ts";
import {
  buyerSchema,
  prepareInvoice,
  creditInvoice,
  type InvoiceDocument,
} from "../core/einvoice.ts";
import { normalizeCompany, invoiceIssuer } from "../core/company.ts";
import { pool, transaction, audit } from "./db.ts";
import { encrypt, decrypt } from "./security.ts";
import { requireAdmin, HttpError } from "./auth.ts";
import { prove } from "./customer-admin.ts";
import { throttleSecurity } from "./mfa.ts";
import {
  buildInvoiceFormats,
  InvoiceValidationError,
  INVOICE_VALIDATORS,
} from "./invoice-formats.ts";
import { invoicePdf } from "./invoice-pdf.ts";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(
    new Date(),
  );
const columns =
  "id,account_id,number,source,source_id,kind,original_id,status,currency,amount,issue_date,retain_until,issued_at,created_at,error";
export async function billingRecipient(accountId: string, body?: unknown) {
  if (body !== undefined) {
    const buyer = buyerSchema.parse(body);
    await pool.query(
      "INSERT INTO billing_recipients(account_id,payload) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()",
      [accountId, encrypt(JSON.stringify(buyer))],
    );
  }
  const result = (
    await pool.query(
      "SELECT payload FROM billing_recipients WHERE account_id=$1",
      [accountId],
    )
  ).rows[0];
  if (result) return { buyer: JSON.parse(decrypt(result.payload)) };
  const account = (
    await pool.query(
      "SELECT u.name,u.email FROM accounts a JOIN users u ON u.id=a.owner_id WHERE a.id=$1",
      [accountId],
    )
  ).rows[0];
  if (!account) throw new HttpError(404, "Kundenkonto fehlt.");
  return {
    buyer: {
      name: account.name,
      email: account.email,
      street: "",
      postalCode: "",
      city: "",
      country: "DE",
      reference: accountId,
    },
  };
}
export async function customerEinvoices(accountId: string) {
  return (
    await pool.query(
      `SELECT ${columns} FROM einvoices WHERE account_id=$1 ORDER BY created_at DESC LIMIT 500`,
      [accountId],
    )
  ).rows.map((row) => ({
    ...row,
    error:
      row.status === "failed"
        ? "Die E-Rechnung konnte noch nicht bereitgestellt werden. Bitte den Betreiber kontaktieren."
        : "",
  }));
}
async function nextNumber(tx: PoolClient) {
  const year = Number(today().slice(0, 4));
  const n = (
    await tx.query(
      "INSERT INTO invoice_counters(year,next_number) VALUES($1,2) ON CONFLICT(year) DO UPDATE SET next_number=invoice_counters.next_number+1 RETURNING next_number-1 n",
      [year],
    )
  ).rows[0].n;
  return `KC-${year}-${String(n).padStart(6, "0")}`;
}
async function storeInvoice(
  tx: PoolClient,
  id: string,
  accountId: string,
  doc: InvoiceDocument,
  fingerprint: string,
  source: "manual" | "stripe",
  sourceId?: string,
  originalId?: string,
) {
  const retainUntil = `${Number(doc.issueDate.slice(0, 4)) + 8}-12-31`;
  await tx.query(
    "INSERT INTO einvoices(id,account_id,number,source,source_id,kind,original_id,fingerprint,document,amount,issue_date,retain_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      id,
      accountId,
      doc.number,
      source,
      sourceId ?? null,
      doc.type,
      originalId ?? null,
      fingerprint,
      encrypt(JSON.stringify(doc)),
      doc.type === "credit_note" ? -doc.grossCents : doc.grossCents,
      doc.issueDate,
      retainUntil,
    ],
  );
}
export async function invoiceDownload(
  accountId: string | null,
  id: string,
  format: string,
  admin = false,
) {
  const row = (
    await pool.query(
      "SELECT number,status,formats,hashes,source_id FROM einvoices WHERE id=$1 AND ($2::boolean OR account_id=$3)",
      [id, admin, accountId],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "E-Rechnung fehlt.");
  if (row.status !== "issued" || !row.formats)
    throw new HttpError(
      409,
      "Die E-Rechnung ist noch nicht geprüft und ausgestellt.",
    );
  const key =
    format === "xrechnung.xml"
      ? "xrechnung"
      : format === "zugferd.pdf"
        ? "zugferd"
        : null;
  if (!key) throw new HttpError(404, "Rechnungsformat fehlt.");
  const bytes = Buffer.from(JSON.parse(decrypt(row.formats))[key], "base64");
  if (hash(bytes) !== row.hashes[key])
    throw new HttpError(500, "Integritätsprüfung der Rechnung fehlgeschlagen.");
  const name = row.number.replace(/[^a-zA-Z0-9_-]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        key === "zugferd"
          ? "application/pdf"
          : "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function adminEinvoices(
  req: NextRequest,
  user: User,
  path: string,
  body: any,
  method: string,
) {
  requireAdmin(user);
  const parts = path.split("/").slice(1);
  if (!parts.length && method === "GET") {
    const page = Math.max(
      1,
      Math.min(10000, Number(req.nextUrl.searchParams.get("page")) || 1),
    );
    const query = z
      .string()
      .max(100)
      .parse(req.nextUrl.searchParams.get("q") ?? "");
    return {
      invoices: (
        await pool.query(
          `SELECT ${columns} FROM einvoices WHERE ($1='' OR number ILIKE '%'||$1||'%') ORDER BY created_at DESC LIMIT 50 OFFSET $2`,
          [query, (page - 1) * 50],
        )
      ).rows,
      imports: (
        await pool.query(
          "SELECT invoice_id,status,error,created_at FROM stripe_einvoice_jobs WHERE status<>'done' ORDER BY created_at DESC LIMIT 100",
        )
      ).rows,
      customers: (
        await pool.query(
          "SELECT a.id,u.name,u.email FROM accounts a JOIN users u ON u.id=a.owner_id ORDER BY u.created_at DESC LIMIT 200",
        )
      ).rows,
      validators: INVOICE_VALIDATORS,
    };
  }
  if (parts[0] === "recipient" && method === "GET")
    return billingRecipient(
      z
        .string()
        .min(1)
        .max(100)
        .parse(req.nextUrl.searchParams.get("accountId")),
    );
  if (
    parts.length === 2 &&
    ["zugferd.pdf", "xrechnung.xml"].includes(parts[1]) &&
    method === "GET"
  )
    return invoiceDownload(null, parts[0], parts[1], true);
  if (parts.length === 2 && parts[1] === "report" && method === "GET") {
    const row = (
      await pool.query(
        "SELECT number,reports,validators FROM einvoices WHERE id=$1",
        [parts[0]],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Rechnung fehlt.");
    return new Response(
      JSON.stringify(
        {
          number: row.number,
          validators: row.validators,
          reports: row.reports ? JSON.parse(decrypt(row.reports)) : {},
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="invoice-validation.json"',
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  if (method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
  if (parts[0] === "preview") {
    const company = normalizeCompany(
      (await pool.query("SELECT value FROM settings WHERE id='company'"))
        .rows[0]?.value,
    );
    const doc = prepareInvoice(
      company,
      body.invoice,
      "MUSTER-KEINE-RECHNUNG",
      today(),
    );
    const pdf = await invoicePdf(doc);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="invoice-preview.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  }
  await throttleSecurity("admin-proof:" + user.id);
  const reason = z.string().trim().min(5).max(1000).parse(body.reason);
  const fingerprint = hash(
    JSON.stringify({
      action: body.action,
      accountId: body.accountId,
      invoice: body.invoice,
      originalId: body.originalId,
    }),
  );
  return transaction(async (tx) => {
    await prove(tx, user, req, body);
    await tx.query("SELECT pg_advisory_xact_lock(6820192044)");
    if (body.action === "retry") {
      const changed = await tx.query(
        "UPDATE einvoices SET status='queued',error='' WHERE id=$1 AND status='failed' AND attempts<5 RETURNING id",
        [body.id],
      );
      if (!changed.rowCount)
        throw new HttpError(
          409,
          "Nur fehlgeschlagene unveränderte Rechnungen können erneut geprüft werden (max. 5 Versuche).",
        );
      await audit(tx, user.id, "einvoice.retry", body.id);
      return { id: body.id };
    }
    const id = z.string().uuid().parse(body.id);
    const existing = (
      await tx.query("SELECT id,fingerprint FROM einvoices WHERE id=$1", [id])
    ).rows[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "Vorgangskennung gehört zu anderen Rechnungsdaten.",
        );
      return { id };
    }
    if (body.action === "credit") {
      const original = (
        await tx.query(
          "SELECT * FROM einvoices WHERE id=$1 AND status='issued' AND kind='invoice'",
          [body.originalId],
        )
      ).rows[0];
      if (!original || !original.account_id)
        throw new HttpError(
          409,
          "Ursprungsrechnung oder zugehöriges Kundenkonto fehlt.",
        );
      if (original.source === "stripe")
        throw new HttpError(
          409,
          "Stripe-Rechnungen über eine Stripe-Gutschrift korrigieren; keine zweite lokale Forderung erzeugen.",
        );
      if (
        (
          await tx.query("SELECT 1 FROM einvoices WHERE original_id=$1", [
            original.id,
          ])
        ).rowCount
      )
        throw new HttpError(
          409,
          "Es existiert bereits eine vollständige Korrektur.",
        );
      const doc = creditInvoice(
        JSON.parse(decrypt(original.document)),
        await nextNumber(tx),
        today(),
      );
      if (body.confirmNumber !== original.number)
        throw new HttpError(400, "Rechnungsnummer zur Bestätigung eingeben.");
      await storeInvoice(
        tx,
        id,
        original.account_id,
        doc,
        fingerprint,
        "manual",
        undefined,
        original.id,
      );
    } else if (body.action === "issue") {
      const accountId = z.string().min(1).max(100).parse(body.accountId);
      if (
        !(await tx.query("SELECT 1 FROM accounts WHERE id=$1", [accountId]))
          .rowCount
      )
        throw new HttpError(404, "Kundenkonto fehlt.");
      const company = normalizeCompany(
        (await tx.query("SELECT value FROM settings WHERE id='company'"))
          .rows[0]?.value,
      );
      if (
        z.number().int().min(0).parse(body.expectedCompanyVersion) !==
        company.version
      )
        throw new HttpError(
          409,
          "Firmendaten oder Steuerregelung wurden geändert. Rechnung mit dem aktuellen Profil erneut prüfen.",
        );
      const doc = prepareInvoice(
        company,
        body.invoice,
        await nextNumber(tx),
        today(),
      );
      if (
        z.number().int().nonnegative().parse(body.expectedGrossCents) !==
        doc.grossCents
      )
        throw new HttpError(
          409,
          "Der bestätigte Rechnungsbetrag stimmt nicht mit der Berechnung überein.",
        );
      if (body.confirmEmail !== doc.buyer.email)
        throw new HttpError(400, "Empfänger-E-Mail zur Bestätigung eingeben.");
      await storeInvoice(tx, id, accountId, doc, fingerprint, "manual");
    } else throw new HttpError(400, "Rechnungsaktion fehlt.");
    await audit(tx, user.id, "einvoice.queued", id);
    await tx.query(
      "INSERT INTO customer_notes(id,user_id,actor_id,content) SELECT $1,a.owner_id,$2,$3 FROM einvoices e JOIN accounts a ON a.id=e.account_id WHERE e.id=$4",
      [randomUUID(), user.id, "E-Rechnung: " + reason, id],
    );
    return { id };
  });
}

// Invoice generation has no remote financial side effects. All content is frozen before the job is claimed.
export async function processEinvoice() {
  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (await lock.query("SELECT pg_try_advisory_lock(6820192045) ok"))
      .rows[0].ok;
    if (!locked) return;
    await lock.query(
      "UPDATE einvoices SET status='queued' WHERE status='processing' AND started_at<now()-interval '10 minutes' AND attempts<5",
    );
    await lock.query(
      "UPDATE einvoices SET status='failed',error='Rechnungserzeugung mehrfach unterbrochen. Betreiberprüfung erforderlich.' WHERE status='processing' AND started_at<now()-interval '10 minutes' AND attempts>=5",
    );
    const row = (
      await lock.query(
        "UPDATE einvoices SET status='processing',started_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM einvoices WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING *",
      )
    ).rows[0];
    if (!row) return;
    try {
      const result = await buildInvoiceFormats(
        JSON.parse(decrypt(row.document)),
      );
      const formats = {
        xrechnung: result.xrechnung.toString("base64"),
        facturx: result.facturx.toString("base64"),
        zugferd: result.zugferd.toString("base64"),
      };
      await transaction(async (tx) => {
        await tx.query(
          "UPDATE einvoices SET status='issued',formats=$2,reports=$3,hashes=$4,validators=$5,error='',issued_at=now() WHERE id=$1 AND status='processing'",
          [
            row.id,
            encrypt(JSON.stringify(formats)),
            encrypt(JSON.stringify(result.reports)),
            {
              xrechnung: hash(result.xrechnung),
              facturx: hash(result.facturx),
              zugferd: hash(result.zugferd),
            },
            result.validators,
          ],
        );
        await audit(tx, null, "einvoice.issued", row.id);
      });
    } catch (error) {
      const reports =
        error instanceof InvoiceValidationError ? error.reports : {};
      await lock.query(
        "UPDATE einvoices SET status='failed',reports=$2,validators=$3,error=$4 WHERE id=$1 AND status='processing'",
        [
          row.id,
          encrypt(JSON.stringify(reports)),
          INVOICE_VALIDATORS,
          error instanceof InvoiceValidationError
            ? error.message
            : "Die lokale Rechnungserzeugung ist fehlgeschlagen. Laufzeit und Prüfwerkzeuge kontrollieren.",
        ],
      );
    }
  } finally {
    if (locked)
      await lock.query("SELECT pg_advisory_unlock(6820192045)").catch(() => {});
    lock.release();
  }
}

// Called only inside the signed Stripe webhook transaction. No invoice is invented from a plan price.
export async function queueStripeEinvoice(
  tx: PoolClient,
  accountId: string,
  invoice: any,
) {
  if (
    !invoice.id ||
    !invoice.number ||
    !["open", "paid", "uncollectible"].includes(invoice.status)
  )
    return;
  const company = normalizeCompany(
    (await tx.query("SELECT value FROM settings WHERE id='company'")).rows[0]
      ?.value,
  );
  await tx.query(
    "INSERT INTO stripe_einvoice_jobs(invoice_id,account_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [invoice.id, accountId, encrypt(JSON.stringify({ invoice, company }))],
  );
}
export async function importStripeEinvoice() {
  return transaction(async (tx) => {
    const row = (
      await tx.query(
        "SELECT * FROM stripe_einvoice_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!row) return;
    await tx.query("SAVEPOINT stripe_invoice_import");
    try {
      if (
        (
          await tx.query("SELECT 1 FROM einvoices WHERE source_id=$1", [
            row.invoice_id,
          ])
        ).rowCount
      ) {
        await tx.query(
          "UPDATE stripe_einvoice_jobs SET status='done' WHERE invoice_id=$1",
          [row.invoice_id],
        );
        return;
      }
      const { invoice: i, company: c } = JSON.parse(decrypt(row.payload));
      if (i.footer !== invoiceIssuer(c))
        throw new Error(
          "Ausstellerdaten der Stripe-Rechnung stimmen nicht mit dem gespeicherten Firmenprofil überein.",
        );
      if (
        i.currency !== "eur" ||
        !i.customer_address ||
        i.customer_address.country !== "DE" ||
        !i.customer_email ||
        !i.customer_name ||
        i.lines?.has_more ||
        !i.lines?.data?.length
      )
        throw new Error(
          "Vollständige EUR-Inlandsrechnung mit Empfänger und allen Positionen benötigt.",
        );
      if (
        i.shipping_cost ||
        i.starting_balance ||
        i.ending_balance ||
        i.pre_payment_credit_notes_amount ||
        i.post_payment_credit_notes_amount
      )
        throw new Error(
          "Sonderfälle, Versand und Gutschriften im Rechnungsdienst bearbeiten.",
        );
      const lines = i.lines.data.map((l: any) => {
        if (
          !Number.isInteger(l.subtotal) ||
          l.subtotal < 0 ||
          !l.description ||
          !l.period?.start ||
          !l.period?.end ||
          l.pretax_credit_amounts?.some((a: any) => a.type !== "discount")
        )
          throw new Error(
            "Position ohne vollständige Netto- und Leistungsangaben.",
          );
        const net =
          l.subtotal -
          (l.discount_amounts ?? []).reduce(
            (s: number, v: any) => s + v.amount,
            0,
          );
        return {
          description: `${l.description}${l.quantity && l.quantity !== 1 ? ` (Menge laut Buchung: ${l.quantity})` : ""}`,
          quantityMilli: 1000,
          unitNetCents: net,
        };
      });
      const day = (stamp: number) =>
        new Date(stamp * 1000).toISOString().slice(0, 10);
      const issued = day(
        i.effective_at ?? i.status_transitions?.finalized_at ?? i.created,
      );
      const doc = prepareInvoice(
        c,
        {
          buyer: {
            name: i.customer_name,
            street: [i.customer_address.line1, i.customer_address.line2]
              .filter(Boolean)
              .join(", "),
            postalCode: i.customer_address.postal_code,
            city: i.customer_address.city,
            country: "DE",
            email: i.customer_email,
            reference: i.metadata?.buyer_reference ?? row.account_id,
          },
          serviceStart: day(
            Math.min(...i.lines.data.map((l: any) => l.period.start)),
          ),
          serviceEnd: day(
            Math.max(...i.lines.data.map((l: any) => l.period.end)),
          ),
          dueDate: day(
            i.due_date ??
              i.effective_at ??
              i.status_transitions?.finalized_at ??
              i.created,
          ),
          lines,
          paidCents: i.status === "paid" ? i.total : 0,
          paymentText:
            i.status === "paid"
              ? "Bezahlt über den Zahlungsdienstleister."
              : "Zahlung über den auf der Originalrechnung angegebenen Zahlungsweg.",
        },
        i.number,
        issued,
      );
      if (
        doc.grossCents !== i.total ||
        (i.total_excluding_tax != null &&
          doc.netCents !== i.total_excluding_tax) ||
        doc.vatCents !==
          (i.total_taxes ?? []).reduce((s: number, a: any) => s + a.amount, 0)
      )
        throw new Error(
          "Beträge oder Steuer passen nicht exakt zum unterstützten Steuersatz. Originalrechnung bleibt verfügbar.",
        );
      await storeInvoice(
        tx,
        randomUUID(),
        row.account_id,
        doc,
        hash(JSON.stringify(doc)),
        "stripe",
        i.id,
      );
      await tx.query(
        "UPDATE stripe_einvoice_jobs SET status='done' WHERE invoice_id=$1",
        [i.id],
      );
    } catch (error) {
      await tx.query("ROLLBACK TO SAVEPOINT stripe_invoice_import");
      await tx.query(
        "UPDATE stripe_einvoice_jobs SET status='blocked',error=$2 WHERE invoice_id=$1",
        [
          row.invoice_id,
          error instanceof z.ZodError
            ? "Erforderliche strukturierte Rechnungsdaten fehlen."
            : error instanceof Error && !(error as any).code
              ? error.message.slice(0, 500)
              : "Datenbankkonflikt beim Rechnungsimport. Betreiberprüfung erforderlich.",
        ],
      );
    }
  });
}
