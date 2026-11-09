import { allowanceSchedule } from "../core/allowance-period.ts";
import { ensureAccountAllowance } from "./monthly-allowances.ts";
import { z } from "zod";
import { pool, transaction } from "./db.ts";
import { HttpError } from "./auth.ts";
import type { Workspace } from "../core/types.ts";

export function usageFilters(params: URLSearchParams, now = new Date()) {
  const range = z
    .enum(["24h", "7d", "30d", "365d", "custom"])
    .parse(params.get("range") ?? "30d");
  const end =
    range === "custom"
      ? new Date(z.string().datetime().parse(params.get("to")))
      : now;
  const start =
    range === "custom"
      ? new Date(z.string().datetime().parse(params.get("from")))
      : new Date(
          end.getTime() -
            { "24h": 1, "7d": 7, "30d": 30, "365d": 365 }[range] * 86400000,
        );
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    end.getTime() - start.getTime() > 366 * 86400000
  )
    throw new HttpError(
      400,
      "Zeitraum muss zwischen einer Minute und 366 Tagen liegen.",
    );
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    range,
    bucket: end.getTime() - start.getTime() <= 2 * 86400000 ? "hour" : "day",
    workspace: z
      .string()
      .max(100)
      .parse(params.get("workspace") ?? "all"),
    source: z
      .enum(["all", "managed", "byok"])
      .parse(params.get("source") ?? "all"),
    model: z
      .string()
      .max(100)
      .parse(params.get("model") ?? "all"),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .parse(params.get("page") ?? 1),
  };
}

export async function customerUsage(
  workspace: Workspace,
  params: URLSearchParams,
) {
  const f = usageFilters(params);
  await ensureAccountAllowance(workspace.account_id);
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const workspaces = (
      await c.query(
        "SELECT id,name FROM workspaces WHERE owner_id=$1 ORDER BY created_at",
        [workspace.owner_id],
      )
    ).rows;
    if (f.workspace !== "all" && !workspaces.some((w) => w.id === f.workspace))
      throw new HttpError(403, "Workspace nicht zugänglich.");
    const values = [
      workspace.account_id,
      f.from,
      f.to,
      f.workspace,
      f.source,
      f.model,
    ];
    // Both ownership and account scope are checked. No prompt, result, secret or endpoint is selected.
    const base = `FROM model_calls m JOIN workspaces w ON w.id=m.workspace_id LEFT JOIN tasks t ON t.id=m.task_id LEFT JOIN agents a ON a.id=t.agent_id LEFT JOIN model_offerings o ON o.id=m.model_id WHERE w.owner_id=(SELECT owner_id FROM accounts WHERE id=$1) AND (m.account_id=$1 OR m.account_id IS NULL) AND m.created_at >= $2::timestamptz AND m.created_at < $3::timestamptz AND ($4='all' OR w.id=$4) AND ($5='all' OR m.managed=($5='managed')) AND ($6='all' OR m.model_id=$6)`;
    const metrics = `count(*)::int requests,coalesce(sum(m.tokens) FILTER(WHERE m.usage_known),0)::float8 tokens,coalesce(sum(m.charged_credits) FILTER(WHERE m.status<>'reserved'),0)::float8 credits,coalesce(sum(m.reserved) FILTER(WHERE m.status='reserved' AND m.managed),0)::float8 reserved,count(*) FILTER(WHERE NOT m.usage_known)::int unknown_usage,count(*) FILTER(WHERE m.status='uncertain')::int uncertain,count(*) FILTER(WHERE m.outcome='error')::int errors,count(*) FILTER(WHERE m.managed)::int managed_requests,count(*) FILTER(WHERE NOT m.managed)::int byok_requests,avg(m.duration_ms)::float8 duration_ms,count(m.duration_ms)::int timed,coalesce(sum(m.cached_tokens),0)::float8 cached_tokens,coalesce(sum(m.cache_input_tokens),0)::float8 cache_input_tokens,count(m.cached_tokens)::int cache_reports`;
    const totals = (await c.query(`SELECT ${metrics} ${base}`, values)).rows[0];
    const series = (
      await c.query(
        `SELECT date_trunc('${f.bucket}',m.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' at,${metrics} ${base} GROUP BY 1 ORDER BY 1`,
        values,
      )
    ).rows;
    const models = (
      await c.query(
        `SELECT m.model_id id,coalesce(m.model_name,o.model,'Unknown model') name,coalesce(m.provider_name,o.provider_name,'Unknown provider') provider,m.managed,${metrics} ${base} GROUP BY 1,2,3,4 ORDER BY tokens DESC,requests DESC LIMIT 50`,
        values,
      )
    ).rows;
    const agents = (
      await c.query(
        `SELECT a.id,coalesce(a.name,'Deleted agent') name,${metrics} ${base} GROUP BY 1,2 ORDER BY requests DESC LIMIT 10`,
        values,
      )
    ).rows;
    const calls = (
      await c.query(
        `SELECT m.id,m.run_id,m.created_at,m.managed,m.status,m.outcome,m.usage_known,m.tokens,m.input_tokens,m.output_tokens,m.charged_credits,m.reserved,m.duration_ms,m.cached_tokens,coalesce(m.model_name,o.model,'Unknown model') model,coalesce(m.provider_name,o.provider_name,'Unknown provider') provider,w.name workspace,coalesce(a.name,'Deleted agent') agent ${base} ORDER BY m.created_at DESC,m.id DESC LIMIT 25 OFFSET $7`,
        [...values, (f.page - 1) * 25],
      )
    ).rows;
    const options = (
      await c.query(
        "SELECT DISTINCT m.model_id id,coalesce(m.model_name,o.model,'Unknown model') name FROM model_calls m JOIN workspaces w ON w.id=m.workspace_id LEFT JOIN model_offerings o ON o.id=m.model_id WHERE w.owner_id=$1 AND (m.account_id=$2 OR m.account_id IS NULL) ORDER BY name",
        [workspace.owner_id, workspace.account_id],
      )
    ).rows;
    const account = (
      await c.query(
        "SELECT a.credits,a.subscription_status,a.access_expires_at,p.name plan_name,p.credits plan_credits,p.runtime_minutes,p.monthly_steps,coalesce(s.used,0) steps_used,a.runtime_included,a.runtime_purchased,a.runtime_period_end,a.subscription_period_end,(a.stripe_subscription_id IS NOT NULL OR a.access_source='stripe') stripe_managed,p.active plan_active FROM accounts a JOIN plans p ON p.id=a.plan_id LEFT JOIN account_step_usage s ON s.account_id=a.id AND s.period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM') WHERE a.id=$1",
        [workspace.account_id],
      )
    ).rows[0];
    const ledger = (
      await c.query(
        "SELECT l.id,l.amount,l.reason,l.created_at,w.name workspace FROM ledger l JOIN workspaces w ON w.id=l.workspace_id WHERE w.owner_id=$1 AND l.created_at >= $2 AND l.created_at < $3 AND ($4='all' OR w.id=$4) ORDER BY l.created_at DESC,l.id DESC LIMIT 100",
        [workspace.owner_id, f.from, f.to, f.workspace],
      )
    ).rows;
    const allocation =
      (
        await c.query(
          "SELECT period,credits,runtime_seconds,created_at FROM plan_allocations WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1",
          [workspace.account_id],
        )
      ).rows[0] ?? null;
    return {
      renewal: allowanceSchedule(account),
      filters: f,
      account,
      allocation,
      workspaces,
      options,
      totals,
      series,
      models,
      agents,
      calls,
      ledger,
      page: f.page,
      pages: Math.max(1, Math.ceil(totals.requests / 25)),
      generated_at: new Date().toISOString(),
    };
  });
}
