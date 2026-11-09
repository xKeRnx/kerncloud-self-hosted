import { pool } from "./db.ts";
export async function runtimeInsights(workspaceId: string) {
  const strategies = (
    await pool.query(
      "SELECT context_strategy strategy,count(*)::int calls,count(*) FILTER(WHERE usage_known)::int measured_calls,coalesce(sum(tokens) FILTER(WHERE usage_known),0)::float8 tokens,coalesce(sum(cached_tokens),0)::float8 cached_tokens,coalesce(sum(cache_input_tokens),0)::float8 cache_input_tokens,count(cached_tokens)::int cache_reports,count(provider_cost_usd)::int cost_reports,sum(provider_cost_usd)::float8 provider_cost_usd,avg(duration_ms)::float8 duration_ms FROM model_calls WHERE workspace_id=$1 AND created_at>now()-interval '30 days' GROUP BY context_strategy ORDER BY context_strategy",
      [workspaceId],
    )
  ).rows;
  const providers = (
    await pool.query(
      "SELECT m.id,m.name,h.reason,h.cooldown_until FROM provider_health h JOIN model_offerings m ON m.id=h.model_id WHERE h.cooldown_until>now() AND (m.workspace_id=$1 OR m.workspace_id IS NULL) ORDER BY h.cooldown_until",
      [workspaceId],
    )
  ).rows;
  return {
    strategies,
    providers,
    period_days: 30,
    provider_cost_currency: "USD",
    cost_source: "provider-reported; missing costs stay unknown",
    generated_at: new Date().toISOString(),
  };
}
