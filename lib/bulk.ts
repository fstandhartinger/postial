import { countChannelText } from "./text-limits";
import { localDateTime } from "./timezone";
export const MAX_BULK_ROWS = 200;
export const CSV_HEADER = "date,time,text,channels,image_url,requires_approval";
export type BulkChannel = {
  id: string;
  brandId: string;
  displayName: string;
  provider: string;
  max: number;
};
export type BulkRow = {
  text: string;
  channelIds: string[];
  scheduledAt: string;
  imageUrl: string;
  requiresApproval: boolean;
  importErrors?: string[];
};
export function rowErrors(
  row: BulkRow,
  channels: BulkChannel[],
  timezone: string,
  draft = false,
) {
  const errors = [...(row.importErrors ?? [])];
  if (!row.text.trim()) errors.push("Write your post.");
  if (row.text.trim().length > 100000)
    errors.push("Text exceeds 100,000 characters.");
  if (!draft && !row.channelIds.length)
    errors.push("Select at least one channel.");
  for (const id of row.channelIds) {
    const c = channels.find((c) => c.id === id);
    if (!c) errors.push("Unknown channel.");
    else if (c.max && countChannelText(row.text.trim(), c.provider) > c.max)
      errors.push(`${c.displayName} supports ${c.max} characters.`);
  }
  if (!draft) {
    try {
      if (+localDateTime(row.scheduledAt, timezone) <= Date.now())
        errors.push("Choose a future time.");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (row.imageUrl) {
    try {
      const u = new URL(row.imageUrl);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        /\s/.test(row.imageUrl)
      )
        throw Error();
    } catch {
      errors.push("Use one public HTTPS image URL.");
    }
  }
  return errors;
}
/** RFC-style quoting including escaped quotes, embedded newlines and CRLF. */
export function parseCsv(source: string): string[][] {
  if (new TextEncoder().encode(source).length > 512000)
    throw Error("CSV exceeds 512 KB.");
  source = source.replace(/^\uFEFF/, "");
  const first = source.split(/\r?\n/, 1)[0];
  const delimiter =
    (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_BULK_ROWS + 1) throw Error("Use at most 200 rows.");
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
    } else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      endRow();
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw Error("Invalid CSV quoting.");
      cell += ch;
    }
  }
  if (quoted) throw Error("Unclosed CSV quote.");
  if (cell || row.length || closed) endRow();
  if (rows[0]?.map((c) => c.trim()).join(",") !== CSV_HEADER)
    throw Error(`Expected header: ${CSV_HEADER}`);
  return rows.slice(1);
}
export function importCsv(source: string, channels: BulkChannel[]): BulkRow[] {
  return parseCsv(source).map((cells) => {
    const [
      date = "",
      time = "",
      text = "",
      names = "",
      imageUrl = "",
      approval = "",
    ] = cells;
    const importErrors: string[] = [];
    const ids: string[] = [];
    if (cells.length !== 6) importErrors.push("Expected six columns.");
    for (const name of names
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const exact = channels.filter(
        (c) => c.displayName.toLowerCase() === name.toLowerCase(),
      );
      const matches = exact.length
        ? exact
        : channels.filter(
            (c) => c.provider.toLowerCase() === name.toLowerCase(),
          );
      if (!matches.length) importErrors.push(`Unknown channel: ${name}`);
      matches.forEach((c) => ids.push(c.id));
    }
    if (
      !["", "true", "false", "1", "0", "yes", "no"].includes(
        approval.trim().toLowerCase(),
      )
    )
      importErrors.push("requires_approval must be true or false.");
    return {
      text,
      channelIds: [...new Set(ids)],
      scheduledAt: `${date.trim()}T${time.trim()}`,
      imageUrl: imageUrl.trim(),
      requiresApproval: ["true", "1", "yes"].includes(
        approval.trim().toLowerCase(),
      ),
      importErrors,
    };
  });
}
/** Spread rows across the selected date range and ordered wall-clock slots. */
export function distribute(
  count: number,
  start: string,
  days: number,
  slots: string[],
  timezone: string,
): string[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 200 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !slots.length ||
    slots.some((s) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(s))
  )
    throw Error("Choose a start date, 1–366 days and HH:MM slots.");
  const times = [...new Set(slots)].sort(),
    capacity = days * times.length;
  if (count > capacity)
    throw Error("Add more days or time slots for these rows.");
  const base = new Date(start + "T00:00:00Z");
  if (!Number.isFinite(+base) || base.toISOString().slice(0, 10) !== start)
    throw Error("Choose a valid start date.");
  return Array.from({ length: count }, (_, i) => {
    const index =
      count === 1 ? 0 : Math.round((i * (capacity - 1)) / (count - 1));
    const date = new Date(+base + Math.floor(index / times.length) * 86400000)
      .toISOString()
      .slice(0, 10);
    const value = date + "T" + times[index % times.length];
    localDateTime(value, timezone);
    return value;
  });
}
