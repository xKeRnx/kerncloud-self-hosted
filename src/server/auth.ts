import { isSelfHosted } from "./self-hosted.ts";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { pool, transaction, seedWorkspace, audit } from "./db.ts";
import { hashPassword, verifyPassword, hashToken } from "./security.ts";
import type { User, Workspace } from "../core/types.ts";
import { challenge, issueSession } from "./mfa.ts";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: {
      code?: string;
      retryable?: boolean;
      retryAfter?: number;
    },
  ) {
    super(message);
  }
}
export async function session(
  req: NextRequest,
  ignoreSupport = false,
): Promise<{
  user: User;
  workspace: Workspace;
  support?: {
    actor_id: string;
    mode: string;
    reason: string;
    expires_at: string;
  };
}> {
  const token = req.cookies.get("kc_session")?.value;
  if (!token) throw new HttpError(401, "Bitte melde dich an.");
  const result = await pool.query(
    "SELECT u.id,u.email,u.name,u.role,u.suspended,u.marketing_consent,u.password_change_required,u.invitation_pending FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND(s.mfa_verified OR NOT EXISTS(SELECT 1 FROM account_security a WHERE a.user_id=u.id AND a.totp_secret IS NOT NULL))",
    [hashToken(token)],
  );
  let user = result.rows[0] as User | undefined;
  if (!user || user.suspended)
    throw new HttpError(401, "Sitzung abgelaufen oder Konto gesperrt.");
  let support:
    | { actor_id: string; mode: string; reason: string; expires_at: string }
    | undefined;
  const supportToken = req.cookies.get("kc_support")?.value;
  if (supportToken && !ignoreSupport) {
    if (user.role !== "admin" || user.password_change_required)
      throw new HttpError(
        401,
        "Supportzugang ist nicht mehr gültig. Bitte Supportmodus beenden.",
      );
    const row = (
      await pool.query(
        "SELECT s.actor_id,s.target_id,s.mode,s.reason,s.expires_at,u.id,u.email,u.name,u.role,u.suspended,u.marketing_consent,u.password_change_required,u.invitation_pending FROM support_sessions s JOIN users u ON u.id=s.target_id WHERE s.id=$1 AND s.actor_id=$2 AND s.parent_session=$3 AND s.expires_at>now() AND s.ended_at IS NULL",
        [hashToken(supportToken), user.id, hashToken(token)],
      )
    ).rows[0];
    if (!row || row.suspended || row.role === "admin")
      throw new HttpError(
        401,
        "Supportzugang ist abgelaufen oder gesperrt. Bitte Supportmodus beenden.",
      );
    support = {
      actor_id: row.actor_id,
      mode: row.mode,
      reason: row.reason,
      expires_at: row.expires_at,
    };
    user = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      suspended: row.suspended,
      marketing_consent: row.marketing_consent,
      password_change_required: row.password_change_required,
      invitation_pending: row.invitation_pending,
    };
  }
  const selected =
    ignoreSupport ||
    ["/api/workspaces/select", "/api/auth/logout"].includes(
      req.nextUrl.pathname,
    )
      ? null
      : (req.headers.get("x-workspace-id") ??
        req.nextUrl.searchParams.get("workspaceId") ??
        req.cookies.get("kc_workspace")?.value);
  const workspace = (
    await pool.query(
      "SELECT v.*,w.execution_paused,a.access_expires_at,a.access_source,CASE WHEN v.owner_id=$1 THEN 'owner' ELSE m.role END membership_role FROM workspace_context v JOIN workspaces w ON w.id=v.id JOIN accounts a ON a.id=v.account_id LEFT JOIN workspace_members m ON m.workspace_id=v.id AND m.user_id=$1 WHERE (v.owner_id=$1 OR ($3::boolean=false AND m.user_id IS NOT NULL)) AND ($2::text IS NULL OR v.id=$2) ORDER BY (v.owner_id=$1) DESC,v.created_at LIMIT 1",
      [user.id, selected ?? null, ignoreSupport],
    )
  ).rows[0] as Workspace | undefined;
  if (!workspace)
    throw new HttpError(403, "Dieser Workspace gehört nicht zu deinem Konto.");
  return { user, workspace, support };
}
export function requireAdmin(user: User) {
  if (user.role !== "admin")
    throw new HttpError(403, "Nur Administratoren haben hier Zugriff.");
}
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Ungültige Anfrageherkunft.");
  }
  const allowed = process.env.PUBLIC_URL;
  if (
    allowed
      ? origin !== allowed
      : host !== (req.headers.get("host") ?? req.nextUrl.host)
  )
    throw new HttpError(403, "Anfrage von fremder Herkunft abgelehnt.");
}
export async function authenticate(
  req: NextRequest,
  input: {
    email: string;
    password: string;
    name?: string;
    privacyAccepted?: boolean;
    marketingConsent?: boolean;
  },
  register = false,
) {
  const email = input.email.trim().toLowerCase();
  const user = await transaction(async (c) => {
    const key = hashToken(email);
    await c.query(
      "INSERT INTO auth_attempts(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.expires_at<now() THEN 1 ELSE auth_attempts.attempts+1 END,expires_at=CASE WHEN auth_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.expires_at END",
      [key],
    );
    const throttle = (
      await c.query("SELECT attempts FROM auth_attempts WHERE key=$1", [key])
    ).rows[0];
    if (throttle.attempts > 20)
      return {
        error: "Zu viele Versuche. Bitte später erneut versuchen.",
        status: 429,
      };
    let row = (
      await c.query("SELECT * FROM users WHERE email=$1 FOR UPDATE", [email])
    ).rows[0];
    if (register) {
      if (isSelfHosted() && process.env.ALLOW_REGISTRATION !== "true")
        return {error: "Registrierung ist auf dieser privaten Installation deaktiviert. Bitte den Administrator kontaktieren.", status: 403};
      if (!input.privacyAccepted)
        return {
          error: "Bitte bestätige die Datenschutzhinweise.",
          status: 400,
        };
      if (row)
        return {
          error:
            "Registrierung nicht möglich. Bitte anmelden oder andere Adresse verwenden.",
          status: 400,
        };
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,name,password_hash,privacy_version,marketing_consent) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          email,
          input.name ?? "Nutzer",
          hashPassword(input.password),
          "2026-10-local-v1",
          Boolean(input.marketingConsent),
        ],
      );
      await seedWorkspace(c, id, input.name ?? "Mein");
      row = (await c.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
      await audit(c, id, "account.register", id);
    } else if (
      !row ||
      !row.password_enabled ||
      row.invitation_pending ||
      !verifyPassword(input.password, row.password_hash) ||
      row.suspended
    )
      return { error: "E-Mail oder Passwort ungültig.", status: 401 };
    await c.query("DELETE FROM auth_attempts WHERE key=$1", [key]);
    await c.query("DELETE FROM sessions WHERE expires_at<now()");
    if (
      (
        await c.query(
          "SELECT 1 FROM account_security WHERE user_id=$1 AND totp_secret IS NOT NULL",
          [row.id],
        )
      ).rowCount
    )
      return { challenge: await challenge(c, row.id) };
    const sessionToken = await issueSession(c, row.id);
    await audit(c, row.id, "session.login", row.id);
    return { token: sessionToken };
  });
  if ("error" in user) throw new HttpError(user.status!, user.error!);
  return user;
}
