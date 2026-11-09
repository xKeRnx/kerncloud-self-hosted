import http from "node:http";
import { WebSocket } from "ws";
const id = process.env.RELAY_ENVIRONMENT_ID ?? "",
  generation = process.env.RELAY_GENERATION ?? "",
  token = process.env.RELAY_TOKEN ?? "";
const target = new URL(process.env.RELAY_TARGET ?? "http://invalid");
const gateway = process.env.RELAY_URL ?? "";
if (
  !/^[a-f0-9-]{36}$/.test(id) ||
  !/^\d+$/.test(generation) ||
  token.length < 40 ||
  target.hostname !== `kerncloud-env-${id}-g${generation}` ||
  target.protocol !== "http:"
)
  throw new Error("Ungültige Relay-Konfiguration.");
const requests = new Map<string, http.ClientRequest>(),
  sockets = new Map<
    string,
    { ws: WebSocket; queue: { data: Buffer; binary: boolean; fin: boolean }[] }
  >();
let stopping = false,
  current: WebSocket | undefined,
  cookie = "",
  login: Promise<void> | undefined;
function send(value: unknown) {
  if (
    current?.readyState !== WebSocket.OPEN ||
    current.bufferedAmount > 8388608
  )
    throw new Error("Tunnel nicht verfügbar");
  current.send(JSON.stringify(value));
}
async function sendAsync(value: unknown) {
  const ws = current;
  if (ws?.readyState !== WebSocket.OPEN) throw new Error();
  await new Promise<void>((resolve, reject) =>
    ws.send(JSON.stringify(value), (e) => (e ? reject(e) : resolve())),
  );
}
function close(id: string) {
  requests.get(id)?.destroy();
  requests.delete(id);
  sockets.get(id)?.ws.close();
  sockets.delete(id);
}
async function authenticate() {
  if (process.env.RELAY_AUTH !== "code-server" || cookie) return;
  if (!login)
    login = (async () => {
      const r = await fetch(new URL("/login", target), {
        method: "POST",
        body: new URLSearchParams({
          password: process.env.RELAY_PASSWORD ?? "",
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      const value = r.headers.get("set-cookie");
      if (r.status !== 302 || !value)
        throw new Error("Editor-Anmeldung fehlgeschlagen");
      cookie = value.split(";")[0];
    })().finally(() => (login = undefined));
  await login;
}
function authHeaders(input: Record<string, string>) {
  const headers = { ...input };
  delete headers["content-length"];
  if (process.env.RELAY_AUTH === "basic")
    headers.authorization =
      "Basic " +
      Buffer.from(`kerncloud:${process.env.RELAY_PASSWORD ?? ""}`).toString(
        "base64",
      );
  if (cookie) headers.cookie = cookie;
  return headers;
}
async function handle(m: any) {
  if (typeof m.id !== "string" || !/^[a-f0-9-]{36}$/.test(m.id)) return;
  if (m.kind === "agent-start") {
    if (requests.has(m.id)) return;
    const data = JSON.stringify({ id: m.id, tool: m.tool, args: m.args });
    const req = http.request(
      {
        hostname: target.hostname,
        port: 8090,
        path: "/execute",
        method: "POST",
        headers: {
          authorization: "Bearer " + (process.env.RELAY_CONTROL_TOKEN ?? ""),
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body) > 100000) req.destroy();
        });
        res.on("end", () => {
          requests.delete(m.id);
          try {
            send({ kind: "agent-result", id: m.id, result: JSON.parse(body) });
          } catch {
            try {
              send({
                kind: "agent-result",
                id: m.id,
                result: {
                  ok: false,
                  uncertain: true,
                  error: "Controller result unavailable",
                },
              });
            } catch {}
          }
        });
      },
    );
    requests.set(m.id, req);
    req.setTimeout(35000, () => req.destroy());
    req.on("error", () => {
      requests.delete(m.id);
      try {
        send({
          kind: "agent-result",
          id: m.id,
          result: {
            ok: false,
            uncertain: true,
            error: "Container controller unavailable; action may be incomplete",
          },
        });
      } catch {}
    });
    req.end(data);
    return;
  }
  if (m.kind === "cancel") {
    close(m.id);
    return;
  }
  if (m.kind === "body") {
    const req = requests.get(m.id);
    if (req && typeof m.data === "string") {
      if (req.writableLength > 8388608) throw new Error();
      req.write(Buffer.from(m.data, "base64"));
    }
    return;
  }
  if (m.kind === "body-end") {
    requests.get(m.id)?.end();
    return;
  }
  if (m.kind === "ws-data") {
    const item = sockets.get(m.id);
    if (!item || typeof m.data !== "string") return;
    const data = Buffer.from(m.data, "base64");
    if (item.ws.readyState === WebSocket.OPEN) {
      if (item.ws.bufferedAmount > 8388608) throw new Error();
      item.ws.send(data, { binary: Boolean(m.binary), fin: m.final !== false });
    } else {
      if (item.queue.reduce((s, x) => s + x.data.length, 0) > 1048576)
        throw new Error();
      item.queue.push({
        data,
        binary: Boolean(m.binary),
        fin: m.final !== false,
      });
    }
    return;
  }
  if (
    !["http", "ws-open"].includes(m.kind) ||
    typeof m.path !== "string" ||
    !m.path.startsWith("/") ||
    m.path.startsWith("//") ||
    m.path.length > 16000 ||
    /[\r\n]/.test(m.path)
  )
    throw new Error();
  await authenticate();
  if (m.kind === "http") {
    if (requests.size > 64) throw new Error();
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: m.path,
        method: m.method,
        headers: authHeaders(m.headers ?? {}),
      },
      (res) => {
        try {
          send({
            kind: "head",
            id: m.id,
            status: res.statusCode,
            headers: res.headers,
          });
        } catch {
          req.destroy();
        }
        res.on("data", (data) => {
          try {
            const b = Buffer.from(data);
            for (let i = 0; i < b.length; i += 65536)
              send({
                kind: "data",
                id: m.id,
                data: b.subarray(i, i + 65536).toString("base64"),
              });
          } catch {
            req.destroy();
          }
        });
        res.on("end", () => {
          requests.delete(m.id);
          try {
            send({ kind: "end", id: m.id });
          } catch {}
        });
      },
    );
    requests.set(m.id, req);
    req.setTimeout(115000, () => req.destroy());
    req.on("error", () => {
      requests.delete(m.id);
      try {
        send({ kind: "error", id: m.id });
      } catch {}
    });
  } else {
    if (sockets.size >= 32) throw new Error();
    const url = `ws://${target.host}${m.path}`;
    const headers = authHeaders(m.headers ?? {});
    delete headers.origin;
    const ws = new WebSocket(url, m.protocol ? [m.protocol] : [], {
      headers,
      origin: m.headers?.origin,
      maxPayload: 16777216,
      perMessageDeflate: false,
      handshakeTimeout: 15000,
    });
    const item = {
      ws,
      queue: [] as { data: Buffer; binary: boolean; fin: boolean }[],
    };
    sockets.set(m.id, item);
    ws.on("open", () => {
      for (const msg of item.queue)
        ws.send(msg.data, { binary: msg.binary, fin: msg.fin });
      item.queue = [];
    });
    let out = Promise.resolve();
    ws.on("message", (data, binary) => {
      const body = Buffer.from(data as Buffer);
      out = out
        .then(async () => {
          for (let i = 0; i < Math.max(1, body.length); i += 65536)
            await sendAsync({
              kind: "ws-data",
              id: m.id,
              data: body.subarray(i, i + 65536).toString("base64"),
              binary,
              final: i + 65536 >= body.length,
            });
        })
        .catch(() => ws.close());
    });
    ws.on("close", () => {
      sockets.delete(m.id);
      try {
        send({ kind: "ws-close", id: m.id });
      } catch {}
    });
    ws.on("error", () => {
      try {
        send({ kind: "error", id: m.id });
      } catch {}
    });
  }
}
process.on("SIGTERM", () => {
  stopping = true;
  current?.close();
});
process.on("SIGINT", () => {
  stopping = true;
  current?.close();
});
async function reportController() {
  try {
    const r = await fetch("http://" + target.hostname + ":8090/health", {
      headers: {
        authorization: "Bearer " + (process.env.RELAY_CONTROL_TOKEN ?? ""),
      },
      signal: AbortSignal.timeout(2000),
    });
    const value = await r.json();
    send({ kind: "controller-ready", version: r.ok ? value.version : 0 });
  } catch {
    try {
      send({ kind: "controller-ready", version: 0 });
    } catch {}
  }
}
const controllerTimer = setInterval(() => void reportController(), 8000);
controllerTimer.unref();
while (!stopping) {
  await new Promise<void>((resolve) => {
    current = new WebSocket(gateway, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-environment-id": id,
        "x-environment-generation": generation,
      },
      maxPayload: 262144,
      perMessageDeflate: false,
      handshakeTimeout: 15000,
    });
    current.on("open", () => void reportController());
    let chain = Promise.resolve();
    current.on("message", (raw) => {
      chain = chain
        .then(() => handle(JSON.parse(raw.toString())))
        .catch(() => {
          current?.close(1008, "Tunnel-Anfrage abgelehnt");
        });
    });
    current.on("error", () => {});
    current.on("close", () => {
      for (const key of requests.keys()) close(key);
      for (const key of sockets.keys()) close(key);
      resolve();
    });
  });
  if (!stopping) await new Promise((r) => setTimeout(r, 2000));
}
