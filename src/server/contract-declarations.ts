import { z } from "zod";
import type { NextRequest } from "next/server";
import { pool, transaction, audit } from "./db.ts";
import { companyProfile } from "./company.ts";
import { queueMail } from "./mail.ts";
import { hashToken } from "./security.ts";
import { throttleSecurity } from "./mfa.ts";
import { prove } from "./customer-admin.ts";
import { HttpError, requireAdmin } from "./auth.ts";
import type { User } from "../core/types.ts";
export async function submitDeclaration(body: unknown) {
  const b = z
    .object({
      id: z.string().uuid(),
      kind: z.enum(["cancel", "withdraw"]),
      name: z.string().trim().min(1).max(200),
      email: z
        .string()
        .email()
        .max(254)
        .transform((x) => x.toLowerCase()),
      contract: z.string().trim().min(1).max(1000),
      terminationType: z
        .enum(["ordinary", "extraordinary"])
        .default("ordinary"),
      requestedEnd: z.string().trim().max(200).default("nächstmöglich"),
      reason: z.string().trim().max(2000).default(""),
    })
    .parse(body);
  const fingerprint = hashToken(JSON.stringify(b));
  const old = (
    await pool.query(
      "SELECT fingerprint FROM contract_declarations WHERE id=$1",
      [b.id],
    )
  ).rows[0];
  if (old && old.fingerprint !== fingerprint)
    throw new HttpError(
      409,
      "Diese Eingangsnummer wurde bereits anders verwendet.",
    );
  if (!old) {
    await throttleSecurity("contract-declaration:" + b.email, 10);
    await throttleSecurity("contract-declarations-global", 200);
  }
  const company = await companyProfile();
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(6820192035)");
    const existing = (
      await c.query("SELECT * FROM contract_declarations WHERE id=$1", [b.id])
    ).rows[0];
    if (existing && existing.fingerprint !== fingerprint)
      throw new HttpError(
        409,
        "Diese Eingangsnummer wurde bereits anders verwendet.",
      );
    const at = existing?.created_at ?? new Date();
    const statement = [
      b.kind === "cancel"
        ? "Kündigungserklärung / Cancellation statement"
        : "Widerrufserklärung / Withdrawal statement",
      `Eingangsnummer / Reference: ${b.id}`,
      `Eingang / Received: ${new Date(at).toISOString()}`,
      `An / To: ${company.legalName || "KeRnCloud-Betreiber"}`,
      `Name: ${b.name}`,
      `E-Mail / Email: ${b.email}`,
      `Vertrag / Contract: ${b.contract}`,
      b.kind === "cancel"
        ? `Art / Type: ${b.terminationType === "extraordinary" ? "außerordentlich / extraordinary" : "ordentlich / ordinary"}`
        : "",
      b.kind === "cancel"
        ? `Gewünschtes Ende / Requested end: ${b.requestedEnd || "nächstmöglich / earliest possible"}`
        : "",
      b.reason ? `Begründung / Reason: ${b.reason}` : "",
      b.kind === "cancel"
        ? "Die Kündigungserklärung wurde über die Bestätigungsschaltfläche „jetzt kündigen“ abgegeben."
        : "Die Widerrufserklärung wurde über die Bestätigungsschaltfläche „Widerruf bestätigen“ abgegeben.",
      "Dies bestätigt den Eingang Ihrer Erklärung. Eine Prüfung der Vertragszuordnung oder Abwicklung darf den gesetzlichen Zugangszeitpunkt nicht verändern. / This acknowledges receipt; subsequent processing does not change the time your statement was received.",
    ]
      .filter(Boolean)
      .join("\n");
    if (existing)
      return {
        ok: true,
        id: b.id,
        receivedAt: new Date(at).toISOString(),
        statement,
        existing: true,
      };
    const expires = new Date(Date.now() + 7 * 86400000);
    const mailId = await queueMail(
      c,
      null,
      b.email,
      "contract-confirmation",
      (b.kind === "cancel" ? "Kündigung" : "Widerruf") +
        " – Eingangsbestätigung / receipt",
      statement,
      expires,
    );
    await c.query(
      "INSERT INTO contract_declarations(id,kind,name,email,contract,termination_type,requested_end,reason,fingerprint,confirmation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        b.id,
        b.kind,
        b.name,
        b.email,
        b.contract,
        b.terminationType,
        b.requestedEnd || "nächstmöglich",
        b.reason,
        fingerprint,
        mailId,
        at,
      ],
    );
    if (company.email)
      await queueMail(
        c,
        null,
        company.email,
        "contract-notification",
        "KeRnCloud: Neue Vertragserklärung / new contract statement",
        statement +
          "\n\nIm Adminbereich „Vertragserklärungen“ bearbeiten. Erforderliche Stripe-Kündigungen und Erstattungen gesondert ausführen.",
        expires,
      );
    await audit(c, null, "contract.declaration.received", b.id);
    return {
      ok: true,
      id: b.id,
      receivedAt: new Date(at).toISOString(),
      statement,
    };
  });
}
export async function adminDeclarations(
  req: NextRequest,
  user: User,
  body: any,
  method: string,
) {
  requireAdmin(user);
  if (method === "GET") {
    const page = Math.max(
      1,
      Math.min(100000, Number(req.nextUrl.searchParams.get("page")) || 1),
    );
    const open = req.nextUrl.searchParams.get("status") !== "all";
    const rows = (
      await pool.query(
        "SELECT d.id,d.kind,d.name,d.email,d.contract,d.termination_type,d.requested_end,d.reason,d.created_at,d.processed_at,d.outcome,m.status confirmation_status FROM contract_declarations d LEFT JOIN mail_outbox m ON m.id=d.confirmation_id WHERE ($1=false OR d.processed_at IS NULL) ORDER BY d.created_at DESC LIMIT 50 OFFSET $2",
        [open, (page - 1) * 50],
      )
    ).rows;
    const count = Number(
      (
        await pool.query(
          "SELECT count(*) n FROM contract_declarations WHERE ($1=false OR processed_at IS NULL)",
          [open],
        )
      ).rows[0].n,
    );
    return {
      rows,
      page,
      pages: Math.max(1, Math.ceil(count / 50)),
      total: count,
    };
  }
  if (method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
  await throttleSecurity("admin-proof:" + user.id);
  const b = z
    .object({
      id: z.string().uuid(),
      reason: z.string().trim().min(5).max(2000),
    })
    .parse(body);
  return transaction(async (c) => {
    await prove(c, user, req, body);
    const r = await c.query(
      "UPDATE contract_declarations SET processed_at=now(),processed_by=$2,outcome=$3 WHERE id=$1 AND processed_at IS NULL",
      [b.id, user.id, b.reason],
    );
    if (!r.rowCount)
      throw new HttpError(
        409,
        "Erklärung fehlt oder wurde bereits bearbeitet.",
      );
    await audit(c, user.id, "admin.contract.processed", b.id);
    return { ok: true };
  });
}
