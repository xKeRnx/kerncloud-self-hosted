import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db.ts";
export class GatewayDirectory {
  readonly id: string;
  readonly address: string;
  readonly peers: Set<string>;
  constructor(
    address: string,
    id: string = randomUUID(),
    peers: string[] = [],
  ) {
    this.id = id;
    this.address = address;
    this.peers = new Set([...peers, new URL(address).host]);
  }
  async register() {
    await pool.query(
      "INSERT INTO gateway_instances(id,address,expires_at) VALUES($1,$2,now()+interval '30 seconds') ON CONFLICT(id) DO UPDATE SET address=EXCLUDED.address,expires_at=EXCLUDED.expires_at",
      [this.id, this.address],
    );
  }
  async claim(environment: string, generation: number) {
    const token = randomUUID();
    await pool.query(
      "INSERT INTO environment_gateway_leases(environment_id,generation,gateway_id,token,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 seconds') ON CONFLICT(environment_id) DO UPDATE SET generation=EXCLUDED.generation,gateway_id=EXCLUDED.gateway_id,token=EXCLUDED.token,expires_at=EXCLUDED.expires_at",
      [environment, generation, this.id, token],
    );
    return token;
  }
  async owner(environment: string, generation: number) {
    const row = (
      await pool.query(
        "SELECT l.gateway_id,l.token,g.address FROM environment_gateway_leases l JOIN gateway_instances g ON g.id=l.gateway_id WHERE l.environment_id=$1 AND l.generation=$2 AND l.expires_at>now() AND g.expires_at>now()",
        [environment, generation],
      )
    ).rows[0];
    if (!row) return null;
    const u = new URL(row.address);
    if (
      u.protocol !== "http:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !this.peers.has(u.host)
    )
      return null;
    return row as { gateway_id: string; token: string; address: string };
  }
  async heartbeat(relays: Map<string, { token?: string }>) {
    await this.register();
    const data = [...relays].map(([environment_id, r]) => ({
      environment_id,
      token: r.token,
    }));
    const valid = await pool.query(
      "UPDATE environment_gateway_leases l SET expires_at=now()+interval '30 seconds' FROM jsonb_to_recordset($2::jsonb) AS r(environment_id text,token text) WHERE l.environment_id=r.environment_id AND l.token=r.token AND l.gateway_id=$1 RETURNING l.environment_id",
      [this.id, JSON.stringify(data)],
    );
    return new Set(valid.rows.map((r) => r.environment_id));
  }
  async close() {
    await pool.query("DELETE FROM gateway_instances WHERE id=$1", [this.id]);
  }
}
function target(req: IncomingMessage, address: string) {
  if (req.headers["x-kc-gateway-hop"])
    throw new Error("Gateway loop rejected.");
  return {
    url: new URL(req.url ?? "/", address),
    headers: { ...req.headers, "x-kc-gateway-hop": "1" },
  };
}
export function forwardHttp(
  req: IncomingMessage,
  res: ServerResponse,
  address: string,
) {
  const t = target(req, address);
  const upstream = http.request(
    t.url,
    { method: req.method, headers: t.headers, timeout: 120000 },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(503);
    res.end();
  });
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}
export function forwardUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  address: string,
) {
  const t = target(req, address);
  const upstream = http.request(t.url, {
    method: "GET",
    headers: t.headers,
    timeout: 120000,
  });
  upstream.on("upgrade", (r, peer, initial) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        Object.entries(r.headers)
          .map(([k, v]) => k + ": " + v)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (initial.length) socket.write(initial);
    if (head.length) peer.write(head);
    socket.pipe(peer);
    peer.pipe(socket);
    socket.on("error", () => peer.destroy());
    peer.on("error", () => socket.destroy());
    socket.on("close", () => peer.destroy());
    peer.on("close", () => socket.destroy());
  });
  upstream.on("response", (r) => {
    socket.end(
      "HTTP/1.1 " +
        (r.statusCode ?? 503) +
        " Error\r\nConnection: close\r\n\r\n",
    );
    r.resume();
  });
  upstream.on("error", () => socket.destroy());
  upstream.on("timeout", () => upstream.destroy());
  upstream.end();
}
