import { authorizeCheckpointJob } from "../server/checkpoints.ts";
import type { WebSocket } from "ws";
import { pool, transaction } from "../server/db.ts";
import { environmentPermission } from "../server/environment-tools.ts";
type Relay = { ws: WebSocket; generation: number };
export function createAgentDispatcher() {
  const running = new Map<string, { ws: WebSocket; environmentId: string }>();
  let ticking = false;
  async function agentToolReply(ws: WebSocket, m: any) {
    const active = running.get(m.id);
    if (!active || active.ws !== ws || m.kind !== "agent-result") return;
    running.delete(m.id);
    const row = (
      await pool.query(
        "SELECT * FROM environment_tool_calls WHERE id=$1 AND status='running'",
        [m.id],
      )
    ).rows[0];
    if (!row) return;
    try {
      await (row.requested_by
        ? authorizeCheckpointJob(pool, row)
        : environmentPermission(
            pool,
            row.task_id,
            row.task_lease,
            row.environment_id,
            row.permission,
            row.generation,
          ));
      if (
        !m.result ||
        typeof m.result !== "object" ||
        m.result.uncertain ||
        Buffer.byteLength(JSON.stringify(m.result)) > 100000
      )
        throw new Error();
      await pool.query(
        "UPDATE environment_tool_calls SET status='done',result=$2,finished_at=now() WHERE id=$1 AND status='running'",
        [m.id, JSON.stringify(m.result)],
      );
    } catch {
      await pool.query(
        "UPDATE environment_tool_calls SET status='uncertain',finished_at=now() WHERE id=$1 AND status='running'",
        [m.id],
      );
    }
  }
  async function agentToolTick(
    relays: Map<string, Relay>,
    send: (ws: WebSocket, value: unknown) => void,
  ) {
    if (ticking) return;
    ticking = true;
    try {
      for (const [id, active] of running) {
        const row = (
          await pool.query("SELECT * FROM environment_tool_calls WHERE id=$1", [
            id,
          ])
        ).rows[0];
        try {
          if (
            !row ||
            row.status !== "running" ||
            Date.now() - Date.parse(row.started_at) > 40000 ||
            active.ws.readyState !== 1 ||
            relays.get(active.environmentId)?.ws !== active.ws
          )
            throw new Error();
          await (row.requested_by
            ? authorizeCheckpointJob(pool, row)
            : environmentPermission(
                pool,
                row.task_id,
                row.task_lease,
                row.environment_id,
                row.permission,
                row.generation,
              ));
        } catch {
          try {
            send(active.ws, { kind: "cancel", id });
          } catch {}
          running.delete(id);
          await pool.query(
            "UPDATE environment_tool_calls SET status='uncertain',finished_at=now() WHERE id=$1 AND status='running'",
            [id],
          );
        }
      }
      // A gateway restart never repeats an operation whose external result is unknown.
      await pool.query(
        "UPDATE environment_tool_calls SET status='uncertain',finished_at=now() WHERE status='running' AND started_at<now()-interval '45 seconds'",
      );
      const candidates = (
        await pool.query(
          "SELECT * FROM environment_tool_calls WHERE status='queued' AND environment_id=ANY($1::text[]) ORDER BY created_at LIMIT 40",
          [[...relays.keys()]],
        )
      ).rows;
      for (const job of candidates) {
        const relay = relays.get(job.environment_id);
        if (
          !relay ||
          relay.generation !== job.generation ||
          relay.ws.readyState !== 1
        )
          continue;
        await transaction(async (c) => {
          // Per-job row locks allow independent gateways to dispatch concurrently.
          const row = (
            await c.query(
              "SELECT * FROM environment_tool_calls WHERE id=$1 AND status='queued' FOR UPDATE SKIP LOCKED",
              [job.id],
            )
          ).rows[0];
          if (!row) return;
          try {
            await (row.requested_by
              ? authorizeCheckpointJob(c, row)
              : environmentPermission(
                  c,
                  row.task_id,
                  row.task_lease,
                  row.environment_id,
                  row.permission,
                  row.generation,
                ));
          } catch {
            await c.query(
              "UPDATE environment_tool_calls SET status='canceled',finished_at=now() WHERE id=$1",
              [job.id],
            );
            return;
          }
          if (
            (
              await c.query(
                "SELECT 1 FROM environment_tool_calls WHERE environment_id=$1 AND status='running'",
                [row.environment_id],
              )
            ).rowCount
          )
            return;
          await c.query(
            "UPDATE environment_tool_calls SET status='running',started_at=now() WHERE id=$1",
            [job.id],
          );
          running.set(job.id, {
            ws: relay.ws,
            environmentId: row.environment_id,
          });
        });
        if (running.has(job.id)) {
          try {
            send(relay.ws, {
              kind: "agent-start",
              id: job.id,
              tool: job.tool,
              args: job.args,
            });
          } catch {
            running.delete(job.id);
            await pool.query(
              "UPDATE environment_tool_calls SET status='uncertain',finished_at=now() WHERE id=$1",
              [job.id],
            );
          }
        }
      }
    } catch {
      for (const [id, active] of running) {
        try {
          send(active.ws, { kind: "cancel", id });
        } catch {}
      }
    } finally {
      ticking = false;
    }
  }
  function stopAgentTools(send: (ws: WebSocket, value: unknown) => void) {
    for (const [id, active] of running) {
      try {
        send(active.ws, { kind: "cancel", id });
      } catch {}
    }
    running.clear();
  }

  return { agentToolReply, agentToolTick, stopAgentTools };
}
