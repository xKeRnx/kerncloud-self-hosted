import { createAgentDispatcher } from "./agent-tools.ts";
import { GatewayDirectory, forwardHttp, forwardUpgrade } from "./directory.ts";
import { scheduled } from "../server/scheduled-work.ts";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { ServerResponse, IncomingMessage } from "node:http";
import { ensureDb, pool, transaction } from "../server/db.ts";
import { hashToken, sameSecret } from "../server/security.ts";
import {
  accessSql,
  validParent,
  environmentHost,
  environmentOrigin,
  environmentBase,
} from "../server/environment-access.ts";
import { maintainRuntime } from "../server/runtime.ts";
const cookieName = "kc_environment_session";
const forbidden = new Set([
  "connection",
  "upgrade",
  "transfer-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "x-powered-by",
]);
function send(ws: WebSocket, value: unknown) {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 8388608)
    throw new Error("Tunnel nicht verfügbar.");
  ws.send(JSON.stringify(value));
}
async function sendAsync(ws: WebSocket, value: unknown) {
  if (ws.readyState !== WebSocket.OPEN) throw new Error();
  await new Promise<void>((resolve, reject) =>
    ws.send(JSON.stringify(value), (e) => (e ? reject(e) : resolve())),
  );
}
function safeHeaders(headers: Record<string, any>, upstream = false) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase();
    if (
      forbidden.has(name) ||
      name === "authorization" ||
      name === "cookie" ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("sec-websocket-") ||
      name === "host" ||
      name === "origin"
    )
      continue;
    if (typeof v === "string" && !/[\r\n]/.test(v)) out[name] = v;
  }
  if (upstream) delete out["content-length"];
  return out;
}
function headers() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "frame-ancestors 'self'",
  };
}
function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    ...headers(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end(message);
}
async function authorize(req: IncomingMessage, id: string) {
  const cookie =
    (req.headers.cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) ?? "";
  const session = hashToken(cookie);
  const row = (
    await pool.query(
      "SELECT * FROM environment_sessions WHERE id=$1 AND environment_id=$2 AND expires_at>now()",
      [session, id],
    )
  ).rows[0];
  if (!row) return null;
  const e = (await pool.query(accessSql, [id, row.generation])).rows[0];
  if (!e || !(await validParent(pool, row.parent_session, e))) return null;
  await pool.query(
    "UPDATE customer_environments SET last_activity_at=now() WHERE id=$1 AND last_activity_at<now()-interval '30 seconds'",
    [id],
  );
  return { environment: e, session };
}
async function validSession(id: string, session: string) {
  const row = (
    await pool.query(
      "SELECT * FROM environment_sessions WHERE id=$1 AND environment_id=$2 AND expires_at>now()",
      [session, id],
    )
  ).rows[0];
  if (!row) return false;
  const e = (await pool.query(accessSql, [id, row.generation])).rows[0];
  return e && (await validParent(pool, row.parent_session, e));
}
function requestHeaders(req: IncomingMessage, id: string) {
  return {
    ...safeHeaders(req.headers),
    host: new URL(environmentOrigin(id)).host,
    "x-forwarded-proto": environmentBase().protocol.slice(0, -1),
    origin: environmentOrigin(id),
  };
}
export async function startGateway(
  port = Number(process.env.GATEWAY_PORT ?? 3200),
  hostname = process.env.GATEWAY_BIND ?? "0.0.0.0",
  cluster?: { id?: string; address?: string; peers?: string[] },
) {
  await ensureDb();
  environmentBase();
  const relayServer = new WebSocketServer({
    noServer: true,
    maxPayload: 262144,
    perMessageDeflate: false,
  });
  const customerServer = new WebSocketServer({
    noServer: true,
    maxPayload: 16777216,
    perMessageDeflate: false,
  });
  const relays = new Map<
    string,
    { ws: WebSocket; generation: number; alive: boolean; token?: string }
  >();
  const pending = new Map<
    string,
    {
      relay: WebSocket;
      response?: ServerResponse;
      socket?: WebSocket;
      timer: ReturnType<typeof setTimeout>;
      bytes: number;
      environmentId: string;
      session: string;
    }
  >();
  const connections = new Set<{
    ws: WebSocket;
    environmentId: string;
    session: string;
  }>();

  function clear(id: string) {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    return p;
  }

  const { agentToolReply, agentToolTick, stopAgentTools } =
    createAgentDispatcher();
  let directory: GatewayDirectory | undefined;
  const route = async (
    req: http.IncomingMessage,
    id: string,
    generation: number,
  ) => {
    if (!directory) return null;
    const owner = await directory.owner(id, generation);
    if (!owner) throw new Error("No active gateway owner.");
    if (owner.gateway_id === directory.id) {
      if (relays.get(id)?.token !== owner.token)
        throw new Error("Stale gateway lease.");
      return null;
    }
    return owner.address;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://gateway");
      if (url.pathname === "/_health") {
        res.writeHead(200);
        res.end("ok");
        return;
      }
      if (url.pathname === "/_tls/allowed") {
        const id = environmentHost(
          `${url.searchParams.get("domain") ?? ""}${environmentBase().port ? ":" + environmentBase().port : ""}`,
        );
        const e = id
          ? (
              await pool.query(
                "SELECT 1 FROM customer_environments WHERE id=$1 AND status='running' AND NOT access_blocked",
                [id],
              )
            ).rowCount
          : 0;
        res.writeHead(e ? 200 : 403);
        res.end();
        return;
      }
      const id = environmentHost(req.headers.host ?? "");
      if (!id) {
        fail(res, 404, "Unbekannte Umgebung.");
        return;
      }
      if (url.pathname === "/_launch") {
        const raw = url.searchParams.get("ticket") ?? "";
        if (raw.length > 100) {
          fail(res, 403, "Ungültiger Zugang.");
          return;
        }
        const token = randomBytes(32).toString("base64url");
        const ok = await transaction(async (c) => {
          const ticket = (
            await c.query(
              "DELETE FROM environment_tickets WHERE id=$1 AND environment_id=$2 AND expires_at>now() RETURNING *",
              [hashToken(raw), id],
            )
          ).rows[0];
          if (!ticket) return false;
          const e = (await c.query(accessSql, [id, ticket.generation])).rows[0];
          if (!e || !(await validParent(c, ticket.parent_session, e)))
            return false;
          await c.query(
            "INSERT INTO environment_sessions(id,environment_id,generation,parent_session) VALUES($1,$2,$3,$4)",
            [hashToken(token), id, ticket.generation, ticket.parent_session],
          );
          return ticket.target_path || "/";
        });
        if (!ok) {
          fail(
            res,
            403,
            "Zugang abgelaufen oder bereits verwendet. Bitte im Workspace erneut öffnen.",
          );
          return;
        }
        res.writeHead(303, {
          ...headers(),
          "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${environmentBase().protocol === "https:" ? "; Secure" : ""}`,
          Location: typeof ok === "string" ? ok : "/",
        });
        res.end();
        return;
      }
      const auth = await authorize(req, id);
      if (!auth) {
        fail(
          res,
          401,
          "Bitte diese Umgebung aus deinem angemeldeten KeRnCloud-Workspace öffnen.",
        );
        return;
      }
      if (req.headers.origin && req.headers.origin !== environmentOrigin(id)) {
        fail(res, 403, "Fremde Anfrageherkunft abgelehnt.");
        return;
      }
      const remote = await route(req, id, auth.environment.generation);
      if (remote) {
        forwardHttp(req, res, remote);
        return;
      }
      const relay = relays.get(id);
      if (!relay || relay.generation !== auth.environment.generation) {
        fail(res, 503, "Verbindung zur Umgebung ist unterbrochen.");
        return;
      }
      if (
        [...pending.values()].filter((p) => p.environmentId === id).length >= 64
      ) {
        fail(res, 429, "Zu viele gleichzeitige Verbindungen.");
        return;
      }
      if (pending.size >= Number(process.env.GATEWAY_MAX_PENDING ?? 2000)) {
        fail(res, 429, "Gateway ausgelastet.");
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16777216) {
          fail(
            res,
            413,
            "Upload über den Zugang ist auf 16 MiB pro Anfrage begrenzt.",
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      if (!(await validSession(id, auth.session))) {
        fail(res, 401, "Zugang beendet.");
        return;
      }
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        const p = clear(requestId);
        if (p?.response)
          fail(p.response, 504, "Zeitüberschreitung der Umgebung.");
        try {
          send(relay.ws, { kind: "cancel", id: requestId });
        } catch {}
      }, 120000);
      pending.set(requestId, {
        relay: relay.ws,
        response: res,
        timer,
        bytes: 0,
        environmentId: id,
        session: auth.session,
      });
      res.on("close", () => {
        if (clear(requestId))
          try {
            send(relay.ws, { kind: "cancel", id: requestId });
          } catch {}
      });
      send(relay.ws, {
        kind: "http",
        id: requestId,
        method: req.method,
        path: req.url,
        headers: requestHeaders(req, id),
      });
      const body = Buffer.concat(chunks);
      for (let i = 0; i < body.length; i += 65536)
        await sendAsync(relay.ws, {
          kind: "body",
          id: requestId,
          data: body.subarray(i, i + 65536).toString("base64"),
        });
      send(relay.ws, { kind: "body-end", id: requestId });
    } catch {
      fail(res, 503, "Geschützter Zugang derzeit nicht verfügbar.");
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 120000;
  server.on("upgrade", async (req, socket, head) => {
    try {
      if (req.url === "/_relay") {
        if (relays.size >= Number(process.env.GATEWAY_MAX_RELAYS ?? 1000))
          throw new Error("Gateway capacity reached.");
        const id = String(req.headers["x-environment-id"] ?? ""),
          generation = Number(req.headers["x-environment-generation"]),
          token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        const e = (
          await pool.query(
            "SELECT c.relay_hash FROM environment_credentials c JOIN customer_environments e ON e.id=c.environment_id JOIN infrastructure_hosts h ON h.id=e.host_id WHERE e.id=$1 AND e.generation=$2 AND e.status<>'deleted' AND h.enabled",
            [id, generation],
          )
        ).rows[0];
        if (
          !e ||
          token.length < 40 ||
          !sameSecret(e.relay_hash ?? "", hashToken(token))
        )
          throw new Error();
        const tokenClaim = directory
          ? await directory.claim(id, generation)
          : undefined;
        relayServer.handleUpgrade(req, socket, head, (ws) => {
          relays.get(id)?.ws.close(1008, "Ersetzt");
          const relay = { ws, generation, alive: true, token: tokenClaim };
          relays.set(id, relay);
          void pool.query(
            "UPDATE customer_environments SET relay_seen=now() WHERE id=$1 AND generation=$2",
            [id, generation],
          );
          ws.on("pong", () => (relay.alive = true));
          ws.on("message", (raw) => {
            try {
              const m = JSON.parse(raw.toString());
              if (m.kind === "controller-ready") {
                void pool
                  .query(
                    "UPDATE customer_environments SET controller_seen=CASE WHEN $3::boolean THEN now() ELSE NULL END WHERE id=$1 AND generation=$2",
                    [id, generation, m.version === 1],
                  )
                  .catch(() => {});
                return;
              }
              if (m.kind === "agent-result") {
                void agentToolReply(ws, m).catch(() => {});
                return;
              }
              const p = pending.get(m.id);
              if (!p || p.relay !== ws) return;
              if (m.kind === "head" && p.response && !p.response.headersSent) {
                const status = Number(m.status);
                if (!Number.isInteger(status) || status < 200 || status > 599)
                  throw new Error();
                p.response.writeHead(status, {
                  ...safeHeaders(m.headers ?? {}, true),
                  ...headers(),
                });
              } else if (
                m.kind === "data" &&
                typeof m.data === "string" &&
                p.response
              ) {
                const data = Buffer.from(m.data, "base64");
                p.bytes += data.length;
                if (p.bytes > 67108864) throw new Error();
                if (p.response.writableLength > 8388608) throw new Error();
                p.response.write(data);
              } else if (m.kind === "end") {
                clear(m.id)?.response?.end();
              } else if (m.kind === "error") {
                const pending = clear(m.id);
                if (pending?.response)
                  fail(pending.response, 502, "Umgebung antwortet nicht.");
                pending?.socket?.close(1011, "Verbindung unterbrochen");
              } else if (
                m.kind === "ws-data" &&
                typeof m.data === "string" &&
                p.socket
              ) {
                if (p.socket.bufferedAmount > 8388608) throw new Error();
                p.socket.send(Buffer.from(m.data, "base64"), {
                  binary: Boolean(m.binary),
                  fin: m.final !== false,
                });
              } else if (m.kind === "ws-close") {
                clear(m.id)?.socket?.close(1000);
              }
            } catch {
              ws.close(1008, "Ungültige Tunnelantwort");
            }
          });
          ws.on("close", () => {
            if (relays.get(id)?.ws === ws) relays.delete(id);
            for (const [key, p] of pending) {
              if (p.relay !== ws) continue;
              clear(key);
              if (p.response)
                fail(p.response, 503, "Verbindung zur Umgebung beendet.");
              p.socket?.close(1011);
            }
          });
          ws.on("error", () => {});
        });
        return;
      }
      const id = environmentHost(req.headers.host ?? "");
      if (!id || req.headers.origin !== environmentOrigin(id))
        throw new Error();
      const auth = await authorize(req, id);
      if (!auth) throw new Error();
      const remote = await route(req, id, auth.environment.generation);
      if (remote) {
        forwardUpgrade(req, socket, head, remote);
        return;
      }
      const relay = relays.get(id);
      if (!auth || !relay || relay.generation !== auth.environment.generation)
        throw new Error();
      if ([...connections].filter((c) => c.environmentId === id).length >= 32)
        throw new Error();
      customerServer.handleUpgrade(req, socket, head, (ws) => {
        const requestId = randomUUID(),
          item = { ws, environmentId: id, session: auth.session };
        connections.add(item);
        const timer = setTimeout(
          () => ws.close(1000, "Bitte Umgebung erneut öffnen"),
          28800000,
        );
        pending.set(requestId, {
          relay: relay.ws,
          socket: ws,
          timer,
          bytes: 0,
          environmentId: id,
          session: auth.session,
        });
        send(relay.ws, {
          kind: "ws-open",
          id: requestId,
          path: req.url,
          headers: requestHeaders(req, id),
          protocol: ws.protocol,
        });
        let queue = Promise.resolve(),
          queued = 0;
        ws.on("message", (data, binary) => {
          const body = Buffer.from(data as Buffer);
          queued += body.length;
          if (queued > 33554432) {
            ws.close(1009);
            return;
          }
          queue = queue
            .then(async () => {
              for (let i = 0; i < Math.max(1, body.length); i += 65536)
                await sendAsync(relay.ws, {
                  kind: "ws-data",
                  id: requestId,
                  data: body.subarray(i, i + 65536).toString("base64"),
                  binary,
                  final: i + 65536 >= body.length,
                });
            })
            .catch(() => ws.close(1011))
            .finally(() => {
              queued -= body.length;
            });
        });
        ws.on("close", () => {
          connections.delete(item);
          clear(requestId);
          try {
            send(relay.ws, { kind: "cancel", id: requestId });
          } catch {}
        });
        ws.on("error", () => {});
      });
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
  let ticking = false,
    closing = false;
  const tick = async () => {
    if (ticking || closing) return;
    ticking = true;
    try {
      await scheduled("runtime", 2000, () => transaction(maintainRuntime));
      if (directory) {
        const valid = await directory.heartbeat(relays);
        for (const [id, r] of relays)
          if (!valid.has(id)) {
            r.ws.close(1008, "Gateway ownership changed");
            relays.delete(id);
          }
      }
      const relayRows = [...relays]
        .filter(([, r]) => r.ws.readyState === WebSocket.OPEN)
        .map(([id, r]) => ({ id, generation: r.generation }));
      if (relayRows.length)
        await pool.query(
          "UPDATE customer_environments e SET relay_seen=now() FROM jsonb_to_recordset($1::jsonb) AS r(id text,generation integer) WHERE e.id=r.id AND e.generation=r.generation",
          [JSON.stringify(relayRows)],
        );
      const activeSessions = [
        ...new Set(
          [...pending.values()]
            .map((p) => p.session)
            .concat([...connections].map((c) => c.session)),
        ),
      ];
      const valid = new Set<string>();
      for (let offset = 0; offset < activeSessions.length; offset += 1000) {
        const sql = accessSql
          .replace(
            "SELECT e.*,w.owner_id",
            "SELECT s.id AS session_id,e.id AS environment_id",
          )
          .replace(
            " WHERE e.id=$1 AND e.generation=$2 AND",
            " JOIN environment_sessions s ON s.environment_id=e.id AND s.generation=e.generation JOIN sessions p ON p.id=s.parent_session WHERE s.id=ANY($1::text[]) AND s.expires_at>now() AND p.expires_at>now() AND p.user_id=w.owner_id AND (p.mfa_verified OR NOT EXISTS(SELECT 1 FROM account_security x WHERE x.user_id=p.user_id AND x.totp_secret IS NOT NULL)) AND",
          );
        const rows = (
          await pool.query(sql, [activeSessions.slice(offset, offset + 1000)])
        ).rows;
        for (const row of rows)
          valid.add(row.environment_id + ":" + row.session_id);
      }
      for (const [id, p] of pending)
        if (p.response && !valid.has(p.environmentId + ":" + p.session)) {
          clear(id);
          p.response.destroy();
          try {
            send(p.relay, { kind: "cancel", id });
          } catch {}
        }
      for (const item of connections)
        if (!valid.has(item.environmentId + ":" + item.session))
          item.ws.close(1008, "Zugang beendet");
    } catch {
      for (const item of connections)
        item.ws.close(1011, "Statusprüfung fehlgeschlagen");
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => void tick(), 2000);
  const agentTimer = setInterval(() => void agentToolTick(relays, send), 500);
  const ping = setInterval(() => {
    for (const relay of relays.values()) {
      if (!relay.alive) {
        relay.ws.terminate();
        continue;
      }
      relay.alive = false;
      relay.ws.ping();
    }
  }, 10000);
  await new Promise<void>((resolve) => server.listen(port, hostname, resolve));
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  const advertised =
    cluster?.address ?? process.env.GATEWAY_ADVERTISE_URL ?? "auto";
  if (advertised) {
    directory = new GatewayDirectory(
      advertised === "auto" ? "http://127.0.0.1:" + actualPort : advertised,
      cluster?.id ?? (process.env.GATEWAY_ID ?? "gateway") + ":" + randomUUID(),
      cluster?.peers ??
        (process.env.GATEWAY_PEERS ?? "").split(",").filter(Boolean),
    );
    await directory.register();
  }
  await tick();
  return {
    server,
    directory,
    close: async () => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      while (ticking) await new Promise((r) => setTimeout(r, 10));
      await directory?.close();
      clearInterval(ping);
      clearInterval(agentTimer);
      stopAgentTools(send);
      for (const r of relays.values()) r.ws.terminate();
      for (const i of connections) i.ws.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/gateway/server.ts")) {
  const gateway = await startGateway();
  console.log("[Gateway] Geschützter Kundenzugang gestartet.");
  const close = async () => {
    await gateway.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
}
