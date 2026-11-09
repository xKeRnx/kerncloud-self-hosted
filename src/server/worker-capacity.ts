import { pool, transaction } from "./db.ts";
export async function workerCapacity(owned: string[]) {
  const demand = (
    await pool.query(
      `WITH q AS (SELECT ac.id,p.max_parallel_tasks,count(*) FILTER(WHERE t.status='running' AND t.lease_until>now()) running,count(*) FILTER(WHERE (t.status='queued' AND (t.not_before IS NULL OR t.not_before<=now())) OR (t.status='running' AND t.lease_until<now())) queued FROM tasks t JOIN runs r ON r.id=t.run_id JOIN agents ag ON ag.id=t.agent_id JOIN workspaces w ON w.id=t.workspace_id JOIN accounts ac ON ac.owner_id=w.owner_id JOIN users u ON u.id=w.owner_id JOIN plans p ON p.id=ac.plan_id WHERE r.status='running' AND EXISTS(SELECT 1 FROM workspace_projects p WHERE p.id=r.project_id AND p.status='active') AND kc_project_agent(r.project_id,ag.id) AND (r.plan_item_id IS NULL OR kc_plan_ready(r.plan_item_id)) AND (t.plan_item_id IS NULL OR kc_plan_ready(t.plan_item_id) OR (t.status='running' AND t.lease_until>now())) AND NOT w.execution_paused AND NOT ag.execution_paused AND NOT u.suspended AND (ac.access_expires_at IS NULL OR ac.access_expires_at>now()) GROUP BY ac.id,p.max_parallel_tasks) SELECT coalesce(sum(running+least(queued,greatest(max_parallel_tasks-running,0))),0)::int slots FROM q`,
    )
  ).rows[0].slots;
  const others = (
    await pool.query(
      "SELECT coalesce(sum(concurrency),0)::int slots FROM workers WHERE last_seen>now()-interval '30 seconds' AND NOT draining AND NOT(id=ANY($1::text[]))",
      [owned],
    )
  ).rows[0].slots;
  return { demand_slots: demand, other_slots: others };
}
export async function drainWorker(id: string, draining: boolean) {
  return transaction(async (c) => {
    const worker = (
      await c.query("SELECT id FROM workers WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!worker) return true;
    if (
      draining &&
      (
        await c.query(
          "SELECT 1 FROM tasks WHERE worker_id=$1 AND status='running' AND lease_until>now() LIMIT 1",
          [id],
        )
      ).rowCount
    )
      return false;
    await c.query("UPDATE workers SET draining=$2 WHERE id=$1", [id, draining]);
    return true;
  });
}
export async function autoscalerLease(group: string, token: string) {
  return Boolean(
    (
      await pool.query(
        `INSERT INTO scheduler_leases(name,token,lease_until,next_at) VALUES($1,$2,now()+interval '5 minutes',now()) ON CONFLICT(name) DO UPDATE SET token=EXCLUDED.token,lease_until=EXCLUDED.lease_until WHERE scheduler_leases.token=$2 OR scheduler_leases.lease_until<now() RETURNING name`,
        ["autoscale:" + group, token],
      )
    ).rowCount,
  );
}
