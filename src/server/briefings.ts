import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { queueMail } from "./mail.ts";
import { localClock, quietHour } from "../core/briefing.ts";
export async function briefings(
  user: string,
  workspace: string,
  body?: unknown,
) {
  if (body) {
    const action = z
      .object({ action: z.enum(["configure", "read", "refresh"]) })
      .parse(body).action;
    if (action === "configure") {
      if (!["owner", "admin"].includes(await workspaceRole(user, workspace)))
        throw new HttpError(403, "Workspace-Administration erforderlich.");
      const b = z
        .object({
          enabled: z.boolean(),
          timezone: z.string().max(80),
          local_hour: z.number().int().min(0).max(23),
          quiet_start: z.number().int().min(0).max(23),
          quiet_end: z.number().int().min(0).max(23),
          email: z.boolean(),
          locale: z.enum(["de", "en"]).default("de"),
        })
        .parse(body);
      try {
        localClock(new Date(), b.timezone);
      } catch {
        throw new HttpError(400, "Ungültige Zeitzone.");
      }
      await pool.query(
        "INSERT INTO briefing_preferences(workspace_id,enabled,timezone,local_hour,quiet_start,quiet_end,email,locale) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id) DO UPDATE SET enabled=$2,timezone=$3,local_hour=$4,quiet_start=$5,quiet_end=$6,email=$7,locale=$8",
        [
          workspace,
          b.enabled,
          b.timezone,
          b.local_hour,
          b.quiet_start,
          b.quiet_end,
          b.email,
          b.locale,
        ],
      );
      await transaction((c) => audit(c, user, "briefing.configure", workspace));
    } else if (action === "read") {
      const id = z.object({ id: z.string().uuid() }).parse(body).id;
      await pool.query(
        "INSERT INTO notification_reads(notification_id,user_id) SELECT id,$3 FROM workspace_notifications WHERE id=$1 AND workspace_id=$2 AND (user_id IS NULL OR user_id=$3) ON CONFLICT DO NOTHING",
        [id, workspace, user],
      );
    } else await buildBriefing(workspace, true);
  }
  return {
    preferences: (
      await pool.query(
        "SELECT * FROM briefing_preferences WHERE workspace_id=$1",
        [workspace],
      )
    ).rows[0] ?? {
      enabled: false,
      timezone: "Europe/Berlin",
      local_hour: 8,
      quiet_start: 20,
      quiet_end: 8,
      email: false,
    },
    notifications: (
      await pool.query(
        "SELECT n.id,n.kind,n.title,n.body,n.href,r.read_at,n.created_at FROM workspace_notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$2 WHERE n.workspace_id=$1 AND (n.user_id IS NULL OR n.user_id=$2) ORDER BY n.created_at DESC LIMIT 60",
        [workspace, user],
      )
    ).rows,
    model_calls: 0,
  };
}
async function buildBriefing(workspace: string, manual = false) {
  await transaction(async (c) => {
    if (
      !(
        await c.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) locked", [
          "briefing:" + workspace,
        ])
      ).rows[0].locked
    )
      return;
    const p = (
      await c.query(
        "SELECT * FROM briefing_preferences WHERE workspace_id=$1 FOR UPDATE",
        [workspace],
      )
    ).rows[0] ?? {
      enabled: false,
      timezone: "Europe/Berlin",
      local_hour: 8,
      quiet_start: 20,
      quiet_end: 8,
    };
    const clock = localClock(new Date(), p.timezone);
    if (
      !manual &&
      (!p.enabled ||
        p.last_briefing_day === clock.day ||
        clock.hour < p.local_hour ||
        quietHour(clock.hour, p.quiet_start, p.quiet_end))
    )
      return;
    const latest = Number(
      (
        await c.query(
          "SELECT coalesce(max(id),0) n FROM events WHERE workspace_id=$1",
          [workspace],
        )
      ).rows[0].n,
    );
    const counts = (
      await c.query(
        "SELECT count(*) FILTER(WHERE status='completed') done,count(*) FILTER(WHERE status='failed') failed,count(*) FILTER(WHERE status='input_required') waiting,count(*) FILTER(WHERE status='running') running,coalesce(sum(tokens_used),0) tokens FROM runs WHERE workspace_id=$1 AND created_at>now()-interval '24 hours'",
        [workspace],
      )
    ).rows[0];
    const decisions = Number(
      (
        await c.query(
          "SELECT count(*) n FROM decisions WHERE workspace_id=$1 AND status='pending'",
          [workspace],
        )
      ).rows[0].n,
    );
    const key = manual
      ? `manual:${clock.day}:${Math.floor(Date.now() / 300000)}`
      : `daily:${clock.day}`;
    const body =
      p.locale === "en"
        ? `Last 24 hours: ${counts.done} completed, ${counts.failed} failed, ${counts.running} running, ${counts.waiting} awaiting information. ${decisions} pending decisions. ${counts.tokens} reported tokens. No additional model calls for this overview.`
        : `Letzte 24 Stunden: ${counts.done} abgeschlossen, ${counts.failed} fehlgeschlagen, ${counts.running} laufend, ${counts.waiting} Rückfragen. ${decisions} offene Entscheidungen. ${counts.tokens} gemeldete Tokens. Keine zusätzlichen KI-Aufrufe für diese Übersicht.`;
    const inserted = await c.query(
      "INSERT INTO workspace_notifications(id,workspace_id,kind,title,body,href,source_key) VALUES($1,$2,'briefing',$3,$4,'/decisions',$5) ON CONFLICT DO NOTHING RETURNING id",
      [
        randomUUID(),
        workspace,
        (p.locale === "en" ? "Daily briefing · " : "Tagesübersicht · ") +
          clock.day,
        body,
        key,
      ],
    );
    if (inserted.rowCount && p.email && !manual) {
      const owner = (
        await c.query(
          "SELECT u.id,u.email FROM users u JOIN workspaces w ON w.owner_id=u.id WHERE w.id=$1 AND NOT u.suspended",
          [workspace],
        )
      ).rows[0];
      if (owner)
        await queueMail(
          c,
          owner.id,
          owner.email,
          "briefing",
          "KeRnCloud · Tagesübersicht",
          body +
            "\n" +
            (process.env.PUBLIC_URL ?? "http://localhost:3100") +
            "/briefings",
          new Date(Date.now() + 86400000),
        );
    }
    if (!manual)
      await c.query(
        "UPDATE briefing_preferences SET last_briefing_day=$2,last_event_id=$3 WHERE workspace_id=$1",
        [workspace, clock.day, latest],
      );
  });
}
export async function tickBriefings() {
  for (const row of (
    await pool.query(
      "SELECT workspace_id FROM briefing_preferences WHERE enabled LIMIT 200",
    )
  ).rows)
    try {
      await buildBriefing(row.workspace_id);
    } catch {}
}
export async function workspaceEventNotice(
  workspace: string,
  key: string,
  title: string,
  body: string,
  href = "/overview",
) {
  if (!href.startsWith("/") || href.startsWith("//"))
    throw new HttpError(400, "Ungültiger interner Link.");
  await pool.query(
    "INSERT INTO workspace_notifications(id,workspace_id,kind,title,body,href,source_key) VALUES($1,$2,'event',$3,$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      workspace,
      title.slice(0, 200),
      body.slice(0, 4000),
      href,
      key,
    ],
  );
}
