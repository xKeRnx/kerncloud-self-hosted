import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, transaction, audit } from "./db.ts";
import { HttpError } from "./auth.ts";
import { workspaceRole } from "./team.ts";
import { projectFor, assertProjectAgent } from "./organisation.ts";
import {
  postInput,
  money,
  budgetFits,
  researchProviders,
  searchPlan,
  sourceResults,
  compactResearch,
} from "../core/studio-research.ts";
import { appAccess, appFetch } from "./work-apps.ts";
import { createRun, lockTask } from "./store.ts";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uid = z.string().uuid();
export async function manage(actor: string, workspace: string) {
  if (!["owner", "admin"].includes(await workspaceRole(actor, workspace)))
    throw new HttpError(403, "Workspace administration required");
}
export async function connection(
  c: Pick<PoolClient, "query">,
  workspace: string,
  project: string,
  id: string,
  agent?: string,
) {
  const row = (
    await c.query(
      "SELECT * FROM work_app_connections WHERE id=$1 AND workspace_id=$2 AND enabled AND (project_ids IS NULL OR project_ids ? $3)",
      [id, workspace, project],
    )
  ).rows[0];
  if (!row || (agent && !row.agent_ids.includes(agent)))
    throw new HttpError(403, "Connection is not granted to this project/agent");
  return row;
}
async function price(c: PoolClient, project: string, id: string) {
  const p = (
    await c.query(
      "SELECT * FROM project_provider_prices WHERE project_id=$1 AND connection_id=$2 AND valid_until>now() FOR SHARE",
      [project, id],
    )
  ).rows[0];
  if (!p)
    throw new HttpError(
      409,
      "A current confirmed per-request price ceiling is required",
    );
  return p;
}
export async function reserve(
  c: PoolClient,
  workspace: string,
  project: string,
  id: string,
  subject: string,
  expected?: any,
  quoted?: { price_micro_usd: string | number; revision: number },
) {
  const p = quoted ?? (await price(c, project, id)),
    cost = Number(p.price_micro_usd);
  const budget = (
    await c.query(
      "SELECT * FROM project_external_budgets WHERE project_id=$1 AND workspace_id=$2 FOR UPDATE",
      [project, workspace],
    )
  ).rows[0];
  if (
    expected &&
    (budget?.revision !== expected.budget_revision ||
      p.revision !== expected.price_revision)
  )
    throw new HttpError(409, "Approved budget or price changed; review again");
  if (!budget || !budgetFits(budget, cost))
    throw new HttpError(
      409,
      "Fixed project external budget or request limit reached; no provider call started",
    );
  await c.query(
    "UPDATE project_external_budgets SET cost_used=cost_used+$2,requests_used=requests_used+1 WHERE project_id=$1",
    [project, cost],
  );
  const receipt = randomUUID();
  await c.query(
    "INSERT INTO external_cost_receipts(id,workspace_id,project_id,connection_id,subject,price_micro_usd) VALUES($1,$2,$3,$4,$5,$6)",
    [receipt, workspace, project, id, subject, cost],
  );
  return { cost, receipt, budget, price: p };
}
export async function active(
  c: Pick<PoolClient, "query">,
  workspace: string,
  project: string,
) {
  const p = (
    await c.query(
      "SELECT p.status,w.execution_paused,u.suspended FROM workspace_projects p JOIN workspaces w ON w.id=p.workspace_id JOIN users u ON u.id=w.owner_id JOIN accounts ac ON ac.owner_id=w.owner_id WHERE (ac.access_expires_at IS NULL OR ac.access_expires_at>now()) AND p.id=$1 AND w.id=$2",
      [project, workspace],
    )
  ).rows[0];
  if (!p || p.status !== "active" || p.execution_paused || p.suspended)
    throw new HttpError(409, "Project/workspace execution is paused");
}

export async function studioSnapshot(
  actor: string,
  workspace: string,
  project: string,
) {
  const role = await workspaceRole(actor, workspace);
  await projectFor(pool, workspace, project);
  const [posts, jobs, connections, budgets, prices, receipts, agents] =
    await Promise.all([
      pool.query(
        "SELECT * FROM content_posts WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 100",
        [workspace, project],
      ),
      pool.query(
        "SELECT j.*,(SELECT count(*)::int FROM research_queries q WHERE q.job_id=j.id AND q.status='done') source_queries FROM research_jobs j WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100",
        [workspace, project],
      ),
      pool.query(
        "SELECT id,name,provider,service_id,revision,write_enabled FROM work_app_connections WHERE workspace_id=$1 AND enabled AND (project_ids IS NULL OR project_ids ? $2) AND provider IN('ayrshare','tavily','brave','exa')",
        [workspace, project],
      ),
      pool.query(
        "SELECT * FROM project_external_budgets WHERE workspace_id=$1 AND project_id=$2",
        [workspace, project],
      ),
      pool.query("SELECT * FROM project_provider_prices WHERE project_id=$1", [
        project,
      ]),
      pool.query(
        "SELECT id,subject,price_micro_usd,status,created_at FROM external_cost_receipts WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 50",
        [workspace, project],
      ),
      pool.query(
        "SELECT id,name FROM agents WHERE workspace_id=$1 AND kc_project_agent($2,id)",
        [workspace, project],
      ),
    ]);
  return {
    role,
    posts: posts.rows,
    jobs: jobs.rows,
    connections: connections.rows,
    budget: budgets.rows[0] ?? {
      cost_limit: 0,
      cost_used: 0,
      request_limit: 0,
      requests_used: 0,
      revision: 0,
    },
    prices: prices.rows,
    receipts: receipts.rows,
    agents: agents.rows,
  };
}
export async function studioAction(
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
        "budget",
        "price",
        "save_post",
        "review",
        "approve",
        "reject",
        "cancel",
        "create_research",
        "search",
        "report",
        "restore_report",
        "ai",
      ]),
    })
    .passthrough()
    .parse(input).action;
  if (action === "save_post")
    return transaction((c) =>
      savePost(c, workspace, project, (input as any).post),
    );
  if (action === "search") {
    const b = z
      .object({
        action: z.literal("search"),
        job_id: uid,
        query: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(input);
    return researchSearch(workspace, project, b.job_id, b.query);
  }
  if (action === "report") {
    const b = z
      .object({
        action: z.literal("report"),
        job_id: uid,
        expected_revision: z.number().int().positive(),
        report: z.string().max(60000),
      })
      .strict()
      .parse(input);
    return transaction((c) =>
      writeReport(
        c,
        workspace,
        project,
        b.job_id,
        b.expected_revision,
        b.report,
      ),
    );
  }
  if (action === "restore_report") {
    const b = z
      .object({
        action: z.literal("restore_report"),
        job_id: uid,
        expected_revision: z.number().int().positive(),
        revision: z.number().int().positive(),
      })
      .strict()
      .parse(input);
    return transaction(async (c) => {
      const version = await researchVersion(
        workspace,
        project,
        b.job_id,
        b.revision,
        c,
      );
      return writeReport(
        c,
        workspace,
        project,
        b.job_id,
        b.expected_revision,
        version.report,
      );
    });
  }
  if (action === "ai") return draftRun(actor, workspace, project, input);
  return transaction(async (c) => {
    if (action === "budget") {
      const b = z
        .object({
          action: z.literal("budget"),
          cost_limit: money,
          request_limit: z.number().int().min(0).max(10000),
        })
        .strict()
        .parse(input);
      const old = (
        await c.query(
          "SELECT * FROM project_external_budgets WHERE project_id=$1 FOR UPDATE",
          [project],
        )
      ).rows[0];
      if (
        old &&
        (b.cost_limit < Number(old.cost_used) ||
          b.request_limit < old.requests_used)
      )
        throw new HttpError(
          400,
          "New limits cannot be lower than committed reservations",
        );
      await c.query(
        "INSERT INTO project_external_budgets(project_id,workspace_id,cost_limit,request_limit) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET cost_limit=$3,request_limit=$4,revision=project_external_budgets.revision+1",
        [project, workspace, b.cost_limit, b.request_limit],
      );
    } else if (action === "price") {
      const b = z
        .object({
          action: z.literal("price"),
          connection_id: uid,
          price: money,
          valid_until: z.string().datetime({ offset: true }),
          confirm: z.literal(true),
        })
        .strict()
        .parse(input);
      await connection(c, workspace, project, b.connection_id);
      if (
        Date.parse(b.valid_until) <= Date.now() ||
        Date.parse(b.valid_until) > Date.now() + 31 * 86400000
      )
        throw new HttpError(400, "Confirm a ceiling valid for at most 31 days");
      await c.query(
        "INSERT INTO project_provider_prices(project_id,connection_id,price_micro_usd,valid_until) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,connection_id) DO UPDATE SET price_micro_usd=$3,valid_until=$4,revision=project_provider_prices.revision+1",
        [project, b.connection_id, b.price, b.valid_until],
      );
    } else if (action === "create_research")
      return createResearch(c, workspace, project, input);
    else {
      const b = z
        .object({
          action: z.enum(["review", "approve", "reject", "cancel"]),
          id: uid,
          expected_revision: z.number().int().positive(),
          confirm: z.boolean().default(false),
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
      const post = (
        await c.query(
          "SELECT * FROM content_posts WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
          [b.id, workspace, project],
        )
      ).rows[0];
      if (!post || post.revision !== b.expected_revision)
        throw new HttpError(409, "Post changed; reload its exact preview");
      if (["publishing", "submitted", "uncertain"].includes(post.status))
        throw new HttpError(
          409,
          "A dispatched post cannot be changed or automatically repeated",
        );
      if (action === "approve") {
        if (post.status !== "review" || !b.confirm)
          throw new HttpError(
            400,
            "Review and explicitly approve this exact post first",
          );
        const co = await connection(c, workspace, project, post.connection_id);
        if (co.provider !== "ayrshare" || !co.write_enabled)
          throw new HttpError(
            403,
            "Enable publishing on the assigned Ayrshare connection first",
          );
        const p = await price(c, project, co.id),
          budget = (
            await c.query(
              "SELECT * FROM project_external_budgets WHERE project_id=$1",
              [project],
            )
          ).rows[0];
        if (!budget || !budgetFits(budget, Number(p.price_micro_usd)))
          throw new HttpError(
            409,
            "Set a sufficient fixed external budget first",
          );
        if (
          b.expected_connection_revision !== co.revision ||
          b.expected_price_revision !== p.revision ||
          b.expected_budget_revision !== budget.revision ||
          b.expected_price !== String(p.price_micro_usd)
        )
          throw new HttpError(
            409,
            "Connection, price or budget changed since preview. Reload and review again",
          );
        if (
          new Date(p.valid_until).getTime() <
          Math.max(
            Date.now(),
            new Date(post.scheduled_at ?? Date.now()).getTime(),
          ) +
            60000
        )
          throw new HttpError(
            409,
            "The price ceiling must cover the scheduled publication",
          );
        const approval = {
          hash: hash(post.payload),
          connection_revision: co.revision,
          budget_revision: budget.revision,
          price_revision: p.revision,
          price: p.price_micro_usd,
        };
        await c.query(
          "UPDATE content_posts SET status='queued',approval=$2,approved_by=$3,approved_at=now(),last_error=NULL,updated_at=now() WHERE id=$1",
          [post.id, JSON.stringify(approval), actor],
        );
      } else
        await c.query(
          "UPDATE content_posts SET status=$2,approval=NULL,approved_at=NULL,approved_by=NULL,updated_at=now() WHERE id=$1",
          [
            post.id,
            action === "review"
              ? "review"
              : action === "reject"
                ? "rejected"
                : "canceled",
          ],
        );
    }
    await audit(c, actor, "studio." + action, project);
    return { saved: true };
  });
}
export async function savePost(
  c: PoolClient,
  workspace: string,
  project: string,
  input: unknown,
) {
  const b = postInput.parse(input),
    co = await connection(c, workspace, project, b.connection_id);
  if (co.provider !== "ayrshare")
    throw new HttpError(400, "An Ayrshare connection is required");
  const old = b.id
    ? (
        await c.query(
          "SELECT * FROM content_posts WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
          [b.id, workspace, project],
        )
      ).rows[0]
    : null;
  if (b.id && (!old || old.revision !== b.expected_revision))
    throw new HttpError(409, "Post changed; reload before editing");
  if (old && ["publishing", "submitted", "uncertain"].includes(old.status))
    throw new HttpError(
      409,
      "Clone a dispatched post instead of changing its audit record",
    );
  const payload = {
    post: b.text,
    platforms: b.platforms,
    mediaUrls: b.media_urls,
    shortenLinks: false,
  };
  const id = old?.id ?? randomUUID(),
    revision = (old?.revision ?? 0) + 1;
  await c.query(
    "INSERT INTO content_posts(id,workspace_id,project_id,connection_id,title,payload,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET connection_id=$4,title=$5,payload=$6,scheduled_at=$7,revision=$8,status='draft',approval=NULL,approved_by=NULL,approved_at=NULL,receipt=NULL,last_error=NULL,updated_at=now()",
    [
      id,
      workspace,
      project,
      co.id,
      b.title,
      JSON.stringify(payload),
      b.scheduled_at,
      revision,
    ],
  );
  await c.query(
    "INSERT INTO content_post_versions(post_id,revision,payload) VALUES($1,$2,$3)",
    [
      id,
      revision,
      JSON.stringify({
        ...payload,
        title: b.title,
        scheduled_at: b.scheduled_at,
      }),
    ],
  );
  return { id, revision };
}
async function createResearch(
  c: PoolClient,
  workspace: string,
  project: string,
  input: unknown,
) {
  const b = z
    .object({
      action: z.literal("create_research"),
      title: z.string().trim().min(1).max(180),
      connection_id: uid,
      cost_limit: money,
      request_limit: z.number().int().min(1).max(20),
    })
    .strict()
    .parse(input);
  const co = await connection(c, workspace, project, b.connection_id);
  if (!researchProviders.includes(co.provider as any))
    throw new HttpError(400, "Choose a research provider");
  const id = randomUUID();
  await c.query(
    "INSERT INTO research_jobs(id,workspace_id,project_id,title,connection_id,cost_limit,request_limit) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, workspace, project, b.title, co.id, b.cost_limit, b.request_limit],
  );
  return { id };
}
export async function researchJob(
  workspace: string,
  project: string,
  id: string,
  db: Pick<PoolClient, "query"> = pool,
) {
  const job = (
    await db.query(
      "SELECT * FROM research_jobs WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
      [id, workspace, project],
    )
  ).rows[0];
  if (!job) throw new HttpError(404, "Research job unavailable");
  const queries = (
    await db.query(
      "SELECT id,query,status,results,reserved_cost,started_at,finished_at FROM research_queries WHERE job_id=$1 ORDER BY started_at LIMIT 100",
      [id],
    )
  ).rows;
  const versions = (
    await db.query(
      "SELECT revision,created_at FROM research_report_versions WHERE job_id=$1 ORDER BY revision DESC LIMIT 20",
      [id],
    )
  ).rows;
  return { job, queries, versions, untrusted_source: true };
}
export async function researchVersion(
  workspace: string,
  project: string,
  id: string,
  revision: number,
  db: Pick<PoolClient, "query"> = pool,
) {
  const row = (
    await db.query(
      "SELECT v.* FROM research_report_versions v JOIN research_jobs j ON j.id=v.job_id WHERE j.id=$1 AND j.workspace_id=$2 AND j.project_id=$3 AND v.revision=$4",
      [id, workspace, project, revision],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Report version unavailable");
  return row;
}
async function writeReport(
  c: PoolClient,
  workspace: string,
  project: string,
  id: string,
  revision: number,
  report: string,
) {
  const old = (
    await c.query(
      "SELECT * FROM research_jobs WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
      [id, workspace, project],
    )
  ).rows[0];
  if (!old || old.revision !== revision)
    throw new HttpError(409, "Report changed; read its current revision first");
  await c.query(
    "INSERT INTO research_report_versions(job_id,revision,report) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [id, old.revision, old.report],
  );
  return (
    await c.query(
      "UPDATE research_jobs SET report=$2,revision=revision+1 WHERE id=$1 RETURNING id,revision",
      [id, report],
    )
  ).rows[0];
}
export async function researchSearch(
  workspace: string,
  project: string,
  jobId: string,
  query: string,
  agent?: string,
) {
  z.string().trim().min(3).max(500).parse(query);
  const claim = await transaction(async (c) => {
    // Project lock fixes lock ordering and prevents two cache misses spending twice.
    await c.query(
      "SELECT id FROM workspace_projects WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [project, workspace],
    );
    await active(c, workspace, project);
    const job = (
      await c.query(
        "SELECT * FROM research_jobs WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
        [jobId, workspace, project],
      )
    ).rows[0];
    if (!job) throw new HttpError(404, "Research job unavailable");
    const co = await connection(
      c,
      workspace,
      project,
      job.connection_id,
      agent,
    );
    if (!researchProviders.includes(co.provider))
      throw new HttpError(400, "Unsupported search provider");
    const cacheKey = hash([
      project,
      co.id,
      co.revision,
      query.trim().replace(/\s+/g, " "),
      "bounded-search-v1",
    ]);
    const prior = (
      await c.query(
        "SELECT * FROM research_queries WHERE job_id=$1 AND cache_key=$2",
        [jobId, cacheKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.status !== "done")
        throw new HttpError(
          409,
          "This query already started. Inspect its receipt; it will not be repeated automatically",
        );
      return { cached: prior };
    }
    const cache = (
      await c.query(
        "SELECT q.* FROM research_queries q JOIN research_jobs j ON j.id=q.job_id WHERE j.workspace_id=$1 AND j.project_id=$2 AND q.cache_key=$3 AND q.status='done' AND q.finished_at>now()-interval '24 hours' ORDER BY q.finished_at DESC LIMIT 1",
        [workspace, project, cacheKey],
      )
    ).rows[0];
    if (cache) {
      const copied = randomUUID();
      await c.query(
        "INSERT INTO research_queries(id,job_id,cache_key,query,status,results,connection_revision,reserved_cost,finished_at) VALUES($1,$2,$3,$4,'done',$5,$6,0,$7)",
        [
          copied,
          jobId,
          cacheKey,
          query,
          JSON.stringify(cache.results),
          co.revision,
          cache.finished_at,
        ],
      );
      return { cached: { ...cache, id: copied } };
    }
    const p = await price(c, project, co.id);
    if (!budgetFits(job, Number(p.price_micro_usd)))
      throw new HttpError(
        409,
        "Fixed research job budget or request limit reached; no call started",
      );
    const reservation = await reserve(
        c,
        workspace,
        project,
        co.id,
        "Research: " + job.title,
      ),
      id = randomUUID();
    await c.query(
      "UPDATE research_jobs SET cost_used=cost_used+$2,requests_used=requests_used+1 WHERE id=$1",
      [jobId, reservation.cost],
    );
    await c.query(
      "INSERT INTO research_queries(id,job_id,cache_key,query,status,connection_revision,reserved_cost) VALUES($1,$2,$3,$4,'running',$5,$6)",
      [id, jobId, cacheKey, query, co.revision, reservation.cost],
    );
    return { id, co, reservation };
  });
  if (claim.cached)
    return {
      cached: true,
      query_id: claim.cached.id,
      results: claim.cached.results,
      retrieved_at: claim.cached.finished_at,
      untrusted_source: true,
    };
  try {
    const { row, token } = await appAccess(claim.co.id, workspace);
    if (row.revision !== claim.co.revision)
      throw new Error("Connection changed");
    await active(pool, workspace, project);
    const plan = searchPlan(row.provider, query),
      raw = await appFetch(
        token,
        plan.url,
        plan.method,
        plan.body,
        undefined,
        row.provider,
      ),
      results = sourceResults(row.provider, raw);
    await transaction(async (c) => {
      await c.query(
        "UPDATE research_queries SET status='done',results=$2,finished_at=now() WHERE id=$1 AND status='running'",
        [claim.id, JSON.stringify(results)],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='confirmed' WHERE id=$1",
        [claim.reservation!.receipt],
      );
    });
    return {
      cached: false,
      query_id: claim.id,
      results,
      retrieved_at: new Date().toISOString(),
      untrusted_source: true,
    };
  } catch {
    await transaction(async (c) => {
      await c.query(
        "UPDATE research_queries SET status='uncertain',finished_at=now() WHERE id=$1 AND status='running'",
        [claim.id],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='uncertain' WHERE id=$1",
        [claim.reservation!.receipt],
      );
    });
    throw new HttpError(
      409,
      "Search outcome/usage uncertain. The maximum cost remains committed; this query is not automatically retried",
    );
  }
}
export async function expireContentClaims() {
  await pool.query(
    "UPDATE content_posts SET status='uncertain',last_error='Publisher interrupted; inspect provider before repeating' WHERE status='publishing' AND dispatched_at<now()-interval '5 minutes'",
  );
  await pool.query(
    "UPDATE research_queries SET status='uncertain',finished_at=now() WHERE status='running' AND started_at<now()-interval '5 minutes'",
  );
}
export async function dispatchContent() {
  const claim = await transaction(async (c) => {
    const post = (
      await c.query(
        "SELECT p.* FROM content_posts p JOIN workspaces w ON w.id=p.workspace_id JOIN workspace_projects pr ON pr.id=p.project_id JOIN users u ON u.id=w.owner_id JOIN accounts ac ON ac.owner_id=w.owner_id WHERE (ac.access_expires_at IS NULL OR ac.access_expires_at>now()) AND p.status='queued' AND coalesce(p.scheduled_at,now())<=now() AND NOT w.execution_paused AND pr.status='active' AND NOT u.suspended ORDER BY p.scheduled_at NULLS FIRST,p.created_at FOR UPDATE OF p SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!post) return null;
    try {
      const co = await connection(
          c,
          post.workspace_id,
          post.project_id,
          post.connection_id,
        ),
        p = await price(c, post.project_id, co.id),
        budget = (
          await c.query(
            "SELECT * FROM project_external_budgets WHERE project_id=$1",
            [post.project_id],
          )
        ).rows[0];
      if (
        !post.approval ||
        hash(post.payload) !== post.approval.hash ||
        co.revision !== post.approval.connection_revision ||
        !co.write_enabled ||
        co.provider !== "ayrshare" ||
        budget?.revision !== post.approval.budget_revision ||
        p.revision !== post.approval.price_revision
      )
        throw new HttpError(409, "Approval is stale; review again");
      const reservation = await reserve(
          c,
          post.workspace_id,
          post.project_id,
          co.id,
          "Publish: " + post.title,
          post.approval,
        ),
        token = randomUUID();
      await c.query(
        "UPDATE content_posts SET status='publishing',dispatch_token=$2,dispatched_at=now(),updated_at=now() WHERE id=$1",
        [post.id, token],
      );
      return { post, co, reservation, token };
    } catch (error) {
      if (error instanceof HttpError) {
        await c.query(
          "UPDATE content_posts SET status='blocked',last_error=$2,updated_at=now() WHERE id=$1",
          [
            post.id,
            error instanceof HttpError
              ? error.message
              : "Approval changed; review the exact post again",
          ],
        );
        return null;
      }
      throw error;
    }
  });
  if (!claim) return;
  try {
    const { token, row } = await appAccess(
      claim.co.id,
      claim.post.workspace_id,
    );
    if (row.revision !== claim.co.revision)
      throw new Error("Connection changed");
    const result = await appFetch(
      token,
      "https://api.ayrshare.com/api/post",
      "POST",
      claim.post.payload,
      undefined,
      "ayrshare",
    );
    const receipt = {
      provider: "ayrshare",
      id: typeof result.id === "string" ? result.id.slice(0, 200) : null,
      status: String(result.status ?? "accepted").slice(0, 50),
      postIds: Array.isArray(result.postIds)
        ? result.postIds.slice(0, 5).map((p: any) => ({
            platform: String(p.platform ?? "").slice(0, 50),
            id: String(p.id ?? "").slice(0, 200),
          }))
        : [],
    };
    await transaction(async (c) => {
      await c.query(
        "UPDATE content_posts SET status='submitted',receipt=$3,updated_at=now() WHERE id=$1 AND dispatch_token=$2 AND status='publishing'",
        [claim.post.id, claim.token, JSON.stringify(receipt)],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='confirmed' WHERE id=$1",
        [claim.reservation!.receipt],
      );
    });
  } catch {
    await transaction(async (c) => {
      await c.query(
        "UPDATE content_posts SET status='uncertain',last_error='Provider outcome uncertain. Inspect Ayrshare; this post will not be automatically repeated',updated_at=now() WHERE id=$1 AND dispatch_token=$2",
        [claim.post.id, claim.token],
      );
      await c.query(
        "UPDATE external_cost_receipts SET status='uncertain' WHERE id=$1",
        [claim.reservation!.receipt],
      );
    });
  }
}
async function draftRun(
  actor: string,
  workspace: string,
  project: string,
  input: unknown,
) {
  const b = z
    .object({
      action: z.literal("ai"),
      kind: z.enum(["post", "report", "research"]),
      brief: z.string().trim().min(1).max(3000),
      agent_id: uid,
      job_id: uid.optional(),
      connection_id: uid.optional(),
      token_limit: z.number().int().min(1000).max(20000),
      credit_limit: z.number().int().min(0).max(100000),
    })
    .strict()
    .parse(input);
  await assertProjectAgent(pool, project, b.agent_id);
  if (b.kind !== "post") {
    if (!b.job_id) throw new HttpError(400, "Research job required");
    await researchJob(workspace, project, b.job_id);
  }
  if (b.kind === "post") {
    if (!b.connection_id)
      throw new HttpError(400, "Publishing connection required");
    await connection(pool, workspace, project, b.connection_id, b.agent_id);
  }
  if (b.kind === "research")
    await transaction(async (c) => {
      const { job } = await researchJob(workspace, project, b.job_id!, c);
      const co = await connection(
          c,
          workspace,
          project,
          job.connection_id,
          b.agent_id,
        ),
        p = await price(c, project, co.id);
      const budget = (
        await c.query(
          "SELECT * FROM project_external_budgets WHERE project_id=$1",
          [project],
        )
      ).rows[0];
      if (
        !budget ||
        !budgetFits(budget, Number(p.price_micro_usd)) ||
        !budgetFits(job, Number(p.price_micro_usd))
      )
        throw new HttpError(
          409,
          "Set sufficient fixed project/notebook budgets before starting AI research, or summarize existing sources only",
        );
    });
  const w = (
    await pool.query("SELECT * FROM workspace_context WHERE id=$1", [workspace])
  ).rows[0];
  const goal =
    b.kind === "research"
      ? `Research job ${b.job_id}. First read_research_job and reuse its existing sources. Use research_query only within that job and its fixed limits. Save a sourced report with save_research_report; distinguish uncertainty. Brief: ${b.brief}`
      : b.kind === "post"
        ? `Prepare a reviewable social content draft for this project using save_content_draft with request_review=true, then finish the task without waiting for publication. Connection ID: ${b.connection_id}. Do not publish or claim publication. Brief: ${b.brief}`
        : `Read research job ${b.job_id} using read_research_job. Write a sourced Markdown report using save_research_report, distinguishing facts, source dates and uncertainty. Do not invent sources or call providers. Brief: ${b.brief}`;
  const run = await createRun(
    w,
    goal,
    b.agent_id,
    [],
    false,
    [b.agent_id],
    "",
    {
      projectId: project,
      tokenLimit: b.token_limit,
      creditLimit: b.credit_limit,
      userBudget: true,
      workMode: b.kind === "research" ? "execute" : "draft",
    },
  );
  return { run_id: run.id };
}
export async function studioAgentStep(
  taskId: string,
  lease: string,
  callId: string,
  name: string,
  args: unknown,
) {
  if (name === "research_query") {
    const b = z
      .object({ job_id: uid, query: z.string().trim().min(3).max(500) })
      .strict()
      .parse(args);
    const scoped = await transaction((c) => lockTask(c, taskId, lease));
    const result = await researchSearch(
      scoped.task.workspace_id,
      scoped.run.project_id!,
      b.job_id,
      b.query,
      scoped.task.agent_id,
    );
    return {
      result: JSON.stringify({
        ...result,
        results: result.results.map((s: any) => ({
          ...s,
          excerpt: s.excerpt.slice(0, 1200),
        })),
      }),
      yield: false,
    };
  }
  return transaction(async (c) => {
    const { task, run } = await lockTask(c, taskId, lease),
      op = taskId + ":" + callId;
    const prior = (await c.query("SELECT * FROM operations WHERE id=$1", [op]))
      .rows[0];
    if (prior?.status === "done") return prior.result;
    if (prior) throw new HttpError(409, "Operation already started");
    let result: unknown;
    if (name === "save_content_draft") {
      const { request_review, ...post } = z
        .object({ request_review: z.boolean().default(false) })
        .passthrough()
        .parse(args);
      const b = postInput.parse(post);
      await connection(
        c,
        task.workspace_id,
        run.project_id!,
        b.connection_id,
        task.agent_id,
      );
      const saved = await savePost(c, task.workspace_id, run.project_id!, b);
      if (request_review)
        await c.query("UPDATE content_posts SET status='review' WHERE id=$1", [
          saved.id,
        ]);
      result = { ...saved, status: request_review ? "review" : "draft" };
    } else if (name === "read_research_job") {
      const b = z
        .object({ job_id: uid, query_id: uid.optional() })
        .strict()
        .parse(args);
      result = compactResearch(
        await researchJob(task.workspace_id, run.project_id!, b.job_id, c),
        b.query_id,
      );
    } else {
      const b = z
        .object({
          job_id: uid,
          expected_revision: z.number().int().positive(),
          report: z.string().max(60000),
        })
        .strict()
        .parse(args);
      result = await writeReport(
        c,
        task.workspace_id,
        run.project_id!,
        b.job_id,
        b.expected_revision,
        b.report,
      );
    }
    const output = { result: JSON.stringify(result), yield: false };
    await c.query(
      "INSERT INTO operations(id,task_id,tool_name,status,result) VALUES($1,$2,$3,'done',$4)",
      [op, taskId, name, JSON.stringify(output)],
    );
    return output;
  });
}
