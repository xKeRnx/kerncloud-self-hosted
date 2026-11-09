import { allocateAutomaticPlan, allocatePlan } from "./plan-allowance.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit, seedWorkspace } from "./db.ts";
import { session, requireAdmin, HttpError } from "./auth.ts";
import { accountProof, throttleSecurity } from "./mfa.ts";
import { hashPassword, hashToken } from "./security.ts";
import { createReset } from "./password-reset.ts";
import {
  mailConfiguration,
  publicMailConfiguration,
  saveMail,
  verifyMailConnection,
} from "./mail.ts";
import { runtimeLock } from "./runtime.ts";
import type { User, Workspace } from "../core/types.ts";
const identifier = z.string().min(1).max(100),
  reason = z.string().trim().min(5).max(1000);
const proof = z.object({
  password: z.string().max(128).default(""),
  code: z.string().max(80).default(""),
});
export async function prove(
  c: PoolClient,
  actor: User,
  req: NextRequest,
  body: any,
) {
  requireAdmin(actor);
  if (actor.password_change_required || actor.invitation_pending)
    throw new HttpError(428, "Bitte zuerst das eigene Passwort ändern.");
  const p = proof.parse(body.proof ?? {});
  await accountProof(c, actor.id, req, p.password, p.code);
  await c.query("DELETE FROM auth_attempts WHERE key=$1", [
    hashToken("admin-proof:" + actor.id),
  ]);
}
async function revoke(c: PoolClient, id: string) {
  for (const sql of [
    "DELETE FROM sessions WHERE user_id=$1",
    "DELETE FROM login_challenges WHERE user_id=$1",
    "DELETE FROM oauth_states WHERE link_user_id=$1",
    "DELETE FROM password_resets WHERE user_id=$1",
    "UPDATE support_sessions SET ended_at=COALESCE(ended_at,now()) WHERE target_id=$1 OR actor_id=$1",
  ])
    await c.query(sql, [id]);
  await c.query(
    "UPDATE mail_outbox SET status='canceled',payload=NULL,finished_at=now() WHERE user_id=$1 AND status='queued'",
    [id],
  );
}
async function record(
  c: PoolClient,
  actor: string,
  target: string,
  action: string,
  why: string,
) {
  await audit(c, actor, "admin.customer." + action, target);
  await c.query(
    "INSERT INTO customer_notes(id,user_id,actor_id,content) VALUES($1,$2,$3,$4)",
    [randomUUID(), target, actor, `${action}: ${why}`],
  );
}
const paidStripe = (a: any) =>
  Boolean(
    a.stripe_subscription_id &&
    !["canceled", "incomplete_expired"].includes(a.subscription_status),
  );
export async function customerAdmin(
  req: NextRequest,
  actor: User,
  path: string,
  body: any,
  method: string,
): Promise<Response | Record<string, unknown>> {
  requireAdmin(actor);
  if (path === "mail") {
    if (method === "GET") return publicMailConfiguration();
    if (method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
    await throttleSecurity("admin-proof:" + actor.id);
    await transaction((c) => prove(c, actor, req, body));
    return body.action === "verify"
      ? verifyMailConnection()
      : saveMail(actor.id, body);
  }
  const parts = path.split("/"),
    targetId = parts[1];
  if (!targetId && method === "GET") {
    const q = z
        .string()
        .max(100)
        .parse(req.nextUrl.searchParams.get("q") ?? ""),
      page = Math.max(
        1,
        Math.min(10000, Number(req.nextUrl.searchParams.get("page") ?? 1) || 1),
      ),
      status = z
        .enum(["all", "active", "suspended", "invited"])
        .parse(req.nextUrl.searchParams.get("status") ?? "all"),
      plan = z
        .string()
        .max(40)
        .parse(req.nextUrl.searchParams.get("plan") ?? "");
    const where =
      "($1='' OR u.email ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%') AND ($2='all' OR ($2='suspended' AND u.suspended) OR ($2='invited' AND u.invitation_pending) OR ($2='active' AND NOT u.suspended AND NOT u.invitation_pending)) AND ($3='' OR a.plan_id=$3)";
    const params = [q, status, plan];
    const users = (
      await pool.query(
        `SELECT u.id,u.email,u.name,u.role,u.suspended,u.invitation_pending,u.created_at,a.plan_id,a.subscription_status,a.access_expires_at,a.credits,p.name plan_name,(SELECT count(*)::int FROM workspaces w WHERE w.owner_id=u.id) workspaces FROM users u LEFT JOIN accounts a ON a.owner_id=u.id LEFT JOIN plans p ON p.id=a.plan_id WHERE ${where} ORDER BY u.created_at DESC,u.id LIMIT 20 OFFSET $4`,
        [...params, (page - 1) * 20],
      )
    ).rows;
    const total = Number(
      (
        await pool.query(
          `SELECT count(*) n FROM users u LEFT JOIN accounts a ON a.owner_id=u.id WHERE ${where}`,
          params,
        )
      ).rows[0].n,
    );
    return {
      users,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / 20)),
      plans: (
        await pool.query("SELECT id,name FROM plans ORDER BY price_cents")
      ).rows,
    };
  }
  if (!targetId && method === "POST") {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        email: z.string().email().max(254),
        send: z.boolean().default(false),
        reason,
        proof: proof.optional(),
      })
      .parse(body);
    if (b.send && !(await mailConfiguration()).enabled)
      throw new HttpError(409, "Zuerst SMTP-Mailversand einrichten.");
    await throttleSecurity("admin-proof:" + actor.id);
    return transaction(async (c) => {
      await prove(c, actor, req, b);
      if (
        (
          await c.query("SELECT 1 FROM users WHERE email=$1", [
            b.email.toLowerCase(),
          ])
        ).rowCount
      )
        throw new HttpError(
          409,
          "Diese E-Mail-Adresse ist bereits registriert.",
        );
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,name,password_hash,password_enabled,invitation_pending,privacy_version) VALUES($1,$2,$3,$4,false,true,'invitation-pending')",
        [
          id,
          b.email.toLowerCase(),
          b.name,
          hashPassword(randomBytes(32).toString("hex")),
        ],
      );
      await seedWorkspace(c, id, b.name);
      const reset = await createReset(
        c,
        { id, email: b.email.toLowerCase(), name: b.name },
        "invite",
        b.send,
      );
      await record(c, actor.id, id, "invite", b.reason);
      return { id, ...(b.send ? { delivery: "queued" } : reset) };
    });
  }
  identifier.parse(targetId);
  const user = (
    await pool.query(
      "SELECT u.id,u.email,u.name,u.role,u.suspended,u.created_at,u.marketing_consent,u.password_enabled,u.password_change_required,u.invitation_pending,EXISTS(SELECT 1 FROM account_security s WHERE s.user_id=u.id AND s.totp_secret IS NOT NULL) mfa_enabled FROM users u WHERE u.id=$1",
      [targetId],
    )
  ).rows[0];
  if (!user) throw new HttpError(404, "Kundenkonto fehlt.");
  const a = (
    await pool.query(
      "SELECT a.*,p.name plan_name FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE owner_id=$1",
      [targetId],
    )
  ).rows[0];
  if (!a) throw new HttpError(404, "Abrechnungskonto fehlt.");
  if (method === "GET") {
    if (parts[2] === "invoices" && parts[3]) {
      const { invoiceUrl } = await import("./business.ts");
      return NextResponse.redirect(
        await invoiceUrl({ account_id: a.id } as Workspace, parts[3]),
      );
    }
    if (parts[2] === "grants" && parts[3])
      return grantReceipt(a.id, parts[3], true);
    return {
      user,
      account: a,
      allowance:
        (
          await pool.query(
            "SELECT * FROM plan_allocations WHERE account_id=$1 AND period=$2",
            [a.id, new Date().toISOString().slice(0, 7)],
          )
        ).rows[0] ?? null,
      plans: (await pool.query("SELECT * FROM plans ORDER BY price_cents"))
        .rows,
      workspaces: (
        await pool.query(
          "SELECT w.id,w.name,w.created_at,(SELECT count(*)::int FROM agents ag WHERE ag.workspace_id=w.id) agents,(SELECT count(*)::int FROM runs r WHERE r.workspace_id=w.id AND r.status IN('running','paused','input_required')) open_runs FROM workspaces w WHERE owner_id=$1 ORDER BY created_at",
          [targetId],
        )
      ).rows,
      sessions: (
        await pool.query(
          "SELECT expires_at,authenticated_at,mfa_verified FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY authenticated_at DESC",
          [targetId],
        )
      ).rows,
      identities: (
        await pool.query(
          "SELECT provider,created_at FROM oauth_identities WHERE user_id=$1",
          [targetId],
        )
      ).rows,
      notes: (
        await pool.query(
          "SELECT n.id,n.content,n.created_at,u.name actor FROM customer_notes n LEFT JOIN users u ON u.id=n.actor_id WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 100",
          [targetId],
        )
      ).rows,
      grants: (
        await pool.query(
          "SELECT g.*,u.name actor FROM account_grants g LEFT JOIN users u ON u.id=g.actor_id WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
          [a.id],
        )
      ).rows,
      invoices: (
        await pool.query(
          "SELECT id,number,status,amount,currency,created_at FROM invoices WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
          [a.id],
        )
      ).rows,
      deliveries: (
        await pool.query(
          "SELECT id,purpose,status,created_at,finished_at FROM mail_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
          [targetId],
        )
      ).rows,
      audit: (
        await pool.query(
          "SELECT a.id,a.action,a.created_at,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.subject IN($1,$2) ORDER BY a.id DESC LIMIT 100",
          [targetId, a.id],
        )
      ).rows,
    };
  }
  if (method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
  const action = z
      .enum([
        "note",
        "profile",
        "password",
        "reset",
        "revoke",
        "mfa_reset",
        "suspend",
        "subscription",
        "allowance",
        "grant",
        "role",
      ])
      .parse(body.action),
    why = reason.parse(body.reason);
  if (action === "note") {
    await transaction((c) => record(c, actor.id, targetId, "note", why));
    return { ok: true };
  }
  await throttleSecurity("admin-proof:" + actor.id);
  if (action === "reset" && body.send && !(await mailConfiguration()).enabled)
    throw new HttpError(409, "Zuerst SMTP-Mailversand einrichten.");
  return transaction(async (c) => {
    await runtimeLock(c);
    await prove(c, actor, req, body);
    const target = (
      await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [targetId])
    ).rows[0];
    const account = (
      await c.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [a.id])
    ).rows[0];
    if (!target || !account) throw new HttpError(404, "Kundenkonto fehlt.");
    if (
      ["password", "reset", "mfa_reset", "suspend", "role"].includes(action) &&
      target.id === actor.id
    )
      throw new HttpError(
        409,
        "Das eigene Administratorkonto über Profil und Sicherheit verwalten.",
      );
    if (
      ["password", "reset", "mfa_reset", "suspend"].includes(action) &&
      target.role === "admin"
    )
      throw new HttpError(
        409,
        "Administratorkonten verwalten ihre Sicherheit selbst.",
      );
    if (
      ["password", "mfa_reset", "role"].includes(action) &&
      body.confirmEmail !== target.email
    )
      throw new HttpError(
        400,
        "Zur Bestätigung die genaue Kunden-E-Mail eingeben.",
      );
    let result: Record<string, unknown> = { ok: true };
    if (action === "profile") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(80),
          email: z.string().email().max(254),
        })
        .parse(body);
      if (target.role === "admin" && b.email.toLowerCase() !== target.email)
        throw new HttpError(
          409,
          "Administrator-Adressen hier nicht ändern; die Bootstrap-Konfiguration muss dazu passen.",
        );
      if (
        (
          await c.query("SELECT 1 FROM users WHERE email=$1 AND id<>$2", [
            b.email.toLowerCase(),
            targetId,
          ])
        ).rowCount
      )
        throw new HttpError(
          409,
          "Diese E-Mail-Adresse ist bereits registriert.",
        );
      await c.query("UPDATE users SET name=$2,email=$3 WHERE id=$1", [
        targetId,
        b.name,
        b.email.toLowerCase(),
      ]);
      if (b.email.toLowerCase() !== target.email) await revoke(c, targetId);
    } else if (action === "password") {
      const b = z
        .object({
          newPassword: z.string().min(12).max(128),
          requireChange: z.boolean().default(true),
        })
        .parse(body);
      if (target.invitation_pending)
        throw new HttpError(
          409,
          "Einladungen zuerst vom Kunden aktivieren lassen.",
        );
      await c.query(
        "UPDATE users SET password_hash=$2,password_enabled=true,password_change_required=$3 WHERE id=$1",
        [targetId, hashPassword(b.newPassword), b.requireChange],
      );
      await revoke(c, targetId);
    } else if (action === "reset") {
      if (target.suspended)
        throw new HttpError(409, "Gesperrte Konten zuerst entsperren.");
      const send = z.boolean().parse(body.send);
      const reset = await createReset(
        c,
        target,
        target.invitation_pending ? "invite" : "reset",
        send,
      );
      result = send ? { ok: true, delivery: "queued" } : reset;
    } else if (action === "revoke") {
      await revoke(c, targetId);
      await c.query("DELETE FROM auth_attempts WHERE key=$1", [
        hashToken(target.email),
      ]);
    } else if (action === "mfa_reset") {
      await c.query("DELETE FROM account_security WHERE user_id=$1", [
        targetId,
      ]);
      await revoke(c, targetId);
    } else if (action === "role") {
      const role = z.enum(["admin", "user"]).parse(body.role);
      await c.query(
        "SELECT id FROM users WHERE role='admin' ORDER BY id FOR UPDATE",
      );
      if (
        target.role === "admin" &&
        role === "user" &&
        Number(
          (
            await c.query(
              "SELECT count(*) n FROM users WHERE role='admin' AND NOT suspended",
            )
          ).rows[0].n,
        ) <= 1
      )
        throw new HttpError(
          409,
          "Mindestens ein aktiver Administrator muss erhalten bleiben.",
        );
      await c.query("UPDATE users SET role=$2 WHERE id=$1", [targetId, role]);
      await revoke(c, targetId);
    } else if (action === "suspend") {
      const suspended = z.boolean().parse(body.suspended);
      await c.query("UPDATE users SET suspended=$2 WHERE id=$1", [
        targetId,
        suspended,
      ]);
      if (suspended) {
        await revoke(c, targetId);
        await c.query(
          "UPDATE runs SET status='paused',updated_at=now() WHERE workspace_id IN(SELECT id FROM workspaces WHERE owner_id=$1) AND status='running'",
          [targetId],
        );
      }
    } else if (action === "subscription") {
      const b = z
        .object({
          planId: z.string().max(40),
          until: z.string().datetime().nullable(),
          status: z.string().max(40),
        })
        .parse(body);
      if (
        !paidStripe(account) &&
        !["free", "active", "local_test", "canceled"].includes(b.status)
      )
        throw new HttpError(400, "Ungültiger lokaler Abostatus.");
      if (
        !(await c.query("SELECT id FROM plans WHERE id=$1", [b.planId]))
          .rowCount
      )
        throw new HttpError(404, "Plan fehlt.");
      if (
        paidStripe(account) &&
        (b.planId !== account.plan_id ||
          b.status !== account.subscription_status)
      )
        throw new HttpError(
          409,
          "Stripe-Plan und Zahlungsstatus werden von Stripe verwaltet. Hier ist nur die zusätzliche KeRnCloud-Zugangsfrist änderbar.",
        );
      const until =
        b.status === "canceled" ? new Date().toISOString() : b.until;
      await c.query(
        "UPDATE accounts SET plan_id=$2,subscription_status=$3,access_expires_at=$4,access_source=$5 WHERE id=$1",
        [
          account.id,
          b.planId,
          b.status,
          until,
          paidStripe(account) ? "manual_limit" : "manual",
        ],
      );
      if (!paidStripe(account) && account.stripe_subscription_id)
        await c.query(
          "UPDATE accounts SET stripe_subscription_id=NULL WHERE id=$1",
          [account.id],
        );
      await allocateAutomaticPlan(c, account.id, new Date(), actor.id);
    } else if (action === "allowance") {
      result = await allocatePlan(
        c,
        account.id,
        actor.id,
        why,
        z.string().max(40).parse(body.planId),
      );
    } else if (action === "grant") {
      const b = z
        .object({
          id: z.string().uuid(),
          kind: z.enum(["gift", "goodwill", "test", "adjustment"]),
          planId: z.string().max(40).nullable().default(null),
          until: z.string().datetime().nullable().default(null),
          credits: z.number().int().min(-100000000).max(100000000).default(0),
          minutes: z.number().int().min(-1000000).max(1000000).default(0),
          receipt: z.boolean().default(false),
          customerMessage: z.string().max(2000).default(""),
        })
        .parse(body);
      if (b.kind !== "adjustment" && (b.credits < 0 || b.minutes < 0))
        throw new HttpError(
          400,
          "Geschenke und Kulanz dürfen nicht negativ sein.",
        );
      if (!b.planId && !b.credits && !b.minutes)
        throw new HttpError(400, "Einen Plan, Credits oder Minuten auswählen.");
      const fingerprint = hashToken(JSON.stringify({ ...b, reason: why }));
      const old = (
        await c.query(
          "SELECT account_id,fingerprint FROM account_grants WHERE id=$1",
          [b.id],
        )
      ).rows[0];
      if (old) {
        if (old.account_id !== account.id || old.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "Diese Buchungs-ID gehört zu einer anderen Buchung.",
          );
        return { ok: true, id: b.id, existing: true };
      }
      if (b.planId) {
        if (paidStripe(account))
          throw new HttpError(
            409,
            "Einen laufenden Stripe-Plan nicht mit einem Geschenk überschreiben. Credits oder Minuten können separat verschenkt werden.",
          );
        if (!b.until || new Date(b.until).getTime() <= Date.now())
          throw new HttpError(
            400,
            "Für einen Geschenkplan ein zukünftiges Enddatum angeben.",
          );
        if (
          !(
            await c.query("SELECT id FROM plans WHERE id=$1 AND active", [
              b.planId,
            ])
          ).rowCount
        )
          throw new HttpError(404, "Aktiver Plan fehlt.");
      }
      if (b.planId && account.stripe_subscription_id)
        await c.query(
          "UPDATE accounts SET stripe_subscription_id=NULL WHERE id=$1",
          [account.id],
        );
      const runtimeGift = b.minutes * 60,
        settledDebt = Math.min(Math.max(0, runtimeGift), account.runtime_debt),
        balanceChange = runtimeGift - settledDebt;
      if (
        account.credits + b.credits < 0 ||
        account.credits + b.credits > 100000000 ||
        account.runtime_purchased + balanceChange < 0 ||
        account.runtime_purchased + balanceChange > 60000000
      )
        throw new HttpError(
          400,
          "Die Buchung würde das Guthabenlimit überschreiten.",
        );
      const issuerProfile =
        (await c.query("SELECT value FROM settings WHERE id='company'")).rows[0]
          ?.value ?? {};
      const issuer = Object.fromEntries(
        [
          "legalName",
          "tradingName",
          "legalForm",
          "representative",
          "street",
          "postalCode",
          "city",
          "country",
          "email",
          "vatId",
        ].map((key) => [key, issuerProfile[key] ?? ""]),
      );
      await c.query(
        "INSERT INTO account_grants(id,account_id,actor_id,kind,plan_id,access_until,credits,runtime_seconds,reason,customer_message,receipt,fingerprint,issuer_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [
          b.id,
          account.id,
          actor.id,
          b.kind,
          b.planId,
          b.until,
          b.credits,
          b.minutes * 60,
          why,
          b.customerMessage,
          b.receipt,
          fingerprint,
          JSON.stringify(issuer),
        ],
      );
      await c.query(
        "UPDATE accounts SET credits=credits+$2,runtime_purchased=runtime_purchased+$3,runtime_debt=runtime_debt-$4 WHERE id=$1",
        [account.id, b.credits, balanceChange, settledDebt],
      );
      if (b.planId)
        await c.query(
          "UPDATE accounts SET plan_id=$2,subscription_status='active',access_expires_at=$3,access_source='gift' WHERE id=$1",
          [account.id, b.planId, b.until],
        );
      const w = (
        await c.query(
          "SELECT id FROM workspaces WHERE owner_id=$1 ORDER BY created_at LIMIT 1",
          [targetId],
        )
      ).rows[0];
      if (b.credits)
        await c.query(
          "INSERT INTO ledger(id,workspace_id,amount,reason) VALUES($1,$2,$3,$4)",
          [
            "gift:" + b.id,
            w.id,
            b.credits,
            "Geschenk / Kulanz · 0 EUR · " + b.customerMessage,
          ],
        );
      if (b.minutes)
        await c.query(
          "INSERT INTO runtime_ledger(id,account_id,kind,amount,reason) VALUES($1,$2,'manual_gift',$3,$4)",
          [
            "gift:" + b.id,
            account.id,
            b.minutes * 60,
            "Geschenk / Kulanz · 0 EUR · " + b.customerMessage,
          ],
        );
      await allocateAutomaticPlan(c, account.id, new Date(), actor.id);
      result = { ok: true, id: b.id, amount_cents: 0 };
    }
    await record(c, actor.id, targetId, action, why);
    return result;
  });
}
export async function supportRoute(req: NextRequest, path: string, body: any) {
  let actor: User;
  try {
    actor = (await session(req, true)).user;
    requireAdmin(actor);
  } catch (error) {
    if (path === "support/status")
      return NextResponse.json({
        active: Boolean(req.cookies.get("kc_support")),
        expired: true,
      });
    if (path === "support/exit" && req.method === "POST") {
      const response = NextResponse.json({ ok: true });
      response.cookies.delete("kc_support");
      response.cookies.delete("kc_workspace");
      return response;
    }
    throw error;
  }
  const token = req.cookies.get("kc_support")?.value,
    parent = hashToken(req.cookies.get("kc_session")?.value ?? "");
  if (path === "support/status") {
    if (!token) return NextResponse.json({ active: false });
    const row = (
      await pool.query(
        "SELECT s.mode,s.reason,s.expires_at,s.ended_at,u.name,u.email FROM support_sessions s JOIN users u ON u.id=s.target_id WHERE s.id=$1 AND s.actor_id=$2 AND s.parent_session=$3",
        [hashToken(token), actor.id, parent],
      )
    ).rows[0];
    return NextResponse.json(
      row
        ? {
            active: true,
            ...row,
            expired:
              Boolean(row.ended_at) ||
              new Date(row.expires_at).getTime() <= Date.now(),
          }
        : { active: true, expired: true },
    );
  }
  if (req.method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
  if (path === "support/exit") {
    let previous: string | null = null;
    if (token)
      await transaction(async (c) => {
        const row = (
          await c.query(
            "UPDATE support_sessions SET ended_at=COALESCE(ended_at,now()) WHERE id=$1 AND actor_id=$2 AND parent_session=$3 RETURNING target_id,previous_workspace",
            [hashToken(token), actor.id, parent],
          )
        ).rows[0];
        if (row) {
          previous = row.previous_workspace;
          await audit(c, actor.id, "admin.support.end", row.target_id);
        }
      });
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("kc_support");
    response.cookies.delete("kc_workspace");
    if (
      previous &&
      (
        await pool.query(
          "SELECT 1 FROM workspaces WHERE id=$1 AND owner_id=$2",
          [previous, actor.id],
        )
      ).rowCount
    )
      response.cookies.set("kc_workspace", previous, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.PUBLIC_URL?.startsWith("https://"),
        path: "/",
      });
    return response;
  }
  if (path !== "support/start")
    throw new HttpError(404, "Supportfunktion fehlt.");
  if (token)
    throw new HttpError(409, "Zuerst den aktuellen Supportmodus beenden.");
  const b = z
    .object({
      userId: identifier,
      mode: z.enum(["read", "write"]).default("read"),
      reason,
      confirmEmail: z.string().email(),
      proof: proof.optional(),
    })
    .parse(body);
  await throttleSecurity("admin-proof:" + actor.id);
  const secret = randomBytes(32).toString("hex"),
    expires = new Date(Date.now() + 15 * 60000);
  await transaction(async (c) => {
    await prove(c, actor, req, b);
    const target = (
      await c.query(
        "SELECT id,email,role,suspended,invitation_pending FROM users WHERE id=$1 FOR UPDATE",
        [b.userId],
      )
    ).rows[0];
    if (
      !target ||
      target.role === "admin" ||
      target.suspended ||
      target.invitation_pending ||
      target.email !== b.confirmEmail
    )
      throw new HttpError(
        409,
        "Nur ein aktives Kundenkonto mit bestätigter E-Mail kann geöffnet werden.",
      );
    await c.query(
      "INSERT INTO support_sessions(id,actor_id,parent_session,target_id,previous_workspace,mode,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        hashToken(secret),
        actor.id,
        parent,
        target.id,
        req.cookies.get("kc_workspace")?.value ?? null,
        b.mode,
        b.reason,
        expires,
      ],
    );
    await record(c, actor.id, target.id, "support.start", b.reason);
  });
  const response = NextResponse.json({
    ok: true,
    expiresAt: expires.toISOString(),
  });
  response.cookies.set("kc_support", secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.PUBLIC_URL?.startsWith("https://"),
    path: "/",
    maxAge: 7 * 86400,
  });
  response.cookies.delete("kc_workspace");
  return response;
}
export async function customerBenefits(workspace: Workspace) {
  return {
    account: (
      await pool.query(
        "SELECT plan_id,subscription_status,access_expires_at,access_source,subscription_period_end,subscription_cancel_at FROM accounts WHERE id=$1",
        [workspace.account_id],
      )
    ).rows[0],
    grants: (
      await pool.query(
        "SELECT id,kind,plan_id,access_until,credits,runtime_seconds,amount_cents,customer_message,receipt,created_at FROM account_grants WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
        [workspace.account_id],
      )
    ).rows,
  };
}
function escape(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export async function grantReceipt(
  accountId: string,
  id: string,
  admin = false,
) {
  const g = (
    await pool.query(
      "SELECT g.*,u.name,u.email,p.name plan_name FROM account_grants g JOIN accounts a ON a.id=g.account_id JOIN users u ON u.id=a.owner_id LEFT JOIN plans p ON p.id=g.plan_id WHERE g.id=$1 AND g.account_id=$2 AND(g.receipt OR $3)",
      [id, accountId, admin],
    )
  ).rows[0];
  if (!g) throw new HttpError(404, "Beleg nicht verfügbar.");
  const issuer = g.issuer_snapshot ?? {};
  const issuerHtml = `<h2>Aussteller</h2><p>${[issuer.legalName || "KeRnCloud", issuer.street, [issuer.postalCode, issuer.city].filter(Boolean).join(" "), issuer.email].filter(Boolean).map(escape).join("<br>")}</p>`;
  const html = `<!doctype html><html lang="de"><meta charset="utf-8"><title>KeRnCloud Geschenkbeleg</title><style>body{font:16px system-ui;max-width:780px;margin:60px auto;padding:24px;color:#14212b}dt{font-weight:bold;margin-top:18px}dd{margin:6px 0}small{color:#52616b}</style><h1>Geschenk- / Kulanzbeleg</h1>${issuerHtml}<p>KeRnCloud · ${escape(g.id)}</p><dl><dt>Empfänger</dt><dd>${escape(g.name)} · ${escape(g.email)}</dd><dt>Datum</dt><dd>${escape(new Date(g.created_at).toISOString())}</dd><dt>Leistung</dt><dd>${escape(g.plan_name ?? "Guthaben")} · ${g.credits} KI-Credits · ${g.runtime_seconds / 60} Laufzeit-Minuten</dd><dt>Zugang bis</dt><dd>${escape(g.access_until ? new Date(g.access_until).toISOString() : "Bestehende Planbedingungen")}</dd><dt>Zahlbetrag</dt><dd>0,00 EUR · keine Zahlung</dd></dl><p>${escape(g.customer_message)}</p><small>Unentgeltliche Plattform-Freischaltung. Dieser Beleg ist keine Umsatzsteuerrechnung, keine Rechnungskorrektur und keine steuerliche Gutschrift. Es wurde keine Zahlung ausgelöst.</small></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="kerncloud-geschenk-${g.id}.html"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
