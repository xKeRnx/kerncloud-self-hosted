import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";
const db = process.env.TEST_DATABASE_URL;
if (!db || !/^\/[a-z0-9_]+_test$/.test(new URL(db).pathname))
  throw new Error("Dedicated TEST_DATABASE_URL ending _test is mandatory.");
process.env.DATABASE_URL = db;
process.env.ADMIN_EMAIL = "load-admin@fixture.invalid";
process.env.ADMIN_PASSWORD = "load-admin-fixture-password";
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.MAINTENANCE_MODE = "external";
const adminUrl = new URL(db);
adminUrl.pathname = "/postgres";
const admin = new pg.Pool({ connectionString: adminUrl.toString() });
const name = new URL(db).pathname.slice(1);
if (
  !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
    .rowCount
)
  await admin.query('CREATE DATABASE "' + name + '"');
await admin.end();
const { ensureDb, pool } = await import("../src/server/db.ts");
const { hashPassword, hashToken } = await import("../src/server/security.ts");
await ensureDb();
const users = Math.max(
    1,
    Math.min(100000, Number(process.env.LOAD_USERS ?? 1000)),
  ),
  concurrency = Math.max(
    1,
    Math.min(500, Number(process.env.LOAD_CONCURRENCY ?? 25)),
  ),
  requests = Math.max(
    concurrency,
    Math.min(100000, Number(process.env.LOAD_REQUESTS ?? 500)),
  ),
  prefix = "load-" + randomUUID().slice(0, 8);
const hash = hashPassword("load-test-only-password");
await pool.query(
  `INSERT INTO users(id,email,name,password_hash,privacy_version) SELECT $1||'-'||n,$1||'-'||n||'@fixture.invalid','Synthetic load fixture',$3,'fixture' FROM generate_series(1,$2) n`,
  [prefix, users, hash],
);
await pool.query(
  `INSERT INTO accounts(id,owner_id,plan_id) SELECT id,id,'free' FROM users WHERE id LIKE $1`,
  [prefix + "-%"],
);
await pool.query(
  `INSERT INTO workspaces(id,owner_id,name) SELECT id,id,'Synthetic load workspace' FROM users WHERE id LIKE $1`,
  [prefix + "-%"],
);
await pool.query(
  `INSERT INTO agents(id,workspace_id,name,role,instructions,color) SELECT gen_random_uuid()::text,id,'Load fixture','Fixture','No model execution','cyan' FROM workspaces WHERE id LIKE $1`,
  [prefix + "-%"],
);
const cookies: string[] = [];
for (let i = 1; i <= users; i++) {
  const raw = prefix + "-session-" + i;
  cookies.push("kc_session=" + raw);
}
await pool.query(
  `INSERT INTO sessions(id,user_id,expires_at) SELECT x.hash,$1||'-'||x.n,now()+interval '1 hour' FROM jsonb_to_recordset($2::jsonb) x(n integer,hash text)`,
  [
    prefix,
    JSON.stringify(
      cookies.map((c, i) => ({ n: i + 1, hash: hashToken(c.split("=")[1]) })),
    ),
  ],
);
const children: ChildProcess[] = [];
const controllers: AbortController[] = [];
const logs: string[] = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const child = spawn(
    process.execPath,
    [
      "--require",
      "./tests/load-observer.cjs",
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: db,
        DB_POOL_MAX: "8",
        ADMIN_EMAIL: "",
        ADMIN_PASSWORD: "",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    },
  );
  children.push(child);
  child.stdout?.on("data", (d) => logs.push(String(d).slice(0, 500)));
  child.stderr?.on("data", (d) => logs.push(String(d).slice(0, 500)));
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return base;
    } catch {}
    await pause(100);
  }
  throw new Error("Load-test app did not start.");
}
async function queryCounts() {
  return Promise.all(children.map(child=>new Promise<number>((resolve,reject)=>{
    const id=randomUUID();
    const done=(m:any)=>{if(m?.kind==='kc-load-stats'&&m.id===id){clearTimeout(timer);child.off('message',done);resolve(m.queries);}};
    const timer=setTimeout(()=>{child.off('message',done);reject(new Error('Load observer did not respond'));},5000);
    child.on('message',done);child.send({kind:'kc-load-stats',id});
  })));
}
try {
  const bases = await Promise.all([launch(), launch()]);
  let issued = 0,
    failures = 0,
    bytes = 0;
  const latencies: number[] = [];
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (issued < requests) {
        const n = issued++;
        const since = performance.now();
        try {
          const r = await fetch(bases[n % 2] + "/api/state?view=models", {
            headers: { cookie: cookies[n % users] },
            signal: AbortSignal.timeout(30000),
          });
          const text = await r.text();
          bytes += Buffer.byteLength(text);
          if (!r.ok) failures++;
        } catch {
          failures++;
        }
        latencies.push(performance.now() - since);
      }
    }),
  );
  const seconds = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);
  const streamMessages: number[] = [];
  const streams = Math.min(100, users);
  await Promise.all(
    Array.from({ length: streams }, async (_, i) => {
      const controller = new AbortController();
      controllers.push(controller);
      const r = await fetch(
        bases[i % 2] +
          "/api/synchronization?workspaceId=" +
          prefix +
          "-" +
          (i + 1),
        { headers: { cookie: cookies[i] }, signal: controller.signal },
      );
      if (!r.ok) throw new Error("SSE fixture rejected");
      const reader = r.body!.getReader();
      await reader.read();
      streamMessages[i] = 0;
      void (async () => {
        try {
          while (!(await reader.read()).done) {
            streamMessages[i]++;
          }
        } catch {}
      })();
    }),
  );
  await pause(2000);
  const messagesBefore = streamMessages[0];
  const loadAgentId = (await pool.query("SELECT id FROM agents WHERE workspace_id=$1 LIMIT 1",[prefix+"-1"])).rows[0].id;
  const changed = await fetch(bases[1] + "/api/agents", {
    method: "POST",
    headers: { cookie: cookies[0], "content-type": "application/json" },
    body: JSON.stringify({
      id: loadAgentId,
      name: "Updated cross-app fixture",
      role: "Fixture",
      instructions: "No model execution",
      color: "cyan",
      skill_ids: [],
      mcp_ids: [],
    }),
  });
  if (!changed.ok)
    throw new Error("Cross-app fixture write failed: " + changed.status);
  for (let n = 0; n < 60 && streamMessages[0] === messagesBefore; n++)
    await pause(50);
  if (streamMessages[0] === messagesBefore)
    throw new Error("Cross-app event was not delivered");
  const verified = await (
    await fetch(bases[0] + "/api/state?view=agents", {
      headers: { cookie: cookies[0] },
    })
  ).json();
  if (!verified.agents.some((a: any) => a.name === "Updated cross-app fixture"))
    throw new Error("Cross-app write not visible");
  await pause(1500);
  const appQueriesBefore = await queryCounts();
  if(appQueriesBefore.some(n=>n<1))throw new Error("Load observer not attached to app database client");
  const before = Number(
    (
      await pool.query(
        "SELECT xact_commit FROM pg_stat_database WHERE datname=current_database()",
      )
    ).rows[0].xact_commit,
  );
  await pause(5000);
  const after = Number(
    (
      await pool.query(
        "SELECT xact_commit FROM pg_stat_database WHERE datname=current_database()",
      )
    ).rows[0].xact_commit,
  );
  const appQueriesAfter = await queryCounts();
  const report = {
    timestamp: new Date().toISOString(),
    fixture_database: name,
    synthetic_registered_users: users,
    app_instances: 2,
    cross_app_write_and_event: true,
    http_concurrency: concurrency,
    requests,
    failures,
    rps: requests / seconds,
    p50_ms: latencies[Math.floor(latencies.length * 0.5)],
    p95_ms: latencies[Math.floor(latencies.length * 0.95)],
    response_bytes: bytes,
    idle_streams: streams,
    idle_window_seconds: 5,
    database_commits_during_idle: after - before,
    app_sql_queries_during_idle: appQueriesAfter.reduce((sum,n,i)=>sum+n-appQueriesBefore[i],0),
    model_calls: Number(
      (
        await pool.query(
          "SELECT count(*)::int n FROM model_calls m JOIN workspaces w ON w.id=m.workspace_id WHERE w.id LIKE $1",
          [prefix + "-%"],
        )
      ).rows[0].n,
    ),
    note: "Synthetic local read workload; not a 100k capacity guarantee or an agent/container concurrency benchmark.",
  };
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/scaling-load.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (failures) process.exitCode = 1;
} finally {
  for (const c of controllers) c.abort();
  for (const c of children) c.kill();
  await pool.end();
}
