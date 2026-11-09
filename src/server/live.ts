import { pool } from "./db.ts";
import { subscribeChanges } from "./change-hub.ts";
import type { Message } from "../core/types.ts";
import { ModelResponseError } from "../core/model-result.ts";
// Parse an OpenAI-compatible SSE response; ordinary JSON remains supported for providers without streaming.
export async function readModelResponse(
  response: Response,
  onText: (text: string) => Promise<void>,
) {
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    content = "",
    usage: unknown,
    bytes = 0,
    finishReason: string | null = null,
    ended = false;
  const tools: Record<
    number,
    { id: string; type: string; function: { name: string; arguments: string } }
  > = {};
  function consume(line: string) {
    if (!line.startsWith("data:")) return "";
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      ended = true;
      return "";
    }
    if (!data) return "";
    const json = JSON.parse(data);
    if (json.error)
      throw new ModelResponseError(
        "Der KI-Anbieter hat im Antwortstream einen Fehler gemeldet.",
      );
    if (json.usage) usage = json.usage;
    if (typeof json.choices?.[0]?.finish_reason === "string")
      finishReason = json.choices[0].finish_reason;
    const delta = json.choices?.[0]?.delta;
    if (!delta) return "";
    if (typeof delta.content === "string") content += delta.content;
    for (const t of delta.tool_calls ?? []) {
      const old = tools[t.index] ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      old.id += t.id ?? "";
      old.function.name += t.function?.name ?? "";
      old.function.arguments += t.function?.arguments ?? "";
      tools[t.index] = old;
    }
    return delta.content ?? "";
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2000000) throw new ModelResponseError("KI-Antwort zu groß.");
      pending += decoder.decode(value, { stream: true });
      let index;
      let emitted = "";
      while ((index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, "");
        pending = pending.slice(index + 1);
        emitted += consume(line);
      }
      if (emitted) await onText(emitted);
    }
    if (pending.trim()) {
      const text = consume(pending.trim());
      if (text) await onText(text);
    }
  } finally {
    reader.releaseLock();
  }
  if (!ended && !finishReason)
    throw new ModelResponseError(
      "KI-Antwortstream wurde ohne Abschluss unterbrochen. Bereits erhaltene Teilausgabe ist kein fertiges Ergebnis.",
    );
  return {
    choices: [
      {
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content: content || null,
          ...(Object.keys(tools).length
            ? { tool_calls: Object.values(tools) }
            : {}),
        },
      },
    ],
    usage,
  };
}

type LiveGroup = {
  subscribers: Set<(value: string) => void>;
  unsubscribe: () => void;
  timer?: ReturnType<typeof setTimeout>;
  latest: string;
  running: boolean;
  dirty: boolean;
};
const liveGroups = new Map<string, LiveGroup>();
function joinLive(
  workspaceId: string,
  account: string,
  user: string,
  send: (value: string) => void,
  projectId?: string,
) {
  const groupKey = workspaceId + ":" + (projectId ?? "all");
  let group = liveGroups.get(groupKey);
  if (!group) {
    group = {
      subscribers: new Set(),
      unsubscribe: () => {},
      latest: "",
      running: false,
      dirty: false,
    };
    liveGroups.set(groupKey, group);
    const g = group;
    const update = async () => {
      if (g.running) {
        g.dirty = true;
        return;
      }
      g.running = true;
      try {
        const [chat, events, deltas, active] = await Promise.all([
          pool.query(
            "SELECT * FROM(SELECT * FROM chat_messages WHERE workspace_id=$1 AND ($2::text IS NULL OR project_id=$2) ORDER BY id DESC LIMIT 100) m ORDER BY id",
            [workspaceId, projectId ?? null],
          ),
          pool.query(
            "SELECT id,run_id,agent_id,kind,content,created_at FROM events WHERE workspace_id=$1 AND ($2::text IS NULL OR run_id IN(SELECT id FROM runs WHERE project_id=$2) OR (run_id IS NULL AND $2=kc_default_project($1))) ORDER BY id DESC LIMIT 30",
            [workspaceId, projectId ?? null],
          ),
          pool.query(
            "SELECT min(d.id) AS id,d.task_id,d.agent_id,d.call_id,string_agg(d.content,'' ORDER BY d.id) AS content FROM model_deltas d JOIN tasks t ON t.id=d.task_id JOIN model_calls m ON m.id=d.call_id WHERE d.workspace_id=$1 AND ($2::text IS NULL OR t.run_id IN(SELECT id FROM runs WHERE project_id=$2)) AND t.status='running' AND m.status='reserved' AND d.created_at>now()-interval '5 minutes' GROUP BY d.task_id,d.agent_id,d.call_id ORDER BY min(d.id) DESC LIMIT 20",
            [workspaceId, projectId ?? null],
          ),
          pool.query(
            "SELECT id,agent_id,title FROM tasks WHERE workspace_id=$1 AND ($2::text IS NULL OR run_id IN(SELECT id FROM runs WHERE project_id=$2)) AND status='running'",
            [workspaceId, projectId ?? null],
          ),
        ]);

        const value = JSON.stringify({
          chat: chat.rows,
          events: events.rows,
          deltas: deltas.rows.reverse(),
          active: active.rows,
        });
        if (value !== g.latest) {
          g.latest = value;
          for (const listener of g.subscribers) listener(value);
        }
      } catch {
      } finally {
        g.running = false;
        if (g.dirty) {
          g.dirty = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      if (!g.timer)
        g.timer = setTimeout(() => {
          g.timer = undefined;
          void update();
        }, 100);
    };
    g.unsubscribe = subscribeChanges({
      workspace: workspaceId,
      account,
      user,
      notify: () => schedule(),
    });
    schedule();
  }
  group.subscribers.add(send);
  if (group.latest) send(group.latest);
  return () => {
    group!.subscribers.delete(send);
    if (!group!.subscribers.size) {
      group!.unsubscribe();
      if (group!.timer) clearTimeout(group!.timer);
      liveGroups.delete(groupKey);
    }
  };
}
export function liveStream(
  workspaceId: string,
  signal: AbortSignal,
  account = "",
  user = "",
  validate: () => Promise<boolean> = async () => true,
  projectId?: string,
) {
  let cleanup = () => {};
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false,
        accessPending = false,
        epoch = 0,
        deferred: string | undefined;
      let leave = () => {},
        accessStop = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined,
        lifetime: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (closed) return;
        closed = true;
        leave();
        accessStop();
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {}
      };
      const emit = (value: string) => {
        if (closed) return;
        if (accessPending) {
          deferred = value;
          return;
        }
        try {
          if ((controller.desiredSize ?? 0) < -8) {
            stop();
            return;
          }
          controller.enqueue(encoder.encode("data: " + value + "\n\n"));
        } catch {
          stop();
        }
      };
      accessStop = subscribeChanges({
        workspace: workspaceId,
        account,
        user,
        notify: (c) => {
          if (
            ![
              "sessions",
              "users",
              "workspace_members",
              "account_security",
              "workspaces",
            ].includes(c.topic)
          )
            return;
          const version = ++epoch;
          accessPending = true;
          void validate()
            .then((ok) => {
              if (version !== epoch || closed) return;
              if (!ok) {
                stop();
                return;
              }
              accessPending = false;
              if (deferred) {
                const value = deferred;
                deferred = undefined;
                emit(value);
              }
            })
            .catch(stop);
        },
      });
      leave = joinLive(workspaceId, account, user, emit, projectId);
      let checking = false;
      heartbeat = setInterval(() => {
        if (checking) return;
        checking = true;
        void validate()
          .then((ok) => {
            if (!ok) {
              stop();
              return;
            }
            if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
          })
          .catch(stop)
          .finally(() => {
            checking = false;
          });
      }, 15000);
      lifetime = setTimeout(stop, 300000);
      cleanup = stop;
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
