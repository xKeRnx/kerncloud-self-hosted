import { z } from "zod";
import type { NextRequest } from "next/server";
import type { User } from "../core/types.ts";
import { pool, transaction, audit } from "./db.ts";
import { requireAdmin, HttpError } from "./auth.ts";
import { throttleSecurity } from "./mfa.ts";
export const waitlistConsentVersion = "self-hosted-interest-v1";
const input = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    company: z.string().trim().max(150).default(""),
    use_case: z.string().trim().max(1500).default(""),
    team_size: z
      .enum(["undecided", "solo", "2-10", "11-50", "51+"])
      .default("undecided"),
    deployment: z
      .enum(["undecided", "local", "server", "airgap"])
      .default("undecided"),
    locale: z.enum(["de", "en"]).default("de"),
    consent: z.literal(true),
    website: z.string().max(500).default(""),
  })
  .strict();
export async function submitInterest(body: unknown) {
  const b = input.parse(body);
  if (b.website) return { ok: true };
  // Global cap does not trust client-supplied forwarding headers. Email limiter prevents one address consuming the full cap.
  await throttleSecurity("waitlist:email:" + b.email, 3);
  await throttleSecurity("waitlist:global", 200);
  await pool.query(
    "INSERT INTO self_hosted_interests(email,company,use_case,team_size,deployment,locale,consent_version) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(email) DO UPDATE SET company=EXCLUDED.company,use_case=EXCLUDED.use_case,team_size=EXCLUDED.team_size,deployment=EXCLUDED.deployment,locale=EXCLUDED.locale,consent_version=EXCLUDED.consent_version,consented_at=now(),created_at=now(),updated_at=now(),expires_at=now()+interval '180 days',status='new',note='',revision=self_hosted_interests.revision+1 WHERE self_hosted_interests.expires_at<=now()",
    [
      b.email,
      b.company,
      b.use_case,
      b.team_size,
      b.deployment,
      b.locale,
      waitlistConsentVersion,
    ],
  );
  // Never reveal membership or allow an unauthenticated retry to replace existing contact details or reset retention.
  return { ok: true };
}
function filters(req: NextRequest) {
  const status = z
    .enum(["all", "new", "contacted", "qualified", "archived"])
    .parse(req.nextUrl.searchParams.get("status") ?? "all");
  const query = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 150);
  return { status, query };
}
const where =
  "expires_at>now() AND ($1='all' OR status=$1) AND ($2='' OR position(lower($2) in lower(email||' '||company||' '||use_case))>0)";
const fields =
  "id,email,company,use_case,team_size,deployment,locale,status,note,revision,consent_version,consented_at,created_at,expires_at";
export async function interestAdmin(
  req: NextRequest,
  user: User,
  body: unknown,
) {
  requireAdmin(user);
  if (req.method === "GET") {
    const { status, query } = filters(req);
    const page = Math.max(
      1,
      Math.min(100000, Number(req.nextUrl.searchParams.get("page")) || 1),
    );
    const [rows, count, summary, deployments] = await Promise.all([
      pool.query(
        "SELECT " +
          fields +
          " FROM self_hosted_interests WHERE " +
          where +
          " ORDER BY created_at DESC,id LIMIT 25 OFFSET $3",
        [status, query, (page - 1) * 25],
      ),
      pool.query(
        "SELECT count(*)::int total FROM self_hosted_interests WHERE " + where,
        [status, query],
      ),
      pool.query(
        "SELECT count(*)::int total,count(*) FILTER(WHERE status='new')::int new,count(*) FILTER(WHERE status='qualified')::int qualified,count(*) FILTER(WHERE created_at>=now()-interval '30 days')::int recent FROM self_hosted_interests WHERE expires_at>now()",
      ),
      pool.query(
        "SELECT deployment,count(*)::int total FROM self_hosted_interests WHERE expires_at>now() GROUP BY deployment",
      ),
    ]);
    return {
      items: rows.rows,
      total: count.rows[0].total,
      page,
      page_size: 25,
      summary: summary.rows[0],
      deployments: deployments.rows,
    };
  }
  if (req.method !== "POST") throw new HttpError(405, "Methode nicht erlaubt.");
  const b = z
    .object({
      action: z.enum(["update", "delete"]),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      status: z.enum(["new", "contacted", "qualified", "archived"]).optional(),
      note: z.string().trim().max(3000).optional(),
    })
    .strict()
    .parse(body);
  return transaction(async (c) => {
    const row = (
      await c.query(
        "SELECT id,revision FROM self_hosted_interests WHERE id=$1 FOR UPDATE",
        [b.id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Eintrag nicht gefunden.");
    if (row.revision !== b.revision)
      throw new HttpError(409, "Eintrag wurde geändert. Bitte erneut laden.");
    if (b.action === "delete")
      await c.query("DELETE FROM self_hosted_interests WHERE id=$1", [b.id]);
    else
      await c.query(
        "UPDATE self_hosted_interests SET status=coalesce($2,status),note=coalesce($3,note),revision=revision+1,updated_at=now() WHERE id=$1",
        [b.id, b.status ?? null, b.note ?? null],
      );
    await audit(c, user.id, "self_hosted.interest." + b.action, b.id);
    return { ok: true };
  });
}
export function csvCell(value: unknown) {
  let v = String(value ?? "");
  if (/^\s*[=+@-]/.test(v) || /^[\t\r\n]/.test(v)) v = "'" + v;
  return '"' + v.replaceAll('"', '""') + '"';
}
export async function exportInterests(req: NextRequest, user: User) {
  requireAdmin(user);
  const { status, query } = filters(req);
  const rows = (
    await pool.query(
      "SELECT " +
        fields +
        " FROM self_hosted_interests WHERE " +
        where +
        " ORDER BY created_at DESC,id LIMIT 5001",
      [status, query],
    )
  ).rows;
  if (rows.length > 5000)
    throw new HttpError(
      413,
      "Bitte Export über die Suche oder den Status auf höchstens 5.000 Einträge eingrenzen.",
    );
  await transaction((c) =>
    audit(c, user.id, "self_hosted.interest.export", "filtered-list"),
  );
  const keys = [
    "email",
    "company",
    "use_case",
    "team_size",
    "deployment",
    "locale",
    "status",
    "note",
    "consent_version",
    "consented_at",
    "created_at",
    "expires_at",
  ];
  return (
    "\uFEFF" +
    [
      keys,
      ...rows.map((row) =>
        keys.map((k) =>
          row[k] instanceof Date ? row[k].toISOString() : row[k],
        ),
      ),
    ]
      .map((r) => r.map(csvCell).join(";"))
      .join("\r\n")
  );
}
