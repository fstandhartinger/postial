"use client";
import {statusLabel} from "@/lib/status-label";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { calendarWindow, dateKey } from "@/lib/calendar-window";
type Entry = {
  id: string;
  body: string;
  day: string;
  brandId: string;
  brand: string;
  color: string;
  status: string;
};
export function Calendar({
  entries,
  brand, anchor, view,
}: {
  entries: Entry[];
  brand?: string;
  anchor: string;
  view: string;
}) {
  const router = useRouter();
  const {date, days} = calendarWindow(anchor, view);
  function navigate(nextDate: string, nextView = view) {
    router.push('/app/calendar?' + new URLSearchParams({date: nextDate, view: nextView, ...(brand ? {brand} : {})}), {scroll: false});
  }
  function move(step: number) {
    const d = new Date(date);
    if (view === "month") {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + step);
    } else d.setUTCDate(d.getUTCDate() + 7 * step);
    navigate(dateKey(d));
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="secondary"
          aria-label="Previous period"
          onClick={() => move(-1)}
        >
          ←
        </Button>
        <h2 className="text-xl">
          {date.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h2>
        <Button
          variant="secondary"
          aria-label="Next period"
          onClick={() => move(1)}
        >
          →
        </Button>
        <Select
          aria-label="Calendar view"
          value={view}
          onChange={(e) => navigate(anchor, e.target.value)}
        >
          <option value="month">Month</option>
          <option value="week">Week</option>
        </Select>
        <Button
          variant="secondary"
          onClick={() => navigate(dateKey(new Date()))}
        >
          Today
        </Button>
      </div>
      <p className="text-sm text-gray-500">Dates use each brand’s timezone.</p>
      <div className="space-y-3 sm:hidden" data-testid="calendar-agenda">
        {days
          .filter(
            (d) =>
              dateKey(d) === dateKey(new Date()) ||
              entries.some(
                (e) => e.day === dateKey(d) && (!brand || e.brandId === brand),
              ),
          )
          .map((d) => {
            const key = dateKey(d);
            return (
              <section key={key} className="rounded border bg-white p-3">
                <h2 className="text-lg">
                  {d.toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  })}
                  {key === dateKey(new Date()) ? " · Today" : ""}
                </h2>
                {entries
                  .filter(
                    (e) => e.day === key && (!brand || e.brandId === brand),
                  )
                  .map((e) => (
                    <Link
                      key={e.id}
                      href={`/app/posts/${e.id}`}
                      className="mt-2 block rounded border-l-4 bg-gray-50 p-3"
                      style={{ borderColor: e.color }}
                    >
                      <strong>{e.brand}</strong>
                      <p className="break-words">{e.body}</p>
                      <span>{statusLabel(e.status)}</span>
                    </Link>
                  ))}
                {!entries.some(
                  (e) => e.day === key && (!brand || e.brandId === brand),
                ) && <p>No posts today.</p>}
              </section>
            );
          })}
      </div>
      <div
        className="hidden overflow-x-auto sm:block"
        data-testid="calendar-desktop"
      >
        <div className="grid min-w-[600px] grid-cols-7 gap-px bg-gray-200">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div className="bg-gray-50 p-2" key={d}>
              {d}
            </div>
          ))}
          {days.map((d) => {
            const key = dateKey(d);
            return (
              <div key={key} className="min-h-28 space-y-2 bg-white p-2">
                <Link
                  aria-label={`Create post on ${key}`}
                  className="inline-block rounded p-1 text-sm hover:bg-emerald-50"
                  href={`/app/posts/new?date=${key}${brand ? "&brand=" + brand : ""}`}
                >
                  {d.getUTCDate()}
                </Link>
                {entries
                  .filter(
                    (e) => e.day === key && (!brand || e.brandId === brand),
                  )
                  .map((e) => (
                    <Link
                      key={e.id}
                      href={`/app/posts/${e.id}`}
                      className="block rounded border-l-4 bg-gray-50 p-2 text-xs"
                      style={{ borderColor: e.color }}
                    >
                      <strong>{e.brand}</strong>
                      <p className="line-clamp-2">{e.body}</p>
                      <span>{statusLabel(e.status)}</span>
                    </Link>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      {!entries.length && (
        <Link
          className="block text-emerald-700 underline"
          href="/app/posts/new"
        >
          Schedule your first post
        </Link>
      )}
    </div>
  );
}
