"use client";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Minus,
  Plus,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Focus,
  X,
} from "lucide-react";
import { useLanguage } from "./language";
import {
  assignLanes,
  boundWindow,
  clipInterval,
  panWindow,
  zoomWindow,
  type TimeWindow,
} from "../src/core/timeline";
export type TimelineItem = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  status: string;
  statusLabel: string;
  start: number;
  end: number;
  href?: string;
  linkLabel?: string;
  details?: { label: string; value: string }[];
};
type Props = {
  items: TimelineItem[];
  agents: { id: string; name: string }[];
  domain: TimeWindow;
  initial: TimeWindow;
  label: string;
  history?: boolean;
};
export function InteractiveTimeline({
  items,
  agents,
  domain,
  initial,
  label,
  history = false,
}: Props) {
  const { t, localeTag } = useLanguage(),
    id = useId();
  const [window, setWindow] = useState<TimeWindow>(initial),
    [active, setActive] = useState<{
      item: TimelineItem;
      left: number;
      top: number;
    } | null>(null),
    [pinned, setPinned] = useState(false),
    [dragging, setDragging] = useState(false);
  const pinnedRef = useRef(false);
  const pin = (value: boolean) => {
    pinnedRef.current = value;
    setPinned(value);
  };
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    drag = useRef<{ x: number; width: number; window: TimeWindow } | null>(
      null,
    );
  const span = window.end - window.start,
    domainSpan = domain.end - domain.start;
  const previousDomain = useRef(domain);
  useEffect(() => {
    const previous = previousDomain.current;
    previousDomain.current = domain;
    setWindow((current) => {
      const size = current.end - current.start;
      return history && Math.abs(current.end - previous.end) < 1000
        ? boundWindow(domain.end - size / 2, size, domain)
        : boundWindow((current.start + current.end) / 2, size, domain);
    });
  }, [domain.start, domain.end, history]);
  useEffect(() => {
    setActive(null);
    pin(false);
  }, [window.start, window.end]);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(null);
        pin(false);
      }
    };
    const outside = (e: globalThis.PointerEvent) => {
      if (
        (e.target as Element)
          ?.closest("[data-timeline-owner]")
          ?.getAttribute("data-timeline-owner") !== id
      ) {
        setActive(null);
        pin(false);
      }
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [Boolean(active)]);
  const visible = useMemo(
    () => items.filter((i) => clipInterval(i.start, i.end, window)),
    [items, window.start, window.end],
  );
  const rows = useMemo(
    () =>
      agents.map((agent) => ({
        agent,
        bars: assignLanes(
          visible.filter((i) => i.agentId === agent.id),
          span * 0.008,
        ),
      })),
    [visible, agents, span],
  );
  const date = (value: number) =>
    new Intl.DateTimeFormat(localeTag, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
  const tick = (value: number) =>
    new Intl.DateTimeFormat(
      localeTag,
      span <= 86400000
        ? { hour: "2-digit", minute: "2-digit" }
        : {
            day: "2-digit",
            month: "short",
            ...(span <= 3 * 86400000 ? { hour: "2-digit" } : {}),
          },
    ).format(value);
  const duration = (ms: number) =>
    ms < 60000
      ? Math.max(0, Math.round(ms / 1000)) + " " + t("Sek.", "sec")
      : ms < 3600000
        ? Math.round(ms / 60000) + " min"
        : (ms / (ms >= 86400000 ? 86400000 : 3600000)).toLocaleString(
            localeTag,
            { maximumFractionDigits: 1 },
          ) +
          (ms >= 86400000
            ? " " + (ms < 1.05 * 86400000 ? t("Tag", "day") : t("Tage", "days"))
            : " h");
  const fit = () => {
    if (!items.length) return;
    const start = Math.min(...items.map((i) => i.start)),
      end = Math.max(...items.map((i) => i.end)),
      size = Math.max(300000, (end - start) * 1.15);
    setWindow(boundWindow((start + end) / 2, size, domain));
  };
  const show = (item: TimelineItem, element: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const r = element.getBoundingClientRect(),
      width = Math.min(352, globalThis.innerWidth - 24);
    setActive({
      item,
      left: Math.max(12, Math.min(globalThis.innerWidth - width - 12, r.left)),
      top: Math.max(12, Math.min(globalThis.innerHeight - 320, r.bottom + 10)),
    });
  };
  const leave = () => {
    if (!pinnedRef.current)
      closeTimer.current = setTimeout(() => {
        if (!pinnedRef.current) setActive(null);
      }, 160);
  };
  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (
      e.button !== 0 ||
      (e.target as Element).closest("button,a,input,select")
    )
      return;
    const track = e.currentTarget.querySelector<HTMLElement>(".timeline-plot");
    if (!track) return;
    drag.current = {
      x: e.clientX,
      width: track.getBoundingClientRect().width,
      window,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      const v = drag.current;
      setWindow(
        panWindow(
          v.window,
          (-(e.clientX - v.x) / v.width) * (v.window.end - v.window.start),
          domain,
        ),
      );
    }
  };
  const stopDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const atStart = window.start <= domain.start + 1,
    atEnd = window.end >= domain.end - 1;
  const selectionOffset = domainSpan - span;
  return (
    <div
      className="interactive-timeline"
      data-timeline-owner={id}
      aria-label={label}
    >
      <div className="timeline-toolbar">
        <div
          className="timeline-buttons"
          role="group"
          aria-label={t("Zoom und Navigation", "Zoom and navigation")}
        >
          <button
            type="button"
            className="secondary compact"
            aria-label={t(
              "Zeitfenster nach links verschieben",
              "Move time window left",
            )}
            disabled={atStart}
            onClick={() => setWindow(panWindow(window, -span / 2, domain))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="secondary compact"
            aria-label={t("Herauszoomen", "Zoom out")}
            disabled={span >= domainSpan - 1}
            onClick={() => setWindow(zoomWindow(window, 2, domain))}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="secondary compact"
            aria-label={t("Hineinzoomen", "Zoom in")}
            disabled={span <= 60000}
            onClick={() => setWindow(zoomWindow(window, 0.5, domain))}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="secondary compact"
            aria-label={t(
              "Zeitfenster nach rechts verschieben",
              "Move time window right",
            )}
            disabled={atEnd}
            onClick={() => setWindow(panWindow(window, span / 2, domain))}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className="secondary compact"
            onClick={fit}
            disabled={!items.length}
          >
            <Focus size={15} />
            {t("Auf Arbeit zoomen", "Fit work")}
          </button>
          <button
            type="button"
            className="secondary compact"
            aria-label={t("Ansicht zurücksetzen", "Reset view")}
            onClick={() => setWindow(initial)}
          >
            <RotateCcw size={15} />
          </button>
        </div>
        {history && (
          <label className="timeline-period-label">
            <span>{t("Zeitraum", "Time range")}</span>
            <select
              aria-label={t("Zeitraum der Ausführung", "Execution time range")}
              value={
                atEnd &&
                [3600000, 86400000, 7 * 86400000, 30 * 86400000].some(
                  (v) => Math.abs(v - span) < 1000,
                )
                  ? String(Math.round(span / 1000) * 1000)
                  : ""
              }
              onChange={(e) => {
                const size = Number(e.target.value);
                if (size)
                  setWindow(boundWindow(domain.end - size / 2, size, domain));
              }}
            >
              <option value="" disabled>
                {t("Eigener Ausschnitt", "Custom view")}
              </option>
              {[
                [3600000, t("1 Stunde", "1 hour")],
                [86400000, t("24 Stunden", "24 hours")],
                [7 * 86400000, t("7 Tage", "7 days")],
                [30 * 86400000, t("30 Tage", "30 days")],
              ].map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="timeline-range">
        <strong aria-live="polite">
          {date(window.start)} → {date(window.end)}
        </strong>
        <span>
          {duration(span)} · {visible.length}/{items.length}{" "}
          {t("Schritte im Ausschnitt", "steps in view")}
        </span>
      </div>
      <div
        className={"timeline-canvas" + (dragging ? " dragging" : "")}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="timeline-axis">
          <span>{t("Agent", "Agent")}</span>
          <div>
            {Array.from({ length: 5 }, (_, index) => (
              <time
                key={index}
                style={{ left: index * 25 + "%" }}
                dateTime={new Date(
                  window.start + (span * index) / 4,
                ).toISOString()}
              >
                {tick(window.start + (span * index) / 4)}
              </time>
            ))}
          </div>
        </div>
        {rows.map(({ agent, bars }) => (
          <div className="timeline-agent-row" key={agent.id}>
            <strong title={agent.name}>{agent.name}</strong>
            <div
              className="timeline-plot"
              style={{
                height: Math.max(
                  40,
                  12 + (Math.max(0, ...bars.map((b) => b.lane)) + 1) * 27,
                ),
              }}
            >
              {bars.map((item) => {
                const geometry = clipInterval(item.start, item.end, window)!;
                return (
                  <button
                    type="button"
                    data-timeline-bar
                    key={item.id}
                    className={
                      "work-timeline-bar " +
                      item.status +
                      (active?.item.id === item.id ? " is-active" : "")
                    }
                    style={{
                      left: geometry.left + "%",
                      width: "max(8px, " + geometry.width + "%)",
                      top: 8 + item.lane * 27,
                    }}
                    aria-label={
                      item.title +
                      " · " +
                      item.agentName +
                      " · " +
                      item.statusLabel
                    }
                    aria-describedby={
                      active?.item.id === item.id ? id : undefined
                    }
                    aria-expanded={active?.item.id === item.id && pinned}
                    onMouseEnter={(e) => {
                      if (!pinned) show(item, e.currentTarget);
                    }}
                    onMouseLeave={leave}
                    onFocus={(e) => {
                      if (active?.item.id !== item.id) pin(false);
                      show(item, e.currentTarget);
                    }}
                    onBlur={() => {
                      if (!pinnedRef.current) leave();
                    }}
                    onClick={(e) => {
                      if (pinned && active?.item.id === item.id) {
                        setActive(null);
                        pin(false);
                      } else {
                        show(item, e.currentTarget);
                        pin(true);
                      }
                    }}
                  >
                    <span>{item.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!visible.length && (
          <p className="timeline-empty">
            {t(
              "Keine aufgezeichnete Arbeit in diesem Ausschnitt. Nutze „Auf Arbeit zoomen“ oder wähle einen anderen Zeitraum.",
              "No recorded work in this window. Use “Fit work” or choose another time range.",
            )}
          </p>
        )}
      </div>
      <label className="timeline-pan">
        <span>{t("Zeitfenster verschieben", "Move time window")}</span>
        <input
          type="range"
          aria-label={t("Zeitfenster verschieben", "Move time window")}
          min={0}
          max={1000}
          value={
            selectionOffset > 0
              ? Math.round(
                  ((window.start - domain.start) / selectionOffset) * 1000,
                )
              : 0
          }
          disabled={selectionOffset <= 1}
          onChange={(e) =>
            setWindow(
              boundWindow(
                domain.start +
                  (Number(e.target.value) / 1000) *
                    Math.max(0, selectionOffset) +
                  span / 2,
                span,
                domain,
              ),
            )
          }
        />
      </label>
      <small>
        {t(
          "Mit +/− zoomen, freie Fläche ziehen oder den Regler verschieben. Balken zeigen Details direkt beim Überfahren oder Tastaturfokus; anklicken hält sie geöffnet.",
          "Zoom with +/−, drag an empty area or move the slider. Hover or focus a bar for details; click to keep them open.",
        )}
        {history
          ? " " +
            t(
              "Angezeigt werden bis zu 300 Schritte aus den letzten 31 Tagen.",
              "Shows up to 300 steps from the last 31 days.",
            )
          : ""}
      </small>
      {active &&
        createPortal(
          <div
            id={id}
            data-timeline-popover
            data-timeline-owner={id}
            className="timeline-popover"
            role={pinned ? "dialog" : "tooltip"}
            aria-label={t("Details zum Arbeitsschritt", "Work step details")}
            style={{ left: active.left, top: active.top }}
            onMouseEnter={() => {
              if (closeTimer.current) clearTimeout(closeTimer.current);
            }}
            onMouseLeave={leave}
          >
            <div className="timeline-popover-heading">
              <span className={"timeline-status " + active.item.status}>
                {active.item.statusLabel}
              </span>
              {pinned && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Details schließen", "Close details")}
                  onClick={() => {
                    pin(false);
                    setActive(null);
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <strong>{active.item.title}</strong>
            <dl>
              {[
                { label: t("Agent", "Agent"), value: active.item.agentName },
                { label: t("Start", "Start"), value: date(active.item.start) },
                { label: t("Ende", "End"), value: date(active.item.end) },
                {
                  label: t("Dauer", "Duration"),
                  value: duration(active.item.end - active.item.start),
                },
                ...(active.item.details ?? []),
              ].map((d, index) => (
                <div key={index}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
            {pinned && active.item.href && (
              <Link className="button secondary" href={active.item.href}>
                {active.item.linkLabel ?? t("Auftrag öffnen", "Open task")}
              </Link>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
