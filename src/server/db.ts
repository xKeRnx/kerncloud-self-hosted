import {
  ensureSelfHostedPlan,
  assignNewSelfHostedAccount,
} from "./self-hosted.ts";
import pg, { type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./security.ts";
const globalDb = globalThis as unknown as {
  kernPool?: pg.Pool;
  kernReady?: Promise<void>;
};
export const pool =
  globalDb.kernPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL,
    max: Math.max(2, Math.min(64, Number(process.env.DB_POOL_MAX ?? 12) || 12)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    application_name: process.env.SERVICE_NAME ?? "kerncloud-app",
  });
globalDb.kernPool = pool;
export async function transaction<T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
export async function seedWorkspace(
  c: PoolClient,
  userId: string,
  name: string,
  exactName = false,
) {
  const id = randomUUID();
  const newAccount = await c.query(
    "INSERT INTO accounts(id,owner_id,plan_id) VALUES($1,$2,'free') ON CONFLICT(owner_id) DO NOTHING RETURNING id",
    [randomUUID(), userId],
  );
  if (newAccount.rowCount) await assignNewSelfHostedAccount(c, userId);
  await c.query("INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)", [
    id,
    userId,
    exactName ? name : `${name}'s workspace`,
  ]);
  const limit = (
    await c.query(
      "SELECT p.max_agents FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.owner_id=$1",
      [userId],
    )
  ).rows[0].max_agents;
  for (const agent of [
    [
      "Atlas",
      "Coordination",
      "Coordinate the goal. Delegate suitable tasks to your team, wait for results, review them and summarize the outcome.",
      "cyan",
    ],
    [
      "Nova",
      "Execution",
      "Complete assigned tasks carefully using available tools and skills. Identify missing information and deliver verifiable results.",
      "violet",
    ],
    [
      "Echo",
      "Quality review",
      "Review results for completeness and errors. Request corrections where necessary. Report only checks that were actually performed and provide evidence.",
      "amber",
    ],
  ].slice(0, limit))
    await c.query(
      "INSERT INTO agents(id,workspace_id,name,role,instructions,color) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, ...agent],
    );
  const chief = (
    await c.query(
      "SELECT id FROM agents WHERE workspace_id=$1 ORDER BY CASE WHEN role IN('Koordination','Coordination') THEN 0 ELSE 1 END,id LIMIT 1",
      [id],
    )
  ).rows[0];
  if (chief) {
    await c.query("UPDATE agents SET can_manage=true WHERE id=$1", [chief.id]);
    await c.query(
      "UPDATE agents SET manager_id=$2 WHERE workspace_id=$1 AND id<>$2",
      [id, chief.id],
    );
  }
  return id;
}
export async function ensureDb() {
  if (!globalDb.kernReady)
    globalDb.kernReady = transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(6820192026)");
      await c.query(
        readFileSync(join(process.cwd(), "src/server/schema.sql"), "utf8"),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/002.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/003.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/004.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/005.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/006.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/007.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/008.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/009.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/010.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/011.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/012.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/013.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/014.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/015.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/016.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/017.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/018.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/019.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/020.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/021.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/022.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/023.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/024.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/025.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/026.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/027.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/028.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/029.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/030.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/031.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/032.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/033.sql"),
          "utf8",
        ),
      );
      await ensureSelfHostedPlan(c);
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/034.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/035.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/036.sql"),
          "utf8",
        ),
      );
      await c.query(
        readFileSync(
          join(process.cwd(), "src/server/migrations/037.sql"),
          "utf8",
        ),
      );
      if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        const existing = await c.query("SELECT id FROM users WHERE email=$1", [
          process.env.ADMIN_EMAIL.toLowerCase(),
        ]);
        if (!existing.rowCount) {
          const id = randomUUID();
          await c.query(
            "INSERT INTO users(id,email,name,password_hash,role,privacy_version) VALUES($1,$2,'Administrator',$3,'admin','local-bootstrap')",
            [
              id,
              process.env.ADMIN_EMAIL.toLowerCase(),
              hashPassword(process.env.ADMIN_PASSWORD),
            ],
          );
          await seedWorkspace(c, id, "Admin");
        }
      }
    }).catch((error) => {
      globalDb.kernReady = undefined;
      throw error;
    });
  await globalDb.kernReady;
}
export async function audit(
  c: PoolClient,
  actor: string | null,
  action: string,
  subject: string,
) {
  await c.query("INSERT INTO audit(actor_id,action,subject) VALUES($1,$2,$3)", [
    actor,
    action,
    subject,
  ]);
}
