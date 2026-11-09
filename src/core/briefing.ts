export function localClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date),
    value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}
export function quietHour(hour: number, start: number, end: number) {
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}
