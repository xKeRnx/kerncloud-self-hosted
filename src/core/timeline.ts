export type TimeWindow = { start: number; end: number };
export function boundWindow(
  center: number,
  span: number,
  domain: TimeWindow,
): TimeWindow {
  const max = Math.max(1, domain.end - domain.start),
    size = Math.max(Math.min(60000, max), Math.min(max, span));
  const start = Math.max(
    domain.start,
    Math.min(domain.end - size, center - size / 2),
  );
  return { start, end: start + size };
}
export function zoomWindow(
  window: TimeWindow,
  factor: number,
  domain: TimeWindow,
) {
  return boundWindow(
    (window.start + window.end) / 2,
    (window.end - window.start) * factor,
    domain,
  );
}
export function panWindow(
  window: TimeWindow,
  delta: number,
  domain: TimeWindow,
) {
  return boundWindow(
    (window.start + window.end) / 2 + delta,
    window.end - window.start,
    domain,
  );
}
export function clipInterval(start: number, end: number, window: TimeWindow) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    (end > start && end <= window.start) ||
    end < window.start ||
    start >= window.end
  )
    return null;
  const left = Math.max(start, window.start),
    right = Math.min(end, window.end),
    span = window.end - window.start;
  return {
    left: (100 * (left - window.start)) / span,
    width: (100 * Math.max(0, right - left)) / span,
  };
}
export function assignLanes<T extends { start: number; end: number }>(
  items: T[],
  minimumDuration = 0,
) {
  const ends: number[] = [];
  return [...items]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item) => {
      let lane = ends.findIndex((end) => end <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = Math.max(item.end, item.start + minimumDuration);
      return { ...item, lane };
    });
}
