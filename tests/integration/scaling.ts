import { claim } from "../../src/server/store.ts";
import {
  drainWorker,
  workerCapacity,
} from "../../src/server/worker-capacity.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { NextRequest } from "next/server";
import { handle } from "../../src/server/api.ts";
import { transaction } from "../../src/server/db.ts";
import { hashToken, encrypt } from "../../src/server/security.ts";
import {
  subscribeChanges,
  changeHubStats,
} from "../../src/server/change-hub.ts";
import { startObjectStorage } from "../../src/storage/server.ts";
import {
  collectOrphanObjects,
  migrateBinaryBatch,
} from "../../src/server/object-migration.ts";
import { readBinary } from "../../src/server/object-storage.ts";
import { artifactResponse, runArchive } from "../../src/server/artifacts.ts";
import { scheduled } from "../../src/server/scheduled-work.ts";
import { startGateway } from "../../src/gateway/server.ts";
import { unzipSync } from "fflate";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wait(fn: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await delay(30);
  }
  throw new Error("Scaling fixture timed out");
}
export async function scalingTests(t: any, { request, pool, admin }: any) {
  const a = await request("auth/signup", {
    email: "scaling-a@fixture.invalid",
    name: "Scaling A",
    password: "scaling-fixture-password",
    privacyAccepted: true,
  });
  const b = await request("auth/signup", {
    email: "scaling-b@fixture.invalid",
    name: "Scaling B",
    password: "scaling-fixture-password",
    privacyAccepted: true,
  });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const state = (await request("state", undefined, a.cookie)).data,
    other = (await request("state", undefined, b.cookie)).data,
    ws = state.workspace.id,
    agent = state.agents[0].id,
    run = randomUUID(),
    task = randomUUID(),
    artifact = randomUUID();
  await pool.query(
    "INSERT INTO runs(id,workspace_id,goal,status,max_steps) SELECT 'scale-run-'||n,$1,'Synthetic scaling fixture','completed',1 FROM generate_series(1,105) n",
    [ws],
  );
  await pool.query(
    "INSERT INTO runs(id,workspace_id,goal,status,max_steps) VALUES($1,$2,'Detail outside first page','completed',1)",
    [run, ws],
  );
  await pool.query(
    "INSERT INTO tasks(id,workspace_id,run_id,agent_id,title,instructions,status,result) VALUES($1,$2,$3,$4,'Fixture','Fixture','completed','Fixture result')",
    [task, ws, run, agent],
  );
  await pool.query(
    "INSERT INTO artifacts(id,workspace_id,run_id,task_id,name,content) VALUES($1,$2,$3,$4,'large.html',$5)",
    [artifact, ws, run, task, "<html>" + "x".repeat(180000) + "</html>"],
  );
  await t.test(
    "view-scoped state omits heavy sections and lazy sources stay tenant scoped",
    async () => {
      const legacy = (await request("state", undefined, a.cookie)).data;
      const lean = await request("state?view=workspaces", undefined, a.cookie);
      assert.equal(lean.status, 200);
      for (const key of [
        "runs",
        "tasks",
        "events",
        "artifacts",
        "attachments",
        "chat",
        "memory",
        "skills",
        "ledger",
      ])
        assert.equal(lean.data[key].length, 0, key);
      assert.ok(
        JSON.stringify(lean.data).length < JSON.stringify(legacy).length / 3,
      );
      const detail = await request(
        "state?view=tasks&runId=" + run,
        undefined,
        a.cookie,
      );
      assert.equal(detail.data.artifacts[0].content, "");
      assert.equal(detail.data.tasks[0].result, "Fixture result");
      const source = await request(
        "artifacts/" + artifact + "/source",
        undefined,
        a.cookie,
      );
      assert.equal(source.data.content.length, 180013);
      assert.equal(
        (
          await request(
            "artifacts/" + artifact + "/source",
            undefined,
            b.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await request("state?view=__proto__", undefined, a.cookie)).status,
        400,
      );
    },
  );
  await t.test(
    "keyset pages neither overlap nor expose another workspace, including direct old task links",
    async () => {
      const ids = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 4; page++) {
        const response: any = await request(
          "state?view=tasks" + (cursor ? "&before=" + cursor : ""),
          undefined,
          a.cookie,
        );
        assert.equal(response.status, 200);
        for (const r of response.data.runs) {
          assert.ok(!ids.has(r.id));
          ids.add(r.id);
        }
        cursor = response.data.page.runs_next;
        if (!cursor) break;
      }
      assert.equal(ids.size, 106);
      assert.equal(
        (await request("state?view=tasks&runId=" + run, undefined, b.cookie))
          .data.runs.length,
        0,
      );
      assert.equal(
        (await request("state?view=tasks&before=bad", undefined, a.cookie))
          .status,
        400,
      );
    },
  );
  await t.test(
    "committed events cross database sessions; rollback and other tenants produce no notification",
    async () => {
      const seen: any[] = [];
      const stop = subscribeChanges({
        workspace: ws,
        account: state.workspace.account_id,
        user: state.user.id,
        notify: (c) => {
          if (c.topic === "events") seen.push(c);
        },
      });
      try {
        await wait(() => changeHubStats().connected);
        await pool.query(
          "INSERT INTO events(workspace_id,kind,content) VALUES($1,'fixture','foreign')",
          [other.workspace.id],
        );
        await delay(100);
        assert.equal(seen.length, 0);
        try {
          await transaction(async (c) => {
            await c.query(
              "INSERT INTO events(workspace_id,kind,content) VALUES($1,'fixture','rolled back')",
              [ws],
            );
            throw new Error("rollback fixture");
          });
        } catch {}
        await delay(100);
        assert.equal(seen.length, 0);
        await pool.query(
          "INSERT INTO events(workspace_id,kind,content) VALUES($1,'fixture','committed')",
          [ws],
        );
        await wait(() => seen.length === 1);
        assert.deepEqual(Object.keys(seen[0]).sort(), ["id", "scope", "topic"]);
      } finally {
        stop();
      }
    },
  );
  await t.test(
    "live SSE stays quiet when idle and updates after committed events with no foreign content",
    async () => {
      const controller = new AbortController();
      const response = await handle(
        new NextRequest("http://localhost:3100/api/live", {
          headers: { cookie: a.cookie },
          signal: controller.signal,
        }),
        "live",
      );
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      try {
        const first = await reader.read();
        assert.ok(first.value);
        let updated = false;
        const next = reader.read().then((r) => {
          updated = true;
          return r;
        });
        await pool.query(
          "INSERT INTO events(workspace_id,kind,content) VALUES($1,'fixture','foreign private')",
          [other.workspace.id],
        );
        await delay(300);
        assert.equal(updated, false);
        await pool.query(
          "INSERT INTO events(workspace_id,kind,content) VALUES($1,'fixture','own update')",
          [ws],
        );
        const result = await next;
        const text = Buffer.from(result.value!).toString();
        assert.match(text, /own update/);
        assert.ok(!text.includes("foreign private"));
      } finally {
        controller.abort();
        await reader.cancel();
      }
    },
  );
  await t.test(
    "session revocation closes live access before another content update",
    async () => {
      const raw = randomUUID() + randomUUID();
      await pool.query(
        "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [hashToken(raw), state.user.id],
      );
      const controller = new AbortController();
      const response = await handle(
        new NextRequest("http://localhost:3100/api/live", {
          headers: { cookie: "kc_session=" + raw },
          signal: controller.signal,
        }),
        "live",
      );
      const reader = response.body!.getReader();
      await reader.read();
      try {
        await pool.query("DELETE FROM sessions WHERE id=$1", [hashToken(raw)]);
        await pool.query(
          "INSERT INTO events(workspace_id,kind,content) VALUES($1,'fixture','after revocation secret')",
          [ws],
        );
        const result = await reader.read();
        assert.equal(result.done, true);
      } finally {
        controller.abort();
        await reader.cancel();
      }
    },
  );
  await t.test(
    "external object migration verifies encrypted bytes and preserves downloads, ZIPs and legacy reads",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "kc-storage-fixture-")),
        token = randomUUID() + randomUUID(),
        server = await startObjectStorage(root, token, 0, "127.0.0.1");
      const address = server.address() as { port: number };
      const previous = {
        url: process.env.OBJECT_STORAGE_URL,
        token: process.env.OBJECT_STORAGE_TOKEN,
      };
      const bytes = Buffer.from("binary fixture bytes");
      try {
        delete process.env.OBJECT_STORAGE_URL;
        await pool.query("UPDATE artifacts SET binary_data=$2 WHERE id=$1", [
          artifact,
          bytes,
        ]);
        assert.deepEqual(
          Buffer.from(
            await (
              await artifactResponse(ws, artifact, "download")
            ).arrayBuffer(),
          ),
          bytes,
        );
        process.env.OBJECT_STORAGE_URL = "http://127.0.0.1:" + address.port;
        process.env.OBJECT_STORAGE_TOKEN = token;
        assert.equal(
          (
            await fetch(
              process.env.OBJECT_STORAGE_URL + "/objects/not/a-valid-key",
            )
          ).status,
          401,
        );
        assert.equal(await migrateBinaryBatch(), 1);
        const row = (
          await pool.query("SELECT * FROM artifacts WHERE id=$1", [artifact])
        ).rows[0];
        assert.equal(row.binary_data, null);
        assert.equal(row.binary_bytes, bytes.length);
        const cipher = await readFile(join(root, row.binary_object));
        assert.ok(!cipher.includes(bytes));
        assert.deepEqual(await readBinary(row), bytes);
        assert.deepEqual(
          Buffer.from(
            await (
              await artifactResponse(ws, artifact, "download")
            ).arrayBuffer(),
          ),
          bytes,
        );
        const zip = unzipSync(
          new Uint8Array(await (await runArchive(ws, run)).arrayBuffer()),
        );
        assert.deepEqual(Buffer.from(zip["large.html"]), bytes);
        await assert.rejects(() =>
          readBinary({ ...row, workspace_id: other.workspace.id }),
        );
        await writeFile(
          join(root, row.binary_object),
          Buffer.from("corrupt fixture"),
        );
        await assert.rejects(() => readBinary(row));
        await writeFile(join(root, row.binary_object), cipher);
        await pool.query(
          "UPDATE object_uploads SET created_at=now()-interval '31 days' WHERE object_key=$1",
          [row.binary_object],
        );
        await collectOrphanObjects();
        assert.deepEqual(
          await readBinary(row),
          bytes,
          "referenced objects survive collection",
        );
        // Keep the verified original in this disposable database for following independent tests.
        await pool.query(
          "UPDATE artifacts SET binary_data=$2,binary_object=NULL,binary_bytes=0,binary_sha256=NULL WHERE id=$1",
          [artifact, bytes],
        );
        await collectOrphanObjects();
        await assert.rejects(() => readFile(join(root, row.binary_object)));
      } finally {
        if (previous.url === undefined) delete process.env.OBJECT_STORAGE_URL;
        else process.env.OBJECT_STORAGE_URL = previous.url;
        if (previous.token === undefined)
          delete process.env.OBJECT_STORAGE_TOKEN;
        else process.env.OBJECT_STORAGE_TOKEN = previous.token;
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );
  await t.test(
    "shared scheduler executes one claimant, fences stale completion and recovers expiry",
    async () => {
      let calls = 0;
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const name = "fixture-" + randomUUID();
      const first = scheduled(name, 30000, async () => {
        calls++;
        await gate;
      });
      await wait(() => calls === 1);
      assert.equal(
        await scheduled(name, 30000, async () => {
          calls++;
        }),
        false,
      );
      release();
      assert.equal(await first, true);
      assert.equal(calls, 1);
      assert.equal(
        await scheduled(name, 30000, async () => {
          calls++;
        }),
        false,
      );
      await pool.query(
        "UPDATE scheduler_leases SET lease_until=now()-interval '1 second',next_at=now()-interval '1 second' WHERE name=$1",
        [name],
      );
      assert.equal(
        await scheduled(name, 30000, async () => {
          calls++;
        }),
        true,
      );
      assert.equal(calls, 2);
    },
  );
  await t.test(
    "two gateway instances route authenticated HTTP and WebSockets to the leased owner and fail closed",
    async () => {
      const host = randomUUID(),
        environment = randomUUID(),
        secret = randomUUID() + randomUUID(),
        session = randomUUID() + randomUUID();
      await pool.query(
        "INSERT INTO infrastructure_hosts(id,name,kind,token_hash,enabled,last_seen) VALUES($1,'Scaling fixture','docker',$2,true,now())",
        [host, hashToken(secret)],
      );
      await pool.query(
        "INSERT INTO customer_environments(id,workspace_id,host_id,template_id,name,status,self_service) VALUES($1,$2,$3,'development','Scaling fixture','running',false)",
        [environment, ws, host],
      );
      await pool.query(
        "INSERT INTO environment_credentials(environment_id,secret,relay_secret,relay_hash) VALUES($1,$2,$2,$3)",
        [environment, encrypt(secret), hashToken(secret)],
      );
      await pool.query(
        "INSERT INTO environment_sessions(id,environment_id,generation,parent_session) VALUES($1,$2,1,$3)",
        [hashToken(session), environment, hashToken(a.cookie.split("=")[1])],
      );
      const g1 = await startGateway(0, "127.0.0.1", {
          id: "fixture-gateway-a",
          address: "auto",
        }),
        g2 = await startGateway(0, "127.0.0.1", {
          id: "fixture-gateway-b",
          address: "auto",
        });
      const p1 = (g1.server.address() as any).port,
        p2 = (g2.server.address() as any).port;
      // Operator allowlist only; no destination comes from a browser request.
      const previousPeers = process.env.GATEWAY_PEERS;
      // Each test gateway gets its peer through the returned operator directory.
      g1.directory!.peers.add("127.0.0.1:" + p2);
      g2.directory!.peers.add("127.0.0.1:" + p1);
      let relay: WebSocket | undefined, client: WebSocket | undefined;
      const publicHost = environment + ".localhost:3200",
        cookie = "kc_environment_session=" + session;
      const call = (port: number, headers: any = { cookie }) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = http.request(
            "http://127.0.0.1:" + port + "/",
            { headers: { host: publicHost, ...headers } },
            (res) => {
              let body = "";
              res.on("data", (d) => (body += d));
              res.on("end", () => resolve({ status: res.statusCode!, body }));
            },
          );
          req.on("error", reject);
          req.end();
        });
      try {
        relay = new WebSocket("ws://127.0.0.1:" + p1 + "/_relay", {
          headers: {
            authorization: "Bearer " + secret,
            "x-environment-id": environment,
            "x-environment-generation": "1",
          },
        });
        await new Promise<void>((r, j) => {
          relay!.once("open", r);
          relay!.once("error", j);
        });
        relay.on("message", (raw) => {
          const m = JSON.parse(raw.toString());
          if (m.kind === "http") {
            relay!.send(
              JSON.stringify({
                kind: "head",
                id: m.id,
                status: 200,
                headers: { "content-type": "text/plain" },
              }),
            );
            relay!.send(
              JSON.stringify({
                kind: "data",
                id: m.id,
                data: Buffer.from("leased owner fixture").toString("base64"),
              }),
            );
          }
          if (m.kind === "body-end")
            relay!.send(JSON.stringify({ kind: "end", id: m.id }));
          if (m.kind === "ws-data")
            relay!.send(JSON.stringify({ ...m, kind: "ws-data" }));
        });
        assert.deepEqual(await call(p2), {
          status: 200,
          body: "leased owner fixture",
        });
        assert.equal((await call(p2, { cookie: "" })).status, 401);
        assert.equal(
          (await call(p2, { cookie, origin: "https://foreign.invalid" }))
            .status,
          403,
        );
        client = new WebSocket("ws://127.0.0.1:" + p2 + "/socket", {
          headers: { host: publicHost, cookie },
          origin: "http://" + publicHost,
        });
        await new Promise<void>((r, j) => {
          client!.once("open", r);
          client!.once("error", j);
        });
        const reply = new Promise<string>((r) =>
          client!.once("message", (d) => r(d.toString())),
        );
        client.send("forwarded websocket fixture");
        assert.equal(await reply, "forwarded websocket fixture");
        client.close();
        await pool.query(
          "UPDATE gateway_instances SET address='http://169.254.169.254' WHERE id='fixture-gateway-a'",
        );
        assert.equal((await call(p2)).status, 503);
        await pool.query(
          "UPDATE gateway_instances SET address=$1 WHERE id=$2",
          ["http://127.0.0.1:" + p1, "fixture-gateway-a"],
        );
        relay.close();
        await delay(50);
        await g1.close();
        assert.equal((await call(p2)).status, 503);
      } finally {
        client?.terminate();
        relay?.terminate();
        await g2.close();
        await g1.close().catch(() => {});
        process.env.GATEWAY_PEERS = previousPeers;
      }
    },
  );
  await t.test(
    "worker draining atomically blocks new claims and refuses to stop active work",
    async () => {
      const worker = "drain-" + randomUUID(),
        r = randomUUID(),
        task = randomUUID();
      await pool.query(
        "INSERT INTO workers(id,name,concurrency) VALUES($1,'Drain fixture',2)",
        [worker],
      );
      await pool.query(
        "INSERT INTO runs(id,workspace_id,goal,max_steps) VALUES($1,$2,'Drain fixture',1)",
        [r, ws],
      );
      await pool.query(
        "INSERT INTO tasks(id,run_id,workspace_id,agent_id,title,instructions) VALUES($1,$2,$3,$4,'Drain fixture','No model execution')",
        [task, r, ws, agent],
      );
      assert.equal(await drainWorker(worker, true), true);
      assert.equal(await claim(worker), null);
      await drainWorker(worker, false);
      const claimed = await claim(worker);
      assert.equal(claimed?.task.id, task);
      assert.equal(await drainWorker(worker, true), false);
      await pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [
        task,
      ]);
      await pool.query("UPDATE runs SET status='completed' WHERE id=$1", [r]);
      assert.equal(await drainWorker(worker, true), true);
      assert.ok((await workerCapacity([])).demand_slots >= 0);
      const response = await handle(
        new NextRequest("http://localhost:3100/api/worker/autoscale/capacity", {
          method: "POST",
          headers: { cookie: a.cookie, "content-type": "application/json" },
          body: JSON.stringify({ owned: [] }),
        }),
        "worker/autoscale/capacity",
      );
      assert.equal(response.status, 401);
    },
  );
  await t.test("scaling diagnostics require admin authorization", async () => {
    assert.equal(
      (await request("admin/scaling", undefined, a.cookie)).status,
      403,
    );
    assert.equal(
      (await request("admin/scaling", undefined, admin.cookie)).status,
      200,
    );
  });
}
