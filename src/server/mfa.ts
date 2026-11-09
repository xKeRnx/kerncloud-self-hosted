import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import QRCode from "qrcode";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import {
  decrypt,
  encrypt,
  hashToken,
  hashPassword,
  verifyPassword,
} from "./security.ts";
import { matchingTotpStep, newTotpSecret } from "../core/totp.ts";
import type { NextRequest } from "next/server";
export async function throttleSecurity(key: string, limit = 12) {
  const row = (
    await pool.query(
      "INSERT INTO auth_attempts(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.expires_at<now() THEN 1 ELSE auth_attempts.attempts+1 END,expires_at=CASE WHEN auth_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.expires_at END RETURNING attempts",
      [hashToken(key)],
    )
  ).rows[0];
  if (row.attempts > limit)
    throw new HttpError(
      429,
      "Zu viele Sicherheitsversuche. Bitte später erneut versuchen.",
    );
}
export async function issueSession(c: PoolClient, userId: string, mfa = false) {
  const token = randomBytes(32).toString("hex");
  await c.query(
    "INSERT INTO sessions(id,user_id,expires_at,mfa_verified) VALUES($1,$2,now()+interval '7 days',$3)",
    [hashToken(token), userId, mfa],
  );
  return token;
}
export async function challenge(c: PoolClient, userId: string) {
  const token = randomBytes(32).toString("hex");
  await c.query("DELETE FROM login_challenges WHERE expires_at<now()");
  await c.query("INSERT INTO login_challenges(id,user_id) VALUES($1,$2)", [
    hashToken(token),
    userId,
  ]);
  return token;
}
export async function consumeFactor(
  c: PoolClient,
  userId: string,
  code: string,
) {
  const row = (
    await c.query(
      "SELECT * FROM account_security WHERE user_id=$1 FOR UPDATE",
      [userId],
    )
  ).rows[0];
  if (!row?.totp_secret) return false;
  const step = matchingTotpStep(
    decrypt(row.totp_secret),
    code,
    Number(row.last_step),
  );
  if (step !== null) {
    await c.query("UPDATE account_security SET last_step=$2 WHERE user_id=$1", [
      userId,
      step,
    ]);
    return true;
  }
  const key = hashToken(
    `${userId}:${code.toUpperCase().replace(/[-\s]/g, "")}`,
  );
  const hashes: string[] = row.recovery_hashes;
  if (hashes.includes(key)) {
    await c.query(
      "UPDATE account_security SET recovery_hashes=$2 WHERE user_id=$1",
      [userId, JSON.stringify(hashes.filter((h) => h !== key))],
    );
    await audit(c, userId, "security.recovery.used", "account");
    return true;
  }
  return false;
}
export async function accountProof(
  c: PoolClient,
  userId: string,
  req: NextRequest,
  password: string,
  code: string,
) {
  const row = (
    await c.query(
      "SELECT password_hash,password_enabled FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  if (row.password_enabled) {
    if (!verifyPassword(password, row.password_hash))
      throw new HttpError(401, "Aktuelles Passwort ist ungültig.");
  } else {
    const recent = (
      await c.query(
        "SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND authenticated_at>now()-interval '10 minutes'",
        [hashToken(req.cookies.get("kc_session")?.value ?? ""), userId],
      )
    ).rowCount;
    if (!recent)
      throw new HttpError(
        401,
        "Bitte erneut über deinen Anmeldedienst anmelden.",
      );
  }
  if (
    (
      await c.query(
        "SELECT 1 FROM account_security WHERE user_id=$1 AND totp_secret IS NOT NULL",
        [userId],
      )
    ).rowCount &&
    !(await consumeFactor(c, userId, code))
  )
    throw new HttpError(
      401,
      "Authenticator- oder Wiederherstellungscode ist ungültig oder bereits verwendet.",
    );
}
export async function verifyChallenge(token: string, code: string) {
  const owner = (
    await pool.query(
      "SELECT user_id FROM login_challenges WHERE id=$1 AND expires_at>now()",
      [hashToken(token)],
    )
  ).rows[0];
  if (owner) await throttleSecurity(`mfa-login:${owner.user_id}`, 12);
  const result = await transaction(async (c) => {
    const row = (
      await c.query(
        "SELECT ch.*,u.suspended FROM login_challenges ch JOIN users u ON u.id=ch.user_id WHERE ch.id=$1 AND ch.expires_at>now() FOR UPDATE OF ch",
        [hashToken(token)],
      )
    ).rows[0];
    if (!row || row.suspended || row.attempts >= 6) return { error: true };
    await c.query(
      "UPDATE login_challenges SET attempts=attempts+1 WHERE id=$1",
      [hashToken(token)],
    );
    if (!(await consumeFactor(c, row.user_id, code))) return { error: true };
    await c.query("DELETE FROM login_challenges WHERE id=$1", [
      hashToken(token),
    ]);
    await audit(c, row.user_id, "session.mfa.login", "account");
    return { token: await issueSession(c, row.user_id, true) };
  });
  if (result.error)
    throw new HttpError(
      401,
      "Code ungültig, bereits verwendet oder Anmeldung abgelaufen.",
    );
  return result.token!;
}
export async function securityStatus(userId: string) {
  const row = (
    await pool.query(
      "SELECT u.password_enabled,s.enabled_at,(s.totp_secret IS NOT NULL) AS enabled,jsonb_array_length(COALESCE(s.recovery_hashes,'[]')) AS recovery_codes FROM users u LEFT JOIN account_security s ON s.user_id=u.id WHERE u.id=$1",
      [userId],
    )
  ).rows[0];
  const identities = (
    await pool.query(
      "SELECT provider,email,created_at FROM oauth_identities WHERE user_id=$1 ORDER BY provider",
      [userId],
    )
  ).rows;
  return { ...row, enabled: Boolean(row.enabled), identities };
}
export async function securePassword(
  userId: string,
  req: NextRequest,
  body: unknown,
) {
  await throttleSecurity(`account-security:${userId}`);
  const b = z
    .object({
      current: z.string().max(128).default(""),
      password: z.string().min(12).max(128),
      code: z.string().max(80).default(""),
    })
    .parse(body);
  return transaction(async (c) => {
    await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await accountProof(c, userId, req, b.current, b.code);
    const old = (
      await c.query(
        "SELECT password_hash,password_change_required FROM users WHERE id=$1",
        [userId],
      )
    ).rows[0];
    if (
      old.password_change_required &&
      verifyPassword(b.password, old.password_hash)
    )
      throw new HttpError(
        400,
        "Bitte ein anderes als das vorläufige Passwort wählen.",
      );
    await c.query(
      "UPDATE users SET password_hash=$2,password_enabled=true,password_change_required=false WHERE id=$1",
      [userId, hashPassword(b.password)],
    );
    await c.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
    await c.query("DELETE FROM login_challenges WHERE user_id=$1", [userId]);
    await c.query("DELETE FROM oauth_states WHERE link_user_id=$1", [userId]);
    await c.query("DELETE FROM password_resets WHERE user_id=$1", [userId]);
    await c.query(
      "UPDATE support_sessions SET ended_at=COALESCE(ended_at,now()) WHERE target_id=$1 OR actor_id=$1",
      [userId],
    );
    await c.query(
      "UPDATE mail_outbox SET status='canceled',payload=NULL,finished_at=now() WHERE user_id=$1 AND status='queued' AND purpose IN('reset','invite')",
      [userId],
    );
    const mfa = (
      await c.query(
        "SELECT 1 FROM account_security WHERE user_id=$1 AND totp_secret IS NOT NULL",
        [userId],
      )
    ).rowCount;
    await audit(c, userId, "profile.password.changed", "account");
    return {
      ok: true,
      sessionToken: await issueSession(c, userId, Boolean(mfa)),
    };
  });
}
export async function securityAction(
  userId: string,
  req: NextRequest,
  action: string,
  body: unknown,
) {
  await throttleSecurity(`account-security:${userId}`);
  const b = z
    .object({
      password: z.string().max(128).default(""),
      code: z.string().max(80).default(""),
    })
    .parse(body);
  if (action === "setup") {
    const secret = newTotpSecret();
    const email = await transaction(async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      await accountProof(c, userId, req, b.password, b.code);
      const row = (
        await c.query(
          "SELECT totp_secret FROM account_security WHERE user_id=$1",
          [userId],
        )
      ).rows[0];
      if (row?.totp_secret) throw new HttpError(409, "2FA ist bereits aktiv.");
      await c.query(
        "INSERT INTO account_security(user_id,pending_secret,pending_until) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET pending_secret=EXCLUDED.pending_secret,pending_until=EXCLUDED.pending_until",
        [userId, encrypt(secret)],
      );
      return (await c.query("SELECT email FROM users WHERE id=$1", [userId]))
        .rows[0].email;
    });
    const uri = `otpauth://totp/${encodeURIComponent(`KeRnCloud:${email}`)}?secret=${secret}&issuer=KeRnCloud&algorithm=SHA1&digits=6&period=30`;
    return {
      secret,
      uri,
      qr: await QRCode.toDataURL(uri, { width: 240, margin: 2 }),
    };
  }
  return transaction(async (c) => {
    await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const row = (
      await c.query(
        "SELECT * FROM account_security WHERE user_id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (action === "enable") {
      // Recheck the first factor: a pending QR code alone cannot activate 2FA.
      await accountProof(c, userId, req, b.password, "");
      if (!row?.pending_secret || Date.parse(row.pending_until) < Date.now())
        throw new HttpError(400, "Einrichtung abgelaufen. Bitte neu beginnen.");
      const step = matchingTotpStep(decrypt(row.pending_secret), b.code);
      if (step === null)
        throw new HttpError(401, "Authenticator-Code ungültig.");
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(10)
          .toString("hex")
          .toUpperCase()
          .match(/.{1,5}/g)!
          .join("-"),
      );
      await c.query(
        "UPDATE account_security SET totp_secret=pending_secret,pending_secret=NULL,pending_until=NULL,enabled_at=now(),last_step=$2,recovery_hashes=$3 WHERE user_id=$1",
        [
          userId,
          step,
          JSON.stringify(
            codes.map((code) =>
              hashToken(`${userId}:${code.replaceAll("-", "")}`),
            ),
          ),
        ],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await c.query("DELETE FROM login_challenges WHERE user_id=$1", [userId]);
      await audit(c, userId, "security.mfa.enabled", "account");
      await c.query("DELETE FROM oauth_states WHERE link_user_id=$1", [userId]);
      return {
        ok: true,
        recoveryCodes: codes,
        sessionToken: await issueSession(c, userId, true),
      };
    }
    if (action === "disable") {
      if (!row?.totp_secret) throw new HttpError(400, "2FA ist nicht aktiv.");
      await accountProof(c, userId, req, b.password, b.code);
      await c.query("DELETE FROM oauth_states WHERE link_user_id=$1", [userId]);
      await c.query("DELETE FROM account_security WHERE user_id=$1", [userId]);
      await c.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await c.query("DELETE FROM login_challenges WHERE user_id=$1", [userId]);
      await audit(c, userId, "security.mfa.disabled", "account");
      return { ok: true, sessionToken: await issueSession(c, userId) };
    }
    throw new HttpError(404, "Sicherheitsfunktion fehlt.");
  });
}
