import pg from "pg";
type Change = { scope: string; id: string; topic: string };
type Listener = {
  workspace: string;
  account: string;
  user: string;
  notify: (change: Change) => void;
};
// One direct LISTEN connection per app process, shared by all tabs and workspaces.
const listeners = new Set<Listener>();
const scopes = new Map<string, Set<Listener>>();
function keys(l: Listener) {
  return ["workspace:" + l.workspace, "account:" + l.account, "user:" + l.user];
}
let client: pg.Client | null = null;
let connecting = false;
let retry: ReturnType<typeof setTimeout> | undefined;
function broadcast(c: Change) {
  const group =
    c.scope === "global" ? listeners : scopes.get(c.scope + ":" + c.id);
  if (group) for (const l of group) l.notify(c);
}
async function connect() {
  if (client || connecting || !listeners.size) return;
  connecting = true;
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "kerncloud-events",
    connectionTimeoutMillis: 10000,
  });
  const lost = () => {
    if (client === c) client = null;
    void c.end().catch(() => {});
    if (listeners.size && !retry)
      retry = setTimeout(() => {
        retry = undefined;
        void connect();
      }, 1000);
  };
  c.on("error", lost);
  c.on("end", lost);
  c.on("notification", (m) => {
    try {
      const value = JSON.parse(m.payload ?? "");
      if (
        typeof value.scope === "string" &&
        typeof value.id === "string" &&
        typeof value.topic === "string"
      )
        broadcast(value);
    } catch {}
  });
  try {
    await c.connect();
    await c.query("LISTEN kc_changes");
    if (!listeners.size) {
      await c.end();
      return;
    }
    client = c;
    broadcast({ scope: "global", id: "*", topic: "reconnect" });
  } catch {
    lost();
  } finally {
    connecting = false;
  }
}
export function subscribeChanges(listener: Listener) {
  listeners.add(listener);
  for (const key of keys(listener)) {
    const group = scopes.get(key) ?? new Set<Listener>();
    group.add(listener);
    scopes.set(key, group);
  }
  void connect();
  return () => {
    listeners.delete(listener);
    for (const key of keys(listener)) {
      const group = scopes.get(key);
      group?.delete(listener);
      if (!group?.size) scopes.delete(key);
    }
    if (!listeners.size) {
      if (retry) clearTimeout(retry);
      retry = undefined;
      const old = client;
      client = null;
      void old?.end().catch(() => {});
    }
  };
}
export function changeHubStats() {
  return { subscribers: listeners.size, connected: !!client };
}
