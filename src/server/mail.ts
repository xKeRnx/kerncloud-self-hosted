import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { encrypt, decrypt } from "./security.ts";
import { HttpError } from "./auth.ts";
export async function mailConfiguration() {
  return (
    (await pool.query("SELECT value FROM settings WHERE id='mail'")).rows[0]
      ?.value ?? {}
  );
}
export async function publicMailConfiguration() {
  const c = await mailConfiguration();
  return {
    enabled: Boolean(c.enabled),
    host: c.host ?? "",
    port: c.port ?? 587,
    mode: c.mode ?? "starttls",
    username: c.username ?? "",
    from: c.from ?? "",
    configured: Boolean(
      c.enabled && c.host && c.from && (c.password || !c.username),
    ),
    localAllowed: process.env.ALLOW_LOCAL_ENDPOINTS === "true",
  };
}
export async function saveMail(actor: string, input: unknown) {
  const b = z
    .object({
      enabled: z.boolean(),
      host: z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/),
      port: z.number().int().min(1).max(65535),
      mode: z.enum(["starttls", "tls", "local"]),
      username: z.string().max(254).default(""),
      password: z.string().max(2000).optional(),
      from: z.string().email().max(254),
    })
    .parse(input);
  if (
    b.mode === "local" &&
    !(
      process.env.ALLOW_LOCAL_ENDPOINTS === "true" &&
      ["localhost", "127.0.0.1"].includes(b.host)
    )
  )
    throw new HttpError(
      400,
      "Unverschlüsseltes SMTP ist nur für die lokale Testumgebung erlaubt.",
    );
  const old = await mailConfiguration();
  if (b.username && !b.password && !old.password)
    throw new HttpError(400, "SMTP-Passwort fehlt.");
  if (
    ((old.host && old.host !== b.host) || old.username !== b.username) &&
    b.username &&
    !b.password
  )
    throw new HttpError(
      400,
      "Bei einem anderen SMTP-Zugang das Passwort neu eingeben.",
    );
  await transaction(async (c) => {
    await c.query(
      "INSERT INTO settings(id,value) VALUES('mail',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
      [
        JSON.stringify({
          ...b,
          password: b.password ? encrypt(b.password) : old.password,
        }),
      ],
    );
    await audit(c, actor, "admin.mail.configure", "mail");
  });
  return { ok: true };
}
export async function queueMail(
  c: PoolClient,
  userId: string | null,
  to: string,
  purpose: string,
  subject: string,
  text: string,
  expires: Date,
) {
  const id = randomUUID();
  await c.query(
    "INSERT INTO mail_outbox(id,user_id,recipient,purpose,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      userId,
      to,
      purpose,
      encrypt(JSON.stringify({ subject, text })),
      expires,
    ],
  );
  return id;
}
// One claim per message. An ambiguous send is never silently retried.
export async function deliverNextMail() {
  const config = await mailConfiguration();
  if (!config.enabled) return;
  const job = await transaction(async (c) => {
    await c.query(
      "UPDATE mail_outbox SET status='uncertain',payload=NULL,finished_at=now() WHERE status='sending' AND started_at<now()-interval '2 minutes'",
    );
    await c.query(
      "UPDATE mail_outbox SET status='canceled',payload=NULL,finished_at=now() WHERE status='queued' AND expires_at<=now()",
    );
    const j = (
      await c.query(
        "SELECT * FROM mail_outbox WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!j) return;
    await c.query(
      "UPDATE mail_outbox SET status='sending',started_at=now() WHERE id=$1",
      [j.id],
    );
    return j;
  });
  if (!job) return;
  let status = "uncertain";
  let transport: ReturnType<typeof smtpTransport> | undefined;
  try {
    const payload = JSON.parse(decrypt(job.payload));
    transport = smtpTransport(config);
    const sent = await transport.sendMail({
      from: config.from,
      to: job.recipient,
      subject: payload.subject,
      text: payload.text,
      messageId: `<${job.id}@kerncloud.invalid>`,
    });
    status = sent.accepted?.length ? "sent" : "failed";
  } catch {
    /* SMTP errors may contain credentials or addresses. Do not log them. */
  } finally {
    transport?.close();
  }
  await transaction(async (c) => {
    await c.query(
      "UPDATE mail_outbox SET status=$2,payload=NULL,finished_at=now() WHERE id=$1",
      [job.id, status],
    );
    await audit(c, null, "mail." + status, job.id);
  });
}

function smtpTransport(config: any) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.mode === "tls",
    requireTLS: config.mode === "starttls",
    ignoreTLS: config.mode === "local",
    ...(config.username
      ? { auth: { user: config.username, pass: decrypt(config.password) } }
      : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}
export async function verifyMailConnection() {
  const config = await mailConfiguration();
  if (!config.enabled)
    throw new HttpError(409, "SMTP-Mailversand ist nicht aktiviert.");
  const transport = smtpTransport(config);
  try {
    await transport.verify();
    return { ok: true };
  } catch {
    throw new HttpError(
      503,
      "SMTP-Verbindung konnte nicht bestätigt werden. Host, Port, TLS und Zugangsdaten prüfen.",
    );
  } finally {
    transport.close();
  }
}
