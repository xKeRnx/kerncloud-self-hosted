import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { pool, transaction, audit, seedWorkspace } from "./db.ts";
import { HttpError, session } from "./auth.ts";
import {
  encrypt,
  decrypt,
  hashToken,
  hashPassword,
  sameSecret,
} from "./security.ts";
import {
  accountProof,
  challenge,
  issueSession,
  throttleSecurity,
} from "./mfa.ts";
export const oauthProviders = ["google", "github", "microsoft"] as const;
type Provider = (typeof oauthProviders)[number];
type ProviderConfig = { enabled: boolean; clientId: string; secret: string };
type Config = {
  publicUrl: string;
  providers: Partial<Record<Provider, ProviderConfig>>;
};
async function config(): Promise<Config> {
  return (
    (await pool.query("SELECT value FROM settings WHERE id='oauth'")).rows[0]
      ?.value ?? {
      publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3100",
      providers: {},
    }
  );
}
export async function publicLogins() {
  const c = await config();
  return {
    providers: oauthProviders.filter(
      (p) =>
        c.providers[p]?.enabled &&
        c.providers[p]?.clientId &&
        c.providers[p]?.secret,
    ),
  };
}
export async function adminOauth(actor: string, body?: unknown) {
  const current = await config();
  if (body) {
    const input = z
      .object({
        publicUrl: z.string().url(),
        providers: z.object({
          google: z.object({
            enabled: z.boolean(),
            clientId: z.string().trim().max(500),
            secret: z.string().max(2000).optional(),
          }),
          microsoft: z
            .object({
              enabled: z.boolean(),
              clientId: z.string().trim().max(500),
              secret: z.string().max(2000).optional(),
            })
            .optional(),
          github: z.object({
            enabled: z.boolean(),
            clientId: z.string().trim().max(500),
            secret: z.string().max(2000).optional(),
          }),
        }),
      })
      .parse(body);
    const url = new URL(input.publicUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !(
        ["https:"].includes(url.protocol) ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))
      )
    )
      throw new HttpError(
        400,
        "OAuth braucht eine HTTPS-Plattformadresse; lokal ist localhost per HTTP erlaubt.",
      );
    const providers = {} as Config["providers"];
    for (const p of oauthProviders) {
      const v = input.providers[p] ?? { enabled: false, clientId: "" };
      const secret = v.secret
        ? encrypt(v.secret)
        : (current.providers[p]?.secret ?? "");
      if (v.enabled && (!v.clientId || !secret))
        throw new HttpError(400, `${p}: Client-ID und Secret fehlen.`);
      providers[p] = { enabled: v.enabled, clientId: v.clientId, secret };
    }
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO settings(id,value) VALUES('oauth',$1) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify({ publicUrl: url.origin, providers })],
      );
      await audit(c, actor, "admin.oauth.update", "oauth");
    });
  }
  const next = await config();
  return {
    publicUrl: next.publicUrl,
    providers: Object.fromEntries(
      oauthProviders.map((p) => [
        p,
        {
          enabled: next.providers[p]?.enabled ?? false,
          clientId: next.providers[p]?.clientId ?? "",
          configured: Boolean(next.providers[p]?.secret),
          callback: `${next.publicUrl}/api/auth/oauth/${p}/callback`,
        },
      ]),
    ),
  };
}
export function sessionResponse(token: string, redirect?: URL) {
  const res = redirect
    ? NextResponse.redirect(redirect, 303)
    : NextResponse.json({ ok: true });
  res.cookies.set("kc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.PUBLIC_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: 604800,
  });
  res.cookies.delete("kc_workspace");
  res.cookies.delete("kc_login_challenge");
  return res;
}
export function challengeResponse(token: string, redirect?: URL) {
  const res = redirect
    ? NextResponse.redirect(redirect, 303)
    : NextResponse.json({ mfaRequired: true });
  res.cookies.set("kc_login_challenge", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.PUBLIC_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: 300,
  });
  res.cookies.delete("kc_session");
  res.cookies.delete("kc_workspace");
  return res;
}
export async function startOauth(
  req: NextRequest,
  provider: Provider,
  intent: "login" | "signup" | "link",
  body: Record<string, unknown> = {},
) {
  const c = await config(),
    p = c.providers[provider];
  if (!p?.enabled || !p.clientId || !p.secret)
    throw new HttpError(
      409,
      "Dieser Anmeldedienst ist noch nicht eingerichtet.",
    );
  let userId: string | null = null;
  if (intent === "signup" && req.nextUrl.searchParams.get("privacy") !== "1")
    throw new HttpError(400, "Bitte die Datenschutzhinweise bestätigen.");
  if (intent === "link") {
    if (req.method !== "POST")
      throw new HttpError(
        405,
        "Verknüpfen benötigt eine bestätigte Kontoaktion.",
      );
    const current = await session(req);
    await throttleSecurity(`account-security:${current.user.id}`);
    await transaction(async (client) =>
      accountProof(
        client,
        current.user.id,
        req,
        String(body.password ?? ""),
        String(body.code ?? ""),
      ),
    );
    userId = current.user.id;
  }
  const state = randomBytes(32).toString("hex"),
    verifier = randomBytes(32).toString("base64url"),
    nonce = randomBytes(24).toString("hex");
  await pool.query("DELETE FROM oauth_states WHERE expires_at<now()");
  await pool.query(
    "INSERT INTO oauth_states(id,provider,verifier,nonce,link_user_id,intent,privacy) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      hashToken(state),
      provider,
      encrypt(verifier),
      nonce,
      userId,
      intent,
      intent === "signup",
    ],
  );
  const url = new URL(
    provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : provider === "microsoft"
        ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        : "https://github.com/login/oauth/authorize",
  );
  const params = {
    client_id: p.clientId,
    redirect_uri: `${c.publicUrl}/api/auth/oauth/${provider}/callback`,
    response_type: "code",
    scope:
      provider !== "github" ? "openid email profile" : "read:user user:email",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const response =
    intent === "link"
      ? NextResponse.json({ url: url.toString() })
      : NextResponse.redirect(url, 303);
  response.cookies.set("kc_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: c.publicUrl.startsWith("https:"),
    path: "/",
    maxAge: 300,
  });
  return response;
}
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export async function verifyGoogleIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
) {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
    algorithms: ["RS256"],
  });
  if (
    payload.nonce !== nonce ||
    payload.email_verified !== true ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    (payload.azp !== undefined && payload.azp !== clientId)
  )
    throw new HttpError(401, "Google-Identität konnte nicht bestätigt werden.");
  return {
    subject: payload.sub,
    email: z.string().email().max(254).parse(payload.email).toLowerCase(),
    name:
      typeof payload.name === "string" ? payload.name.slice(0, 80) : "Nutzer",
  };
}
// A tenant-specific JWKS endpoint scopes signing keys to the issuer. Untrusted tid
// is used only after strict UUID validation to construct a URL on this fixed host.
const microsoftKeySets = new Map<string, JWTVerifyGetKey>();
export async function verifyMicrosoftIdentity(
  idToken: string,
  clientId: string,
  nonce: string,
  keys?: JWTVerifyGetKey,
) {
  const tid = z.string().uuid().parse(decodeJwt(idToken).tid).toLowerCase();
  if (!keys) {
    keys = microsoftKeySets.get(tid);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${tid}/discovery/v2.0/keys`),
      );
      if (microsoftKeySets.size >= 32)
        microsoftKeySets.delete(microsoftKeySets.keys().next().value!);
      microsoftKeySets.set(tid, keys);
    }
  }
  const { payload } = await jwtVerify(idToken, keys, {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: `https://login.microsoftonline.com/${tid}/v2.0`,
  });
  if (
    payload.tid !== tid ||
    payload.nonce !== nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.ver !== "2.0"
  )
    throw new HttpError(
      401,
      "Microsoft-Identität konnte nicht bestätigt werden.",
    );
  // Email/UPN is mutable contact data, never an authorization key or an account-link proof.
  const email = z
    .string()
    .email()
    .max(254)
    .safeParse(payload.email ?? payload.preferred_username);
  if (!email.success)
    throw new HttpError(
      409,
      "Microsoft stellt keine verwendbare Kontaktadresse bereit. Bitte zuerst ein Konto erstellen und Microsoft im Profil verknüpfen.",
    );
  return {
    subject: `${tid}:${payload.sub}`,
    email: email.data.toLowerCase(),
    name:
      typeof payload.name === "string" ? payload.name.slice(0, 80) : "Nutzer",
  };
}
async function jsonFetch(url: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw new HttpError(401, "Der Anmeldedienst hat die Anmeldung abgelehnt.");
  return r.json();
}
export async function oauthIdentity(
  provider: Provider,
  token: Record<string, any>,
  clientId: string,
  nonce: string,
) {
  if (provider === "microsoft") {
    if (typeof token.id_token !== "string")
      throw new HttpError(401, "ID-Token fehlt.");
    return verifyMicrosoftIdentity(token.id_token, clientId, nonce);
  }
  if (provider === "google") {
    if (typeof token.id_token !== "string")
      throw new HttpError(401, "ID-Token fehlt.");
    return verifyGoogleIdentity(token.id_token, clientId, nonce);
  }
  if (typeof token.access_token !== "string")
    throw new HttpError(401, "Zugangstoken fehlt.");
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const [user, emails] = await Promise.all([
    jsonFetch("https://api.github.com/user", { headers }),
    jsonFetch("https://api.github.com/user/emails", { headers }),
  ]);
  const email = Array.isArray(emails)
    ? emails.find((e) => e.primary && e.verified)?.email
    : null;
  if (!Number.isSafeInteger(user.id) || !email)
    throw new HttpError(
      401,
      "GitHub braucht eine bestätigte primäre E-Mail-Adresse.",
    );
  return {
    subject: String(user.id),
    email: z.string().email().max(254).parse(email).toLowerCase(),
    name: String(user.name || user.login || "Nutzer").slice(0, 80),
  };
}
export async function completeIdentity(
  provider: Provider,
  identity: { subject: string; email: string; name: string },
  state: { link_user_id: string | null; intent: string; privacy: boolean },
) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(6820192031)");
    const existing = (
      await c.query(
        "SELECT * FROM oauth_identities WHERE provider=$1 AND subject=$2",
        [provider, identity.subject],
      )
    ).rows[0];
    let userId = existing?.user_id;
    if (state.link_user_id) {
      if (existing && existing.user_id !== state.link_user_id)
        throw new HttpError(
          409,
          "Diese Dienst-Identität ist bereits mit einem anderen Konto verbunden.",
        );
      if (
        (
          await c.query("SELECT 1 FROM users WHERE id=$1 AND suspended=false", [
            state.link_user_id,
          ])
        ).rowCount !== 1
      )
        throw new HttpError(401, "Konto nicht verfügbar.");
      await c.query(
        "INSERT INTO oauth_identities(provider,subject,user_id,email) VALUES($1,$2,$3,$4) ON CONFLICT(provider,subject) DO UPDATE SET email=EXCLUDED.email",
        [provider, identity.subject, state.link_user_id, identity.email],
      );
      await audit(c, state.link_user_id, "security.oauth.link", provider);
      return { linked: true };
    }
    if (!userId) {
      if (
        (await c.query("SELECT 1 FROM users WHERE email=$1", [identity.email]))
          .rowCount
      )
        throw new HttpError(
          409,
          "Zu dieser E-Mail existiert bereits ein Konto. Bitte normal anmelden und den Dienst im Profil verknüpfen.",
        );
      if (state.intent !== "signup" || !state.privacy)
        throw new HttpError(
          409,
          "Bitte zuerst registrieren und die Datenschutzhinweise bestätigen.",
        );
      userId = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,name,password_hash,password_enabled,privacy_version) VALUES($1,$2,$3,$4,false,'2026-10-local-v1')",
        [
          userId,
          identity.email,
          identity.name,
          hashPassword(randomBytes(32).toString("hex")),
        ],
      );
      await seedWorkspace(c, userId, identity.name);
      await c.query(
        "INSERT INTO oauth_identities(provider,subject,user_id,email) VALUES($1,$2,$3,$4)",
        [provider, identity.subject, userId, identity.email],
      );
      await audit(c, userId, "account.oauth.register", provider);
    }
    if (
      (
        await c.query("SELECT 1 FROM users WHERE id=$1 AND suspended=false", [
          userId,
        ])
      ).rowCount !== 1
    )
      throw new HttpError(401, "Konto gesperrt.");
    if (
      (
        await c.query(
          "SELECT 1 FROM account_security WHERE user_id=$1 AND totp_secret IS NOT NULL",
          [userId],
        )
      ).rowCount
    )
      return { challenge: await challenge(c, userId) };
    await audit(c, userId, "session.oauth.login", provider);
    return { token: await issueSession(c, userId) };
  });
}
export async function finishOauth(req: NextRequest, provider: Provider) {
  const cfg = await config();
  const state = req.nextUrl.searchParams.get("state") ?? "";
  try {
    if (
      !state ||
      !sameSecret(state, req.cookies.get("kc_oauth_state")?.value ?? "")
    )
      throw new HttpError(401, "OAuth-Zustand ungültig.");
    const saved = (
      await pool.query(
        "DELETE FROM oauth_states WHERE id=$1 AND provider=$2 AND expires_at>now() RETURNING *",
        [hashToken(state), provider],
      )
    ).rows[0];
    if (!saved) throw new HttpError(401, "OAuth-Anmeldung abgelaufen.");
    const p = cfg.providers[provider];
    if (!p?.enabled) throw new HttpError(401, "Anmeldedienst deaktiviert.");
    const code = req.nextUrl.searchParams.get("code");
    if (!code || code.length > 3000)
      throw new HttpError(401, "Anmeldung abgebrochen.");
    const token = await jsonFetch(
      provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : provider === "microsoft"
          ? "https://login.microsoftonline.com/common/oauth2/v2.0/token"
          : "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: p.clientId,
          client_secret: decrypt(p.secret),
          code,
          code_verifier: decrypt(saved.verifier),
          grant_type: "authorization_code",
          redirect_uri: `${cfg.publicUrl}/api/auth/oauth/${provider}/callback`,
        }),
      },
    );
    const result = await completeIdentity(
      provider,
      await oauthIdentity(provider, token, p.clientId, saved.nonce),
      saved,
    );
    const response = result.linked
      ? NextResponse.redirect(new URL("/profile?linked=1", cfg.publicUrl), 303)
      : result.challenge
        ? challengeResponse(
            result.challenge,
            new URL("/login?mfa=1", cfg.publicUrl),
          )
        : sessionResponse(result.token!, new URL("/overview", cfg.publicUrl));
    response.cookies.delete("kc_oauth_state");
    return response;
  } catch (error) {
    const res = NextResponse.redirect(
      new URL(
        `/login?oauthError=${error instanceof HttpError && error.status === 409 ? "account" : "failed"}`,
        cfg.publicUrl,
      ),
      303,
    );
    res.cookies.delete("kc_oauth_state");
    return res;
  }
}
