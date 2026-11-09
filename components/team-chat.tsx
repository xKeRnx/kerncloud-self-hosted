"use client";
import { useLanguage } from "./language";
import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Send, Paperclip, Radio, X, MessageSquare } from "lucide-react";
import type { Snapshot, ChatMessage } from "@/src/core/types";
import { mentionedAgents } from "@/src/core/mentions";
import { FileUpload, AttachmentPicker, type Save } from "./materials-panel";
type Live = {
  chat: ChatMessage[];
  events: { id: number; agent_id: string; kind: string; content: string }[];
  deltas: {
    id: number;
    task_id: string;
    agent_id: string;
    call_id: string;
    content: string;
  }[];
  active: { id: string; agent_id: string; title: string }[];
};
export function TeamChat({ state, save }: { state: Snapshot; save: Save }) {
  const { ui, localeTag } = useLanguage();

  const [text, setText] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [targets, setTargets] = useState<string[]>(
      [
        state.agents.find((a) => a.role === "Koordination")?.id ??
          state.agents[0]?.id,
      ].filter(Boolean),
    ),
    [info, setInfo] = useState(false),
    [runId, setRunId] = useState(""),
    [picker, setPicker] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [live, setLive] = useState<Live | null>(null);
  const list = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    follow = useRef(true);
  useEffect(() => {
    const stream = new EventSource(
      `/api/live?workspaceId=${encodeURIComponent(state.workspace.id)}`,
    );
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (e) => {
      try {
        setLive(JSON.parse(e.data));
      } catch {}
    };
    return () => stream.close();
  }, [state.workspace.id]);
  const hasActiveModel = state.models.some((model) => model.active);
  const modelRequired = !info && !hasActiveModel;
  const messages = live?.chat ?? state.chat,
    active = live?.active ?? [];
  const partials = useMemo(() => {
    const map = new Map<string, { agent_id: string; content: string }>();
    for (const d of live?.deltas ?? []) {
      const p = map.get(d.call_id) ?? { agent_id: d.agent_id, content: "" };
      p.content += d.content;
      map.set(d.call_id, p);
    }
    return [...map.entries()];
  }, [live?.deltas]);
  useEffect(() => {
    if (follow.current)
      list.current?.scrollTo({
        top: list.current.scrollHeight,
        behavior: "smooth",
      });
  }, [messages, partials, active.length]);
  let addressed: string[] = [];
  try {
    addressed = mentionedAgents(text, state.agents);
  } catch {}
  const query = text
    .match(/@([\p{L}\p{N}_-]*)$/u)?.[1]
    ?.toLocaleLowerCase("de");
  const choices =
    query === undefined
      ? []
      : [
          ...state.agents.map((a) => ({
            id: a.id,
            tag: a.name.replace(/\s+/g, "_"),
            name: a.name,
            role: a.role,
          })),
          {
            id: "all",
            tag: "alle",
            name: ui("Alle Agenten"),
            role: ui("Ganzes Team"),
          },
        ].filter(
          (a) =>
            a.tag.toLocaleLowerCase("de").startsWith(query) &&
            a.tag.toLocaleLowerCase("de") !== query,
        );
  const mention = (tag: string) => {
    setText((t) => t.replace(/@[\p{L}\p{N}_-]*$/u, `@${tag} `));
    input.current?.focus();
  };
  const send = async () => {
    if (!text.trim() || busy || uploading || modelRequired) return;
    setBusy(true);
    setError("");
    try {
      await save(
        "chat",
        {
          message: text,
          agentIds: targets,
          attachmentIds: ids,
          informationOnly: info,
          ...(runId ? { runId } : {}),
        },
        "POST",
        info
          ? ui("Information hinterlegt.")
          : ui("Nachricht an dein Team gesendet."),
      );
      setText("");
      setIds([]);
      follow.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const drop = async (files: FileList) => {
    if (!files.length || uploading) return;
    setUploading(true);
    setError("");
    const f = new FormData();
    Array.from(files).forEach((x) => f.append("files", x));
    try {
      const r = await save("attachments/upload", f);
      setIds((old) => [...new Set([...old, ...r.ids])]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{ui("DIREKT MIT DEINEM TEAM ARBEITEN")}</div>
          <h1>{ui("Teamchat")}</h1>
          <p>
            {ui(
              "Agenten mit @Name ansprechen, Dateien teilen und Fortschritt live verfolgen.",
            )}
          </p>
        </div>
        <span className="subtle-chip">
          <span className={connected ? "live-dot" : "waiting-dot"} />
          {connected ? ui("Live verbunden") : ui("Verbindung wird aufgebaut …")}
        </span>
      </div>
      <div className="chat-layout">
        <section className="panel chat-panel">
          <div
            className="chat-messages"
            ref={list}
            onScroll={() => {
              const e = list.current;
              if (e)
                follow.current =
                  e.scrollHeight - e.scrollTop - e.clientHeight < 100;
            }}
          >
            {!messages.length && (
              <div className="empty">
                <MessageSquare size={30} />
                <h3>{ui(hasActiveModel ? "Dein Team ist bereit" : "Dein Team benötigt ein aktives KI-Modell")}</h3>
                <p>
                  {ui(
                    hasActiveModel
                      ? "Zum Beispiel: @Atlas prüfe das Briefing und verteile die Aufgaben."
                      : "Aktiviere ein Modell, um mit deinen Agenten zu arbeiten.",
                  )}
                  <br />
                  {ui("Dateien kannst du direkt unten anhängen.")}
                </p>
              </div>
            )}
            {messages.map((m) => (
              <article
                className={`chat-message ${m.agent_id ? "agent-message" : "user-message"}`}
                key={m.id}
              >
                <div className="chat-author">
                  <b>{m.author}</b>
                  <time>
                    {new Date(m.created_at).toLocaleTimeString(localeTag, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="chat-copy">{m.content}</div>
                {(
                  (m as ChatMessage & { attachment_ids?: string[] })
                    .attachment_ids ?? []
                ).map((id) => (
                  <span className="attachment-chip" key={id}>
                    <Paperclip size={12} />
                    {state.attachments.find((f) => f.id === id)?.name ??
                      ui("Anhang")}
                  </span>
                ))}
                {m.run_id && (
                  <a className="chat-result-link" href={`/tasks/${m.run_id}`}>
                    {ui("Auftrag & Ergebnisse ")}
                    {m.run_id.slice(0, 8)}
                  </a>
                )}
              </article>
            ))}
            {partials.map(([id, p]) => (
              <article
                key={id}
                className="chat-message agent-message live-answer"
              >
                <div className="chat-author">
                  <b>
                    {state.agents.find((a) => a.id === p.agent_id)?.name ??
                      "Agent"}
                  </b>
                  <span className="live-dot" />
                  {ui("schreibt …")}
                </div>
                <div className="chat-copy">
                  {p.content}
                  <span className="stream-cursor">▍</span>
                </div>
              </article>
            ))}
            {active.length > 0 && !partials.length && (
              <div className="chat-working">
                <Radio size={15} />
                {active
                  .map(
                    (t) => state.agents.find((a) => a.id === t.agent_id)?.name,
                  )
                  .join(", ")}{" "}
                {ui("arbeitet …")}
              </div>
            )}
          </div>
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void drop(e.dataTransfer.files);
            }}
          >
            {choices.length > 0 && (
              <div
                className="mention-menu"
                role="listbox"
                aria-label={ui("Agent erwähnen")}
              >
                {choices.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => mention(a.tag)}
                  >
                    <AtSign size={15} />
                    <b>{a.name}</b>
                    <small>{a.role}</small>
                  </button>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="team-message">
              {ui("Nachricht an dein Team")}
            </label>
            <textarea
              id="team-message"
              ref={input}
              rows={3}
              placeholder={ui(
                "@Atlas … oder schreibe deinem Team. Dateien hier ablegen.",
              )}
              value={text}
              maxLength={12000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (choices.length) mention(choices[0].tag);
                  else void send();
                }
              }}
            />
            {ids.length > 0 && (
              <div className="attachment-chips">
                {ids.map((id) => (
                  <span className="attachment-chip" key={id}>
                    <Paperclip size={13} />
                    {state.attachments.find((f) => f.id === id)?.name ??
                      ui("Datei hochgeladen")}
                    <button
                      type="button"
                      aria-label={ui("Anhang entfernen")}
                      onClick={() => setIds(ids.filter((i) => i !== id))}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {picker && (
              <AttachmentPicker
                files={state.attachments}
                ids={ids}
                onChange={setIds}
              />
            )}
            <div className="composer-tools">
              <FileUpload
                compact
                save={save}
                done={(more) =>
                  setIds((old) => [...new Set([...old, ...more])])
                }
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setPicker(!picker)}
              >
                {ui("Bibliothek")}
              </button>
              <button
                className="primary"
                disabled={busy || uploading || !text.trim() || modelRequired}
              >
                <Send size={16} />
                {busy ? ui("Wird gesendet …") : ui("Senden")}
              </button>
            </div>
            <small className="muted">
              {uploading
                ? ui("Dateien werden hochgeladen …")
                : info
                  ? ui("Nur Information: kein neuer KI-Aufruf.")
                  : ui("Antwort von: {0}", [
                      (addressed.length ? addressed : targets)
                        .map(
                          (id) => state.agents.find((a) => a.id === id)?.name,
                        )
                        .filter(Boolean)
                        .join(", ") || "Bitte Agent auswählen",
                    ])}{" "}
              {ui("· Enter sendet, Umschalt+Enter neue Zeile")}
            </small>
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
          </form>
        </section>
        <aside className="chat-sidebar">
          <section className="panel settings-panel">
            <h3>{ui("Empfänger")}</h3>
            <p className="muted">
              {ui(
                "@Name im Text hat Vorrang vor der Auswahl. @alle spricht das ganze Team an.",
              )}
            </p>
            {state.agents.map((a) => (
              <label className="check-row" key={a.id}>
                <input
                  type="checkbox"
                  checked={targets.includes(a.id)}
                  onChange={(e) =>
                    setTargets(
                      e.target.checked
                        ? [...targets, a.id]
                        : targets.filter((id) => id !== a.id),
                    )
                  }
                />
                <b>{a.name}</b>
                <small>{a.role}</small>
              </label>
            ))}
            <label className="check-row">
              <input
                type="checkbox"
                checked={info}
                onChange={(e) => setInfo(e.target.checked)}
              />
              {ui("Nur Information hinterlegen")}
            </label>
            <label className="field">
              <span>{ui("Nachricht zuordnen")}</span>
              <select value={runId} onChange={(e) => setRunId(e.target.value)}>
                <option value="">{ui("Neues Gespräch / neue Aufgabe")}</option>
                {state.runs
                  .filter((r) =>
                    ["running", "paused", "input_required"].includes(r.status),
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.goal.slice(0, 70)}
                    </option>
                  ))}
              </select>
              <small>
                {ui(
                  "Im gewählten Auftrag kannst du Rückfragen beantworten oder Informationen nachreichen. Laufende Agenten sehen Hinweise beim nächsten Schritt.",
                )}
              </small>
            </label>
          </section>
          <section className="panel settings-panel">
            <h3>{ui("Live-Aktivität")}</h3>
            <div className="chat-events">
              {(live?.events ?? state.events).slice(0, 12).map((e) => (
                <article key={e.id}>
                  <small>
                    {state.agents.find((a) => a.id === e.agent_id)?.name ??
                      "Workspace"}{" "}
                    · {e.kind}
                  </small>
                  <p>{e.content.slice(0, 220)}</p>
                </article>
              ))}
              {!state.events.length && (
                <p className="muted">
                  {ui(
                    "Hier erscheinen Arbeitsbeginn, Delegationen, Werkzeuge und Rückfragen.",
                  )}
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
