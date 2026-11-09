import { pool } from "./db.ts";
import { changeHubStats } from "./change-hub.ts";
export async function scalingStatus() {
  const [gateways, queue, scheduler, objects] = await Promise.all([
    pool.query(
      "SELECT id,address,expires_at>now() AS healthy FROM gateway_instances ORDER BY id",
    ),
    pool.query(
      "SELECT status,count(*)::int AS count FROM tasks WHERE status IN('queued','running','input_required') GROUP BY status",
    ),
    pool.query(
      "SELECT name,next_at,lease_until>now() AS running FROM scheduler_leases ORDER BY name",
    ),
    pool.query(
      "SELECT count(*)::int AS files,coalesce(sum(binary_bytes),0)::bigint AS bytes,count(*) FILTER(WHERE binary_data IS NOT NULL)::int AS legacy FROM artifacts WHERE binary_object IS NOT NULL OR binary_data IS NOT NULL",
    ),
  ]);
  return {
    instance: {
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
        max: pool.options.max,
      },
      events: changeHubStats(),
    },
    gateways: gateways.rows,
    queue: queue.rows,
    scheduler: scheduler.rows,
    objects: objects.rows[0],
  };
}
