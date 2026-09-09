export const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export function calendarWindow(anchor?: string, mode?: string) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(anchor || '') && Number.isFinite(Date.parse(anchor + 'T12:00:00Z'));
  const date = new Date((valid ? anchor : dateKey(new Date())) + 'T12:00:00Z');
  const view = mode === 'week' ? 'week' : 'month';
  const first = view === 'month' ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12)) : new Date(date);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const days = Array.from({length: view === 'month' ? 42 : 7}, (_, i) => {
    const day = new Date(first); day.setUTCDate(day.getUTCDate() + i); return day;
  });
  const end = new Date(first); end.setUTCDate(end.getUTCDate() + days.length);
  return {anchor: dateKey(date), date, view, days, start: dateKey(first), end: dateKey(end)};
}
