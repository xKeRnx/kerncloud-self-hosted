import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { projectFor } from "./organisation.ts";
import { connection, manage, active, reserve } from "./content-research.ts";
import { appAccess, appFetch } from "./work-apps.ts";
import {
  sourceInput,
  socialPlan,
  inboxItems,
  replyPlan,
  analyticsMetrics,
} from "../core/social.ts";
import { money, budgetFits } from "../core/studio-research.ts";
import { lockTask } from "./store.ts";
const uid = z.string().uuid();
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const conflict = (message: string) => new HttpError(409, message);
async function socialConnection(
  c: any,
  workspace: string,
  project: string,
  id: string,
  agent?: string,
) {
  const co = await connection(c, workspace, project, id, agent);
  if (co.provider !== "ayrshare")
    throw new HttpError(400, "Choose an Ayrshare connection");
  return co;
}
async function quote(
  c: PoolClient,
  project: string,
  id: string,
  operation: "read" | "reply",
) {
  const p = (
    await c.query(
      "SELECT * FROM social_prices WHERE project_id=$1 AND connection_id=$2 AND operation=$3 AND valid_until>now() FOR SHARE",
      [project, id, operation],
    )
  ).rows[0];
  if (!p)
    throw conflict("Confirm a current social read/reply price ceiling first");
  return p;
}
async function itemFor(c: any, workspace: string, project: string, id: string) {
  const item = (
    await c.query(
      "SELECT i.*,s.workspace_id,s.project_id,s.connection_id,s.kind,s.platform,s.label,s.enabled FROM social_items i JOIN social_sources s ON s.id=i.source_id WHERE i.id=$1 AND s.workspace_id=$2 AND s.project_id=$3",
      [id, workspace, project],
    )
  ).rows[0];
  if (!item)
    throw new HttpError(404, "Social item unavailable in this project");
  return item;
}
async function currentItem(c: any, item: any) {
  if (!item.enabled || !item.replyable || item.direction !== "received")
    throw conflict("This item cannot receive a reply");
  if (item.kind === "messages" && item.thread_id) {
    const latest = (
      await c.query(
        "SELECT id FROM social_items WHERE source_id=$1 AND thread_id=$2 AND direction='received' ORDER BY provider_at DESC NULLS LAST,created_at DESC,id DESC LIMIT 1",
        [item.source_id, item.thread_id],
      )
    ).rows[0];
    if (latest?.id !== item.id)
      throw conflict(
        "The conversation changed; review the newest incoming message",
      );
  }
}
export async function socialSnapshot(
  actor: string,
  workspace: string,
  project: string,
) {
  const role = await workspaceRole(actor, workspace);
  await projectFor(pool, workspace, project);
  const [sources, items, replies, prices, connections, budgets, metrics] =
    await Promise.all([
      pool.query(
        "SELECT s.*,(SELECT status FROM social_fetches f WHERE f.source_id=s.id ORDER BY started_at DESC LIMIT 1) fetch_status FROM social_sources s WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at LIMIT 100",
        [workspace, project],
      ),
      pool.query(
        "SELECT i.*,s.kind,s.platform,s.label,s.connection_id FROM social_items i JOIN social_sources s ON s.id=i.source_id WHERE s.workspace_id=$1 AND s.project_id=$2 ORDER BY i.provider_at DESC NULLS LAST,i.retrieved_at DESC LIMIT 200",
        [workspace, project],
      ),
      pool.query(
        "SELECT r.*,i.author,i.recipient,i.body original_body,i.revision item_revision,i.retrieved_at,s.platform,s.label,s.kind,s.connection_id FROM social_replies r JOIN social_items i ON i.id=r.item_id JOIN social_sources s ON s.id=i.source_id WHERE r.workspace_id=$1 AND r.project_id=$2 ORDER BY r.updated_at DESC LIMIT 100",
        [workspace, project],
      ),
      pool.query("SELECT * FROM social_prices WHERE project_id=$1", [project]),
      pool.query(
        "SELECT id,name,revision,write_enabled FROM work_app_connections WHERE workspace_id=$1 AND enabled AND provider='ayrshare' AND (project_ids IS NULL OR project_ids ? $2)",
        [workspace, project],
      ),
      pool.query(
        "SELECT * FROM project_external_budgets WHERE project_id=$1 AND workspace_id=$2",
        [project, workspace],
      ),
      pool.query(
        "SELECT a.*,s.label,s.platform,s.target FROM social_analytics a JOIN social_sources s ON s.id=a.source_id WHERE s.workspace_id=$1 AND s.project_id=$2 ORDER BY a.retrieved_at DESC LIMIT 200",
        [workspace, project],
      ),
    ]);
  return {
    role,
    sources: sources.rows,
    items: items.rows,
    replies: replies.rows,
    prices: prices.rows,
    connections: connections.rows,
    budget: budgets.rows[0] ?? {
      cost_limit: 0,
      cost_used: 0,
      request_limit: 0,
      requests_used: 0,
      revision: 0,
    },
    analytics: metrics.rows,
  };
}
export async function socialReviews(actor: string, workspace: string) {
  const role = await workspaceRole(actor, workspace);
  const replies = (
    await pool.query(
      "SELECT r.*,i.author,i.recipient,i.body original_body,i.revision item_revision,i.retrieved_at,s.platform,s.kind,s.label,s.connection_id,p.name project_name,co.name connection_name,co.revision connection_revision,q.price_micro_usd,q.revision price_revision,q.valid_until,b.revision budget_revision FROM social_replies r JOIN social_items i ON i.id=r.item_id JOIN social_sources s ON s.id=i.source_id JOIN workspace_projects p ON p.id=r.project_id LEFT JOIN work_app_connections co ON co.id=s.connection_id LEFT JOIN social_prices q ON q.project_id=r.project_id AND q.connection_id=s.connection_id AND q.operation='reply' LEFT JOIN project_external_budgets b ON b.project_id=r.project_id WHERE r.workspace_id=$1 AND r.status='review' ORDER BY r.updated_at DESC LIMIT 100",
      [workspace],
    )
  ).rows;
  return { role, replies };
}
export async function socialAction(
  actor: string,
  workspace: string,
  project: string,
  input: unknown,
) {
  await manage(actor, workspace);
  await projectFor(pool, workspace, project);
  const action = z
    .object({
      action: z.enum([
        "source",
        "toggle_source",
        "price",
        "sync",
        "archive",
        "reply",
        "approve",
        "reject",
        "cancel",
      ]),
    })
    .passthrough()
    .parse(input).action;
  if (action === "sync")
    return syncSocial(
      workspace,
      project,
      z
        .object({
          action: z.literal("sync"),
          id: uid,
          request_id: uid,
          next: z.boolean().default(false),
          retry_uncertain: z.boolean().default(false),
        })
        .strict()
        .parse(input),
    );
  return transaction(async (c) => {
    if (action === "source") {
      const b = z
          .object({ action: z.literal("source"), source: sourceInput })
          .strict()
          .parse(input),
        v = b.source;
      await socialConnection(c, workspace, project, v.connection_id);
      await c.query(
        "SELECT id FROM workspace_projects WHERE id=$1 FOR UPDATE",
        [project],
      );
      if (
        Number(
          (
            await c.query(
              "SELECT count(*) FROM social_sources WHERE project_id=$1",
              [project],
            )
          ).rows[0].count,
        ) >= 100
      )
        throw conflict("Maximum 100 social sources per project");
      const id = randomUUID();
      await c.query(
        "INSERT INTO social_sources(id,workspace_id,project_id,connection_id,kind,platform,target,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          workspace,
          project,
          v.connection_id,
          v.kind,
          v.platform,
          v.target ?? "",
          v.label,
        ],
      );
      await audit(c, actor, "social.source", id);
      return { id };
    }
    if (action === "toggle_source") {
      const b = z
        .object({
          action: z.literal("toggle_source"),
          id: uid,
          enabled: z.boolean(),
        })
        .strict()
        .parse(input);
      const changed = await c.query(
        "UPDATE social_sources SET enabled=$4 WHERE id=$1 AND workspace_id=$2 AND project_id=$3 RETURNING id",
        [b.id, workspace, project, b.enabled],
      );
      if (!changed.rowCount)
        throw new HttpError(404, "Social source unavailable");
      await audit(c, actor, "social.source.enabled", b.id);
      return { ok: true };
    }
    if (action === "price") {
      const b = z
        .object({
          action: z.literal("price"),
          connection_id: uid,
          operation: z.enum(["read", "reply"]),
          price: money,
          valid_until: z.string().datetime({ offset: true }),
          confirm: z.literal(true),
        })
        .strict()
        .parse(input);
      await socialConnection(c, workspace, project, b.connection_id);
      const expiry = Date.parse(b.valid_until);
      if (expiry <= Date.now() || expiry > Date.now() + 31 * 86400000)
        throw new HttpError(400, "Confirm a ceiling valid for at most 31 days");
      await c.query(
        "INSERT INTO social_prices(project_id,connection_id,operation,price_micro_usd,valid_until) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,connection_id,operation) DO UPDATE SET price_micro_usd=$4,valid_until=$5,revision=social_prices.revision+1",
        [project, b.connection_id, b.operation, b.price, b.valid_until],
      );
      await audit(c, actor, "social.price." + b.operation, b.connection_id);
      return { ok: true };
    }
    if (action === "archive") {
      const b = z
        .object({
          action: z.literal("archive"),
          id: uid,
          archived: z.boolean(),
        })
        .strict()
        .parse(input);
      await itemFor(c, workspace, project, b.id);
      await c.query("UPDATE social_items SET archived=$2 WHERE id=$1", [
        b.id,
        b.archived,
      ]);
      return { ok: true };
    }
    if (action === "reply") {
      const b = z
        .object({
          action: z.literal("reply"),
          item_id: uid,
          expected_item_revision: z.number().int().positive(),
          text: z.string().trim().min(1).max(2000),
          id: uid.optional(),
          expected_revision: z.number().int().positive().optional(),
        })
        .strict()
        .parse(input);
      return saveReply(c, workspace, project, b);
    }
    const b = z
      .object({
        action: z.enum(["approve", "reject", "cancel"]),
        id: uid,
        expected_revision: z.number().int().positive(),
        confirm: z.boolean().optional(),
        expected_item_revision: z.number().int().optional(),
        expected_connection_revision: z.number().int().optional(),
        expected_price_revision: z.number().int().optional(),
        expected_budget_revision: z.number().int().optional(),
        expected_price: z
          .string()
          .regex(/^\d{1,12}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    const r = (
      await c.query(
        "SELECT * FROM social_replies WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
        [b.id, workspace, project],
      )
    ).rows[0];
    if (!r || r.revision !== b.expected_revision)
      throw conflict("Reply changed; reload the exact preview");
    if (["sending", "submitted", "uncertain"].includes(r.status))
      throw conflict("A dispatched reply cannot be changed or repeated");
    if (action === "approve") {
      if (r.status !== "review" || !b.confirm)
        throw conflict("Review and explicitly confirm this exact reply first");
      const item = await itemFor(c, workspace, project, r.item_id);
      await currentItem(c, item);
      const co = await socialConnection(
        c,
        workspace,
        project,
        item.connection_id,
      );
      if (!co.write_enabled)
        throw new HttpError(
          403,
          "Enable publishing on the assigned Ayrshare connection first",
        );
      const q = await quote(c, project, co.id, "reply"),
        budget = (
          await c.query(
            "SELECT * FROM project_external_budgets WHERE project_id=$1",
            [project],
          )
        ).rows[0];
      if (!budget || !budgetFits(budget, Number(q.price_micro_usd)))
        throw conflict("Set a sufficient fixed external budget first");
      if (
        b.expected_item_revision !== item.revision ||
        b.expected_connection_revision !== co.revision ||
        b.expected_price_revision !== q.revision ||
        b.expected_budget_revision !== budget.revision ||
        b.expected_price !== String(q.price_micro_usd)
      )
        throw conflict(
          "Connection, price or budget changed since preview. Reload and review again",
        );
      const plan = replyPlan(item, r.body),
        approval = {
          hash: hash(plan),
          item_revision: item.revision,
          connection_revision: co.revision,
          price_revision: q.revision,
          budget_revision: budget.revision,
        };
      await c.query(
        "UPDATE social_replies SET status='queued',approval=$2,approved_by=$3,last_error=NULL,updated_at=now() WHERE id=$1",
        [r.id, JSON.stringify(approval), actor],
      );
    } else
      await c.query(
        "UPDATE social_replies SET status=$2,approval=NULL,last_error=NULL,updated_at=now() WHERE id=$1",
        [r.id, action === "reject" ? "rejected" : "canceled"],
      );
    await audit(c, actor, "social.reply." + action, r.id);
    return { ok: true };
  });
}
async function saveReply(
  c: PoolClient,
  workspace: string,
  project: string,
  b: any,
  agent?: string,
) {
  const first = await itemFor(c, workspace, project, b.item_id);
  // Match the sender's lock order; then serialize against incoming syncs.
  await c.query(
    "SELECT id FROM social_replies WHERE item_id=$1 AND status NOT IN('rejected','canceled') FOR UPDATE",
    [b.item_id],
  );
  await c.query("SELECT id FROM social_sources WHERE id=$1 FOR UPDATE", [
    first.source_id,
  ]);
  const item = await itemFor(c, workspace, project, b.item_id);
  await socialConnection(c, workspace, project, item.connection_id, agent);
  await currentItem(c, item);
  if (item.revision !== b.expected_item_revision)
    throw conflict("The incoming item changed; reload before drafting");
  replyPlan(item, b.text);
  const old = (
    await c.query(
      "SELECT * FROM social_replies WHERE item_id=$1 AND status NOT IN('rejected','canceled') FOR UPDATE",
      [item.id],
    )
  ).rows[0];
  if (
    old &&
    (!b.id ||
      b.id !== old.id ||
      b.expected_revision !== old.revision ||
      ["sending", "submitted", "uncertain"].includes(old.status))
  )
    throw conflict(
      "A reply already exists; review its current status before continuing",
    );
  const id = old?.id ?? randomUUID(),
    revision = (old?.revision ?? 0) + 1;
  if (old)
    await c.query(
      "UPDATE social_replies SET body=$2,revision=$3,status='review',approval=NULL,last_error=NULL,updated_at=now() WHERE id=$1",
      [id, b.text, revision],
    );
  else
    await c.query(
      "INSERT INTO social_replies(id,workspace_id,project_id,item_id,body) VALUES($1,$2,$3,$4,$5)",
      [id, workspace, project, item.id, b.text],
    );
  await c.query(
    "INSERT INTO social_reply_versions(reply_id,revision,body) VALUES($1,$2,$3)",
    [id, revision, b.text],
  );
  return { id, revision, status: "review" };
}
export async function syncSocial(
  workspace: string,
  project: string,
  b: {
    id: string;
    request_id: string;
    next: boolean;
    retry_uncertain: boolean;
  },
) {
  const claim = await transaction(async (c) => {
    await active(c, workspace, project);
    const source = (
      await c.query(
        "SELECT * FROM social_sources WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND enabled FOR UPDATE",
        [b.id, workspace, project],
      )
    ).rows[0];
    if (!source) throw new HttpError(404, "Social source unavailable");
    const co = await socialConnection(
      c,
      workspace,
      project,
      source.connection_id,
    );
    const prior = (
      await c.query(
        "SELECT * FROM social_fetches WHERE source_id=$1 ORDER BY started_at DESC LIMIT 1",
        [source.id],
      )
    ).rows[0];
    const same = (
      await c.query("SELECT * FROM social_fetches WHERE id=$1", [b.request_id])
    ).rows[0];
    if (same) {
      if (same.source_id !== source.id || same.status !== "done")
        throw conflict(
          "This social fetch already started; inspect its receipt",
        );
      return { cached: true };
    }
    if (prior?.status === "running")
      throw conflict("A social fetch is already running");
    if (prior?.status === "uncertain" && !b.retry_uncertain)
      throw conflict(
        "Social fetch outcome uncertain; explicitly confirm a new paid read attempt",
      );
    if (
      !b.next &&
      prior?.status === "done" &&
      prior.connection_revision === co.revision &&
      source.last_fetch &&
      Date.now() - new Date(source.last_fetch).getTime() < 600000
    )
      return { cached: true };
    if (
      b.next &&
      (!source.next_cursor ||
        source.kind !== "messages" ||
        prior?.connection_revision !== co.revision)
    )
      throw conflict("No continuation is available; refresh the first page");
    const q = await quote(c, project, co.id, "read"),
      reservation = await reserve(
        c,
        workspace,
        project,
        co.id,
        "Social " + source.kind + ": " + source.label,
        undefined,
        q,
      );
    await c.query(
      "INSERT INTO social_fetches(id,source_id,status,connection_revision,receipt_id) VALUES($1,$2,'running',$3,$4)",
      [b.request_id, source.id, co.revision, reservation.receipt],
    );
    return {
      source,
      co,
      reservation,
      plan: socialPlan(source, b.next ? source.next_cursor : null),
    };
  });
  if ("cached" in claim) return { cached: true };
  try {
    const { row, token } = await appAccess(claim.co.id, workspace);
    if (row.revision !== claim.co.revision) throw Error("Connection changed");
    await active(pool, workspace, project);
    const raw = await appFetch(
      token,
      claim.plan.url,
      claim.plan.method,
      claim.plan.body,
      undefined,
      "ayrshare",
    );
    const items =
        claim.source.kind === "analytics" ? [] : inboxItems(claim.source, raw),
      metrics =
        claim.source.kind === "analytics"
          ? analyticsMetrics(claim.source.platform, raw)
          : null;
    const next =
      claim.source.kind === "messages" &&
      raw.meta?.pagination?.hasMore === true &&
      typeof raw.meta.pagination.next === "string"
        ? raw.meta.pagination.next.slice(0, 4000)
        : null;
    await transaction(async (c) => {
      await c.query("SELECT id FROM social_sources WHERE id=$1 FOR UPDATE", [
        claim.source.id,
      ]);
      const f = (
        await c.query(
          "SELECT status FROM social_fetches WHERE id=$1 FOR UPDATE",
          [b.request_id],
        )
      ).rows[0];
      if (f?.status !== "running") throw Error("Fetch claim expired");
      for (const i of items) {
        const h = hash(i);
        await c.query(
          "INSERT INTO social_items(id,source_id,external_id,thread_id,author,recipient,body,direction,provider_at,context,replyable,body_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(source_id,external_id) DO UPDATE SET thread_id=$4,author=$5,recipient=$6,body=$7,direction=$8,provider_at=$9,context=$10,replyable=$11,revision=social_items.revision+CASE WHEN social_items.body_hash<>$12 THEN 1 ELSE 0 END,body_hash=$12,retrieved_at=now()",
          [
            randomUUID(),
            claim.source.id,
            i.external_id,
            i.thread_id,
            i.author,
            i.recipient,
            i.text,
            i.direction,
            i.provider_at,
            JSON.stringify(i.context),
            i.replyable,
            h,
          ],
        );
      }
      if (metrics)
        await c.query(
          "INSERT INTO social_analytics(id,source_id,fetch_id,metrics,provider_updated_at) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            claim.source.id,
            b.request_id,
            JSON.stringify(metrics.metrics),
            metrics.provider_updated_at,
          ],
        );
      await c.query(
        "UPDATE social_sources SET last_fetch=now(),next_cursor=$2 WHERE id=$1",
        [claim.source.id, next],
      );
      await c.query(
        "UPDATE social_fetches SET status='done',finished_at=now() WHERE id=$1",
        [b.request_id],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='confirmed' WHERE id=$1",
        [claim.reservation.receipt],
      );
    });
    return { ok: true, items: items.length, has_more: !!next };
  } catch {
    await transaction(async (c) => {
      await c.query(
        "UPDATE social_fetches SET status='uncertain',finished_at=now() WHERE id=$1 AND status='running'",
        [b.request_id],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='uncertain' WHERE id=$1",
        [claim.reservation.receipt],
      );
    });
    throw conflict(
      "Social fetch outcome uncertain; explicitly confirm a new paid read attempt",
    );
  }
}
export async function dispatchSocialReply() {
  const claim = await transaction(async (c) => {
    const r = (
      await c.query(
        "SELECT r.* FROM social_replies r JOIN workspace_projects p ON p.id=r.project_id JOIN workspaces w ON w.id=r.workspace_id JOIN users u ON u.id=w.owner_id JOIN accounts a ON a.owner_id=w.owner_id WHERE r.status='queued' AND p.status='active' AND NOT w.execution_paused AND NOT u.suspended AND (a.access_expires_at IS NULL OR a.access_expires_at>now()) ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!r) return null;
    try {
      const first = await itemFor(c, r.workspace_id, r.project_id, r.item_id);
      await c.query("SELECT id FROM social_sources WHERE id=$1 FOR UPDATE", [
        first.source_id,
      ]);
      const item = await itemFor(c, r.workspace_id, r.project_id, r.item_id);
      await currentItem(c, item);
      const co = await socialConnection(
          c,
          r.workspace_id,
          r.project_id,
          item.connection_id,
        ),
        q = await quote(c, r.project_id, co.id, "reply"),
        plan = replyPlan(item, r.body);
      if (
        !co.write_enabled ||
        !r.approval ||
        item.revision !== r.approval.item_revision ||
        co.revision !== r.approval.connection_revision ||
        hash(plan) !== r.approval.hash
      )
        throw conflict(
          "Reply approval is stale; review the current item and exact reply again",
        );
      const reservation = await reserve(
          c,
          r.workspace_id,
          r.project_id,
          co.id,
          "Social reply to " + item.author,
          r.approval,
          q,
        ),
        token = randomUUID();
      await c.query(
        "UPDATE social_replies SET status='sending',dispatch_token=$2,dispatched_at=now(),updated_at=now() WHERE id=$1",
        [r.id, token],
      );
      return { r, item, co, plan, reservation, token };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await c.query(
        "UPDATE social_replies SET status='blocked',last_error=$2,updated_at=now() WHERE id=$1",
        [r.id, e.message],
      );
      return null;
    }
  });
  if (!claim) return;
  try {
    const { row, token } = await appAccess(claim.co.id, claim.r.workspace_id);
    if (row.revision !== claim.co.revision || !row.write_enabled)
      throw Error("Grant changed");
    await active(pool, claim.r.workspace_id, claim.r.project_id);
    const result = await appFetch(
      token,
      claim.plan.url,
      claim.plan.method,
      claim.plan.body,
      undefined,
      "ayrshare",
    );
    const receipt = {
      provider: "ayrshare",
      id:
        typeof result.messageId === "string"
          ? result.messageId.slice(0, 500)
          : typeof result.id === "string"
            ? result.id.slice(0, 500)
            : null,
      status:
        typeof result.status === "string"
          ? result.status.slice(0, 50)
          : "accepted",
    };
    await transaction(async (c) => {
      await c.query(
        "UPDATE social_replies SET status='submitted',receipt=$3,updated_at=now() WHERE id=$1 AND dispatch_token=$2 AND status='sending'",
        [claim.r.id, claim.token, JSON.stringify(receipt)],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='confirmed' WHERE id=$1",
        [claim.reservation.receipt],
      );
    });
  } catch {
    await transaction(async (c) => {
      await c.query(
        "UPDATE social_replies SET status='uncertain',last_error='Provider outcome uncertain. Inspect Ayrshare before taking further action; this reply will not be repeated',updated_at=now() WHERE id=$1 AND dispatch_token=$2",
        [claim.r.id, claim.token],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='uncertain' WHERE id=$1",
        [claim.reservation.receipt],
      );
    });
  }
}
export async function expireSocialClaims() {
  await pool.query(
    "UPDATE social_replies SET status='uncertain',last_error='Sender interrupted; inspect provider before taking further action' WHERE status='sending' AND dispatched_at<now()-interval '5 minutes'",
  );
  await pool.query(
    "UPDATE social_fetches SET status='uncertain',finished_at=now() WHERE status='running' AND started_at<now()-interval '5 minutes'",
  );
}
export async function socialAgentStep(
  taskId: string,
  lease: string,
  callId: string,
  name: string,
  args: unknown,
) {
  return transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease),
      op = taskId + ":" + callId;
    const old = (await c.query("SELECT * FROM operations WHERE id=$1", [op]))
      .rows[0];
    if (old?.status === "done") return old.result;
    if (old) throw conflict("Operation already started");
    let result: any;
    if (name === "save_social_reply") {
      const b = z
        .object({
          item_id: uid,
          expected_item_revision: z.number().int().positive(),
          text: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(args);
      result = await saveReply(
        c,
        task.workspace_id,
        run.project_id!,
        b,
        task.agent_id,
      );
    } else {
      const b = z
        .object({
          item_id: uid.optional(),
          analytics: z.boolean().default(false),
        })
        .strict()
        .parse(args);
      if (b.analytics)
        result = {
          snapshots: (
            await c.query(
              "SELECT * FROM (SELECT DISTINCT ON(s.id) s.id source_id,s.label,s.platform,a.metrics,a.retrieved_at,a.provider_updated_at FROM social_analytics a JOIN social_sources s ON s.id=a.source_id JOIN work_app_connections co ON co.id=s.connection_id WHERE s.workspace_id=$1 AND s.project_id=$2 AND s.enabled AND co.enabled AND co.agent_ids ? $3 AND (co.project_ids IS NULL OR co.project_ids ? $2) ORDER BY s.id,a.retrieved_at DESC) v LIMIT 20",
              [task.workspace_id, run.project_id, task.agent_id],
            )
          ).rows,
          note: "Lifetime snapshots; do not add repeated fetches or compare different platform metric definitions. Missing fields are unknown. No provider request.",
        };
      else if (b.item_id) {
        const i = await itemFor(
          c,
          task.workspace_id,
          run.project_id!,
          b.item_id,
        );
        await socialConnection(
          c,
          task.workspace_id,
          run.project_id!,
          i.connection_id,
          task.agent_id,
        );
        result = {
          item_id: i.id,
          revision: i.revision,
          platform: i.platform,
          author: i.author,
          recipient: i.recipient,
          text: i.body.slice(0, 2000),
          retrieved_at: i.retrieved_at,
          replyable: i.replyable,
          untrusted_content: true,
        };
      } else
        result = {
          untrusted_content: true,
          items: (
            await c.query(
              "SELECT i.id item_id,i.revision,s.platform,i.author,left(i.body,160) excerpt,i.retrieved_at FROM social_items i JOIN social_sources s ON s.id=i.source_id JOIN work_app_connections co ON co.id=s.connection_id WHERE s.workspace_id=$1 AND s.project_id=$2 AND s.enabled AND NOT i.archived AND co.enabled AND co.agent_ids ? $3 AND (co.project_ids IS NULL OR co.project_ids ? $2) ORDER BY i.retrieved_at DESC LIMIT 30",
              [task.workspace_id, run.project_id, task.agent_id],
            )
          ).rows,
          note: "Read one item_id for its text. Never approve or send. Request human review with save_social_reply and finish.",
        };
    }
    const output = { result: JSON.stringify(result), yield: false };
    await c.query(
      "INSERT INTO operations(id,task_id,tool_name,status,result) VALUES($1,$2,$3,'done',$4)",
      [op, taskId, name, JSON.stringify(output)],
    );
    return output;
  });
}
