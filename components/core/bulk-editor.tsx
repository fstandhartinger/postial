"use client";
import { statusLabel } from "@/lib/status-label";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { saveBulkAction } from "@/app/app/posts/bulk/actions";
import {
  CSV_HEADER,
  distribute,
  importCsv,
  rowErrors,
  type BulkChannel,
  type BulkRow,
} from "@/lib/bulk";
import { countChannelText } from "@/lib/text-limits";
import type { BulkResult } from "@/lib/api/bulk";
type Brand = { id: string; name: string; timezone: string; readOnly?: boolean };
type Row = BulkRow & { key: string; result?: BulkResult; uploadError?: string };
export function BulkEditor({
  brands,
  channels,
  initialBrand,
  canPublish,
  approvalLinks,
}: {
  brands: Brand[];
  channels: BulkChannel[];
  initialBrand?: string;
  canPublish: boolean;
  approvalLinks: boolean;
}) {
  const [brandId, setBrandId] = useState(initialBrand ?? brands[0].id);
  const brand = brands.find((b) => b.id === brandId)!;
  const cs = channels.filter((c) => c.brandId === brandId);
  const newRow = (): Row => ({
    key: crypto.randomUUID(),
    text: "",
    channelIds: cs.map((c) => c.id),
    scheduledAt: "",
    imageUrl: "",
    requiresApproval: false,
  });
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [preview, setPreview] = useState<BulkRow[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  const [start, setStart] = useState(""),
    [days, setDays] = useState(7),
    [slots, setSlots] = useState("09:00,17:00");
  const patch = (key: string, change: Partial<Row>) =>
    setRows((old) => old.map((r) => (r.key === key ? { ...r, ...change } : r)));
  async function readCsv(file?: File) {
    if (!file) return;
    setMessage("");
    setPreview(null);
    try {
      if (file.size > 512000) throw Error("CSV exceeds 512 KB.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const imported = importCsv(text, cs);
      if (!imported.length) throw Error("CSV contains no posts.");
      setPreview(imported);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to read UTF-8 CSV.");
    }
  }
  async function upload(key: string, file?: File) {
    if (!file || lock.current) return;
    if (file.size > 5 * 1024 * 1024) {
      patch(key, { uploadError: "Each image must be at most 5 MB." });
      return;
    }
    lock.current = true;
    setBusy(true);
    patch(key, { uploadError: undefined });
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("brand_id", brandId);
      const response = await fetch("/api/media", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60000),
        }),
        result = await response.json();
      if (!response.ok) throw Error(result.error?.message ?? "Upload failed.");
      patch(key, { imageUrl: result.url });
    } catch (e) {
      patch(key, {
        uploadError: e instanceof Error ? e.message : "Upload failed.",
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(draft: boolean) {
    if (lock.current) return;
    const pending = rows.filter((r) => !r.result?.id);
    if (!pending.length) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const results = await saveBulkAction(
        brandId,
        pending.map(
          ({
            text,
            channelIds,
            scheduledAt,
            imageUrl,
            requiresApproval,
            importErrors,
          }) => ({
            text,
            channelIds,
            scheduledAt,
            imageUrl,
            requiresApproval,
            importErrors,
          }),
        ),
        draft,
      );
      results.forEach((r, i) => patch(pending[i].key, { result: r }));
      const good = results.filter((r) => r.id);
      setMessage(
        `${good.filter((r) => r.post_status === "scheduled").length} scheduled, ${good.filter((r) => r.post_status === "pending_approval").length} awaiting approval, ${good.filter((r) => r.post_status === "draft").length} drafts, ${results.length - good.length} failed.`,
      );
    } catch {
      setMessage("Unable to confirm the save. Check Posts before retrying.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const counts = rows.reduce<Record<string, number>>((out, r) => {
    if (r.scheduledAt) {
      const day = r.scheduledAt.slice(0, 10);
      out[day] = (out[day] ?? 0) + 1;
    }
    return out;
  }, {});
  return (
    <div className="min-w-0 space-y-6">
      <p>
        Build your week or import up to 200 posts. One image per post. Times use
        your brand’s timezone.
      </p>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <label className="block max-w-md">
          Brand
          <Select
            className="w-full"
            value={brandId}
            disabled={rows.some((r) => !!r.result?.id)}
            onChange={(e) => {
              const id = e.target.value;
              setBrandId(id);
              setPreview(null);
              setMessage("");
              setRows((old) =>
                old.map((r) => ({
                  ...r,
                  channelIds: channels
                    .filter((c) => c.brandId === id)
                    .map((c) => c.id),
                  result: undefined,
                })),
              );
            }}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.readOnly ? " (read-only)" : ""}
              </option>
            ))}
          </Select>
        </label>
        <p>
          Timezone: <strong>{brand.timezone}</strong>. Bulk planning is
          available on every plan. Client approval requires Agency.
        </p>
        <section
          className="space-y-3 rounded-xl border p-4"
          aria-label="CSV import"
        >
          <h2 className="font-semibold">CSV import</h2>
          <p className="text-sm">
            UTF-8, comma or semicolon separated, up to 512 KB. Channels: display
            names or providers separated by |. Dates: YYYY-MM-DD; times: HH:MM.
          </p>
          <a
            className="underline"
            download="postial-posts.csv"
            href={
              "data:text/csv;charset=utf-8," +
              encodeURIComponent(
                CSV_HEADER +
                  '\n2030-01-07,09:00,"Your first post",mastodon,,false\n',
              )
            }
          >
            Download CSV template
          </a>
          <label className="block">
            Choose CSV
            <input
              className="block max-w-full"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                void readCsv(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {preview && (
            <>
              <h3 className="font-semibold">
                CSV preview · {preview.length} posts
              </h3>
              <p>
                Review errors before adding rows. Public image DNS and workspace
                ownership are checked again when saving.
              </p>
              <div className="overflow-x-auto">
                <table className="bulk-table bulk-preview w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "Row",
                        "Text",
                        "Channels",
                        "Date / time",
                        "Image URL",
                        "Approval",
                        "Validation",
                      ].map((h) => (
                        <th className="whitespace-nowrap p-2" key={h}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => {
                      const errors = [
                        ...rowErrors(r, cs, brand.timezone),
                        ...(r.requiresApproval && !approvalLinks
                          ? ["Client approval requires Agency."]
                          : []),
                      ];
                      return (
                        <tr className="border-t" key={i}>
                          <td data-label="Row" className="p-2">{i + 1}</td>
                          <td data-label="Text" className="min-w-48 max-w-80 break-words p-2">
                            {r.text}
                          </td>
                          <td data-label="Channels" className="p-2">
                            {r.channelIds
                              .map(
                                (id) =>
                                  cs.find((c) => c.id === id)?.displayName,
                              )
                              .join(", ")}
                          </td>
                          <td data-label="Date / time" className="p-2">{r.scheduledAt}</td>
                          <td data-label="Image URL" className="max-w-48 break-all p-2">
                            {r.imageUrl || "—"}
                          </td>
                          <td data-label="Approval" className="p-2">
                            {r.requiresApproval ? "Yes" : "No"}
                          </td>
                          <td data-label="Validation"
                            className={
                              "min-w-48 p-2 " +
                              (errors.length
                                ? "text-red-700"
                                : "text-emerald-700")
                            }
                          >
                            {errors.join(" ") || "Ready"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button
                type="button"
                onClick={() => {
                  setRows(
                    preview.map((r) => ({ ...r, key: crypto.randomUUID() })),
                  );
                  setPreview(null);
                  setMessage("CSV loaded into editor. Review rows, then save.");
                }}
              >
                Use CSV rows in editor
              </Button>
              <p className="text-sm">
                Replaces the current editor rows. Nothing is saved yet.
              </p>
            </>
          )}
        </section>
        <section
          className="space-y-3 rounded-xl border p-4"
          aria-label="Auto-distribute"
        >
          <h2 className="font-semibold">Auto-distribute</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              Start date
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Days
              <Input
                type="number"
                min={1}
                max={366}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <label>
              Time slots (comma separated)
              <Input value={slots} onChange={(e) => setSlots(e.target.value)} />
            </label>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              try {
                const pending = rows.filter((r) => !r.result?.id),
                  dates = distribute(
                    pending.length,
                    start,
                    days,
                    slots.split(",").map((s) => s.trim()),
                    brand.timezone,
                  );
                pending.forEach((r, i) =>
                  patch(r.key, { scheduledAt: dates[i] }),
                );
                setMessage(
                  "Times distributed evenly across the selected range.",
                );
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Auto-distribute
          </Button>
          <p className="text-sm">
            Rows are spread evenly across the days and slots, without duplicate
            times. Daylight-saving gaps and repeated times are rejected.
          </p>
        </section>
        <p aria-label="Posts per day">
          Posts per day:{" "}
          {Object.entries(counts)
            .sort()
            .map(([d, n]) => `${d}: ${n}`)
            .join(" · ") || "Choose dates to see your daily totals."}
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="bulk-table w-full text-left" aria-label="Bulk posts editor">
            <thead>
              <tr>
                {[
                  "Post text",
                  "Channels",
                  "Schedule",
                  "Image",
                  "Approval / actions",
                ].map((h) => (
                  <th className="p-3" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr className="border-t align-top" key={r.key}>
                  <td className="min-w-64 p-3">
                    <fieldset disabled={!!r.result?.id || brand.readOnly}>
                      <label>
                        Post {i + 1}
                        <Textarea
                          className="min-h-32 w-full"
                          value={r.text}
                          onChange={(e) =>
                            patch(r.key, {
                              text: e.target.value,
                              result: undefined,
                            })
                          }
                        />
                      </label>
                      {cs
                        .filter((c) => r.channelIds.includes(c.id))
                        .map((c) => (
                          <p
                            className={
                              c.max &&
                              countChannelText(r.text.trim(), c.provider) >
                                c.max
                                ? "text-sm text-red-700"
                                : "text-sm text-zinc-600"
                            }
                            key={c.id}
                          >
                            {c.displayName}:{" "}
                            {countChannelText(r.text.trim(), c.provider)} /{" "}
                            {c.max || "unlimited"}
                          </p>
                        ))}
                    </fieldset>
                    {r.result?.id ? (
                      <Link
                        className="text-emerald-700 underline"
                        href={`/app/posts/${r.result.id}`}
                      >
                        {statusLabel(r.result.post_status || "draft")} — Open post
                      </Link>
                    ) : (
                      <div className="mt-2 text-sm text-red-700">
                        {r.result?.error?.message ||
                          rowErrors(r, cs, brand.timezone).join(" ")}
                      </div>
                    )}
                  </td>
                  <td className="min-w-44 p-3">
                    <fieldset disabled={!!r.result?.id || brand.readOnly}>
                      <legend className="md:sr-only">
                        Channels for post {i + 1}
                      </legend>
                      {cs.map((c) => (
                        <label key={c.id} className="block">
                          <input
                            type="checkbox"
                            checked={r.channelIds.includes(c.id)}
                            onChange={(e) =>
                              patch(r.key, {
                                channelIds: e.target.checked
                                  ? [...r.channelIds, c.id]
                                  : r.channelIds.filter((id) => id !== c.id),
                                importErrors: undefined,
                                result: undefined,
                              })
                            }
                          />{" "}
                          {c.displayName}
                        </label>
                      ))}
                      {!cs.length && (
                        <Link
                          className="underline"
                          href={`/app/brands/${brandId}`}
                        >
                          Connect channels
                        </Link>
                      )}
                    </fieldset>
                  </td>
                  <td className="min-w-60 p-3">
                    <label>
                      Date / time ({brand.timezone})
                      <Input
                        type="datetime-local"
                        disabled={!!r.result?.id || brand.readOnly}
                        value={r.scheduledAt}
                        onChange={(e) =>
                          patch(r.key, {
                            scheduledAt: e.target.value,
                            result: undefined,
                          })
                        }
                      />
                    </label>
                  </td>
                  <td className="min-w-56 p-3">
                    <fieldset disabled={!!r.result?.id || brand.readOnly}>
                      <label>
                        Image URL
                        <Input
                          type="url"
                          value={r.imageUrl}
                          onChange={(e) =>
                            patch(r.key, {
                              imageUrl: e.target.value,
                              result: undefined,
                            })
                          }
                        />
                      </label>
                      <label className="mt-2 block text-sm">
                        Upload one image (5 MB)
                        <input
                          className="block w-48"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          onChange={(e) => {
                            void upload(r.key, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {r.imageUrl && (
                        <button
                          className="underline"
                          type="button"
                          onClick={() => patch(r.key, { imageUrl: "" })}
                        >
                          Remove image
                        </button>
                      )}
                      {r.uploadError && <p role="alert">{r.uploadError}</p>}
                    </fieldset>
                  </td>
                  <td className="min-w-48 space-y-3 p-3">
                    <label className="block">
                      <input
                        type="checkbox"
                        checked={r.requiresApproval}
                        disabled={
                          !!r.result?.id ||
                          brand.readOnly ||
                          (!approvalLinks && !r.requiresApproval)
                        }
                        onChange={(e) =>
                          patch(r.key, {
                            requiresApproval: e.target.checked,
                            importErrors: undefined,
                            result: undefined,
                          })
                        }
                      />{" "}
                      Requires approval
                    </label>
                    <button
                      className="block underline"
                      type="button"
                      disabled={rows.length >= 200}
                      onClick={() =>
                        setRows((old) => [
                          ...old,
                          { ...r, key: crypto.randomUUID(), result: undefined },
                        ])
                      }
                    >
                      Duplicate row {i + 1}
                    </button>
                    <button
                      className="block underline"
                      type="button"
                      onClick={() =>
                        setRows((old) => old.filter((row) => row.key !== r.key))
                      }
                    >
                      Remove row {i + 1}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={rows.length >= 200}
          onClick={() => setRows((old) => [...old, newRow()])}
        >
          Add row
        </Button>
        <span className="ml-3">{rows.length} / 200 rows</span>
        {(!canPublish || brand.readOnly) && (
          <p>
            {brand.readOnly
              ? "This brand is read-only."
              : "Publishing requires an active plan or trial. Drafts remain available."}{" "}
            <Link href="/app/billing" className="underline">
              Review Billing
            </Link>
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={brand.readOnly || !rows.some((r) => !r.result?.id)}
            onClick={() => void save(true)}
          >
            Save as drafts
          </Button>
          <Button
            type="button"
            disabled={
              !canPublish || brand.readOnly || !rows.some((r) => !r.result?.id)
            }
            onClick={() => void save(false)}
          >
            Schedule posts
          </Button>
        </div>
      </fieldset>
      {busy && <p role="status">Working… Please keep this page open.</p>}
      {message && (
        <p role="status" className="rounded-xl border p-4">
          {message}
        </p>
      )}
    </div>
  );
}
