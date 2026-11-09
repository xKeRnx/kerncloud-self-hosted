import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { pool, transaction } from "./db.ts";
import { HttpError } from "./auth.ts";
import { hashToken } from "./security.ts";
import { z } from "zod";
export function environmentBase() {
  const url = new URL(
    process.env.PUBLIC_ENVIRONMENT_URL ?? "http://localhost:3200",
  );
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.hostname === "127.0.0.1" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    )
  )
    throw new Error(
      "PUBLIC_ENVIRONMENT_URL benötigt eine HTTPS-Basisdomain; lokal http://localhost:3200.",
    );
  if (
    url.hostname ===
      new URL(process.env.PUBLIC_URL ?? "http://localhost:3100").hostname &&
    url.port === new URL(process.env.PUBLIC_URL ?? "http://localhost:3100").port
  )
    throw new Error("Kundenzugang benötigt eine eigene Origin.");
  return url;
}
export function environmentOrigin(id: string) {
  const u = environmentBase();
  u.hostname = `${id}.${u.hostname}`;
  return u.origin;
}
export function environmentHost(host: string) {
  const base = environmentBase();
  const expectedPort = base.port;
  const u = new URL(`${base.protocol}//${host}`);
  if (
    u.port !== expectedPort ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    return null;
  const suffix = `.${base.hostname}`;
  if (!u.hostname.endsWith(suffix)) return null;
  const id = u.hostname.slice(0, -suffix.length);
  return z.string().uuid().safeParse(id).success ? id : null;
}
export const accessSql = `SELECT e.*,w.owner_id FROM customer_environments e JOIN workspaces w ON w.id=e.workspace_id JOIN accounts a ON a.owner_id=w.owner_id JOIN plans p ON p.id=a.plan_id JOIN users u ON u.id=w.owner_id JOIN infrastructure_hosts h ON h.id=e.host_id WHERE e.id=$1 AND e.generation=$2 AND e.status='running' AND NOT e.access_blocked AND NOT u.suspended AND (a.access_expires_at IS NULL OR a.access_expires_at>now()) AND h.enabled AND h.last_seen>now()-interval '60 seconds' AND ((e.billing_source='hosted' AND h.customer_account_id IS NULL) OR (e.billing_source='customer' AND h.customer_account_id=a.id)) AND (NOT e.self_service OR (e.billing_active AND a.subscription_status IN('active','local_test') AND p.active AND p.environment_templates ? e.template_id AND ((e.billing_source='hosted' AND e.paid_until>now() AND a.runtime_debt=0 AND NOT a.runtime_disputed AND p.max_environments>0) OR (e.billing_source='customer' AND p.max_local_environments>0))))`;
export async function validParent(c: any, parent: string, environment: any) {
  return Boolean(
    (
      await c.query(
        "SELECT 1 FROM sessions s WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at>now() AND(s.mfa_verified OR NOT EXISTS(SELECT 1 FROM account_security x WHERE x.user_id=s.user_id AND x.totp_secret IS NOT NULL))",
        [parent, environment.owner_id],
      )
    ).rowCount,
  );
}
export async function launchEnvironment(
  req: NextRequest,
  workspaceId: string,
  body: unknown,
  projectId?: string | null,
) {
  const { id, target_path } = z
    .object({
      id: z.string().uuid(),
      target_path: z
        .string()
        .regex(/^\/proxy\/[1-9][0-9]{3,4}\/$/)
        .default("/proxy/3000/"),
    })
    .parse(body);
  const target = (body as any)?.target_path ? target_path : "/";
  const token = randomBytes(32).toString("base64url");
  await transaction(async (c) => {
    const row = (
      await c.query(
        "SELECT generation FROM customer_environments WHERE id=$1 AND workspace_id=$2 AND project_id=coalesce($3,kc_default_project($2))",
        [id, workspaceId, projectId ?? null],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Umgebung fehlt in diesem Workspace.");
    const environment = (await c.query(accessSql, [id, row.generation]))
      .rows[0];
    const parent = hashToken(req.cookies.get("kc_session")?.value ?? "");
    if (!environment || !(await validParent(c, parent, environment)))
      throw new HttpError(
        409,
        "Umgebung läuft nicht oder der Zugang ist gesperrt.",
      );
    if (
      !environment.relay_seen ||
      Date.now() - Date.parse(environment.relay_seen) > 15000
    )
      throw new HttpError(
        503,
        "Der geschützte Verbindungskanal ist noch nicht bereit.",
      );
    await c.query(
      "INSERT INTO environment_tickets(id,environment_id,generation,parent_session,target_path) VALUES($1,$2,$3,$4,$5)",
      [hashToken(token), id, row.generation, parent, target],
    );
  });
  return { url: `${environmentOrigin(id)}/_launch?ticket=${token}` };
}
