/** Resolve a wall-clock minute in an IANA zone; reject DST gaps and ambiguous folds. */
export function localDateTime(value: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid date and time.");
  const base = Date.parse(value + "Z");
  if (!Number.isFinite(base)) throw new Error("Choose a valid date and time.");
  const matches: Date[] = [];
  // All current IANA UTC offsets are multiples of 15 minutes.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const d = new Date(base + offset * 60000);
    if (inZone(d, timeZone) === value) matches.push(d);
  }
  if (matches.length !== 1)
    throw new Error(
      "This time is skipped or occurs twice because of daylight saving. Choose another time.",
    );
  return matches[0];
}
export function inZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const p = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
