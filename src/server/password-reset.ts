import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { hashToken, hashPassword } from "./security.ts";
import { HttpError } from "./auth.ts";
import { mailConfiguration, queueMail } from "./mail.ts";
import { throttleSecurity } from "./mfa.ts";
export async function createReset(
  c: PoolClient,
  user: any,
  kind: "reset" | "invite",
  send: boolean,
) {
  const token = randomBytes(32).toString("hex"),
    expires = new Date(Date.now() + 30 * 60000);
  const base = new URL(process.env.PUBLIC_URL ?? "http://localhost:3100");
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
  )
    throw new HttpError(409, "Passwort-Links benötigen eine HTTPS-Adresse.");
  const url = new URL("/reset-password", base);
  url.hash = token;
  await c.query("DELETE FROM password_resets WHERE user_id=$1", [user.id]);
  await c.query(
    "UPDATE mail_outbox SET status='canceled',payload=NULL,finished_at=now() WHERE user_id=$1 AND purpose IN('reset','invite') AND status='queued'",
    [user.id],
  );
  await c.query(
    "INSERT INTO password_resets(id,user_id,kind,expires_at) VALUES($1,$2,$3,$4)",
    [hashToken(token), user.id, kind, expires],
  );
  if (send)
    await queueMail(
      c,
      user.id,
      user.email,
      kind,
      kind === "invite"
        ? "Invitation to KeRnCloud"
        : "KeRnCloud: reset your password",
      `Hello ${user.name},\n\n${kind === "invite" ? "Activate your invited account" : "Set a new password"}:\n${url}\n\nThis link can be used once and expires in 30 minutes. Existing two-factor authentication remains enabled. If you did not expect this message, you can ignore it.\n\nKeRnCloud`,
      expires,
    );
  return {
    url: url.toString(),
    expiresAt: expires.toISOString(),
    delivery: send ? "queued" : "manual",
  };
}
export async function forgotPassword(body: unknown) {
  const b = z.object({ email: z.string().email().max(254) }).parse(body);
  const email = b.email.trim().toLowerCase();
  await throttleSecurity("password-reset:" + email, 5);
  const config = await mailConfiguration();
  if (config.enabled)
    await transaction(async (c) => {
      const user = (
        await c.query(
          "SELECT id,email,name,suspended,invitation_pending FROM users WHERE email=$1 FOR UPDATE",
          [email],
        )
      ).rows[0];
      if (user && !user.suspended)
        await createReset(
          c,
          user,
          user.invitation_pending ? "invite" : "reset",
          true,
        );
    });
  return {
    ok: true,
    message:
      "Falls ein passendes Konto besteht, wurde eine E-Mail angefordert.",
  };
}
export async function resetPassword(body: unknown, check = false) {
  const b = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password: z.string().min(12).max(128).optional(),
      privacyAccepted: z.boolean().optional(),
    })
    .parse(body);
  await throttleSecurity("reset-token:" + b.token.slice(0, 16), 10);
  return transaction(async (c) => {
    const owner = (
      await c.query("SELECT user_id FROM password_resets WHERE id=$1", [
        hashToken(b.token),
      ])
    ).rows[0];
    if (!owner)
      throw new HttpError(400, "Dieser Link ist ungültig oder abgelaufen.");
    if (!check)
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        owner.user_id,
      ]);
    const r = (
      await c.query(
        "SELECT r.*,u.suspended,u.invitation_pending FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.id=$1" +
          (check ? "" : " FOR UPDATE OF r"),
        [hashToken(b.token)],
      )
    ).rows[0];
    if (
      !r ||
      r.used_at ||
      new Date(r.expires_at).getTime() <= Date.now() ||
      r.suspended
    )
      throw new HttpError(400, "Dieser Link ist ungültig oder abgelaufen.");
    if (check) return { valid: true, invitation: r.invitation_pending };
    if (!b.password)
      throw new HttpError(
        400,
        "Ein neues Passwort mit mindestens 12 Zeichen eingeben.",
      );
    if (r.invitation_pending && !b.privacyAccepted)
      throw new HttpError(400, "Bitte die Datenschutzhinweise bestätigen.");
    await c.query(
      "UPDATE users SET password_hash=$2,password_enabled=true,password_change_required=false,invitation_pending=false,privacy_version=CASE WHEN invitation_pending THEN '2026-10-invite-v1' ELSE privacy_version END WHERE id=$1",
      [r.user_id, hashPassword(b.password)],
    );
    await c.query("UPDATE password_resets SET used_at=now() WHERE id=$1", [
      r.id,
    ]);
    await c.query("DELETE FROM sessions WHERE user_id=$1", [r.user_id]);
    await c.query(
      "UPDATE support_sessions SET ended_at=COALESCE(ended_at,now()) WHERE target_id=$1 OR actor_id=$1",
      [r.user_id],
    );
    await c.query("DELETE FROM login_challenges WHERE user_id=$1", [r.user_id]);
    await c.query("DELETE FROM oauth_states WHERE link_user_id=$1", [
      r.user_id,
    ]);
    await audit(c, r.user_id, "security.password.reset", r.user_id);
    return { ok: true };
  });
}
