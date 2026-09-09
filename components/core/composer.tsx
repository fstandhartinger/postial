"use client";
import Link from "next/link";
import { countText, postText } from "@/lib/text-limits";
/* eslint-disable @next/next/no-img-element -- User-provided previews intentionally bypass the server image proxy. */
import { useActionState, useState } from "react";
import { coreAction } from "@/app/app/actions";
import { Input, Select, Textarea, Checkbox } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
type Brand = { id: string; name: string; timezone: string; readOnly?: boolean };
type Channel = {
  id: string;
  brandId: string;
  displayName: string;
  max: number;
};
export function Composer({
  brands,
  channels,
  initial,
  canPublish,
  approvalLinks,
}: {
  canPublish: boolean;
  approvalLinks: boolean;
  brands: Brand[];
  channels: Channel[];
  initial: {
    id?: string;
    brandId?: string;
    body?: string;
    mediaUrls?: string[];
    linkUrl?: string;
    scheduledAt?: string;
    requiresApproval?: boolean;
    channelIds?: string[];
  };
}) {
  const [state, submit, pending] = useActionState(coreAction, { error: "" });
  const [brand, setBrand] = useState(initial.brandId ?? brands[0]?.id ?? "");
  const [selected, setSelected] = useState(initial.channelIds ?? []);
  const [body, setBody] = useState(initial.body ?? "");
  const [media, setMedia] = useState(initial.mediaUrls?.join("\n") ?? "");
  const [link, setLink] = useState(initial.linkUrl ?? "");
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const readOnly = brands.find((b) => b.id === brand)?.readOnly;
  const count = countText(postText({ text: body, linkUrl: link }));
  const [when, setWhen] = useState("schedule");
  const limits = channels
    .filter((c) => selected.includes(c.id) && c.brandId === brand && c.max > 0)
    .map((c) => c.max);
  const max = limits.length ? Math.min(...limits) : 0;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <form
        action={submit}
        className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6"
      >
        <input type="hidden" name="action" value="post" />
        <input type="hidden" name="postId" value={initial.id ?? ""} />
        <label className="block">
          Brand
          <Select
            name="brandId"
            className="block w-full rounded border p-3"
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              setSelected([]);
            }}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          Post text
          <Textarea
            className="block min-h-40 w-full rounded-xl border p-4"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
          />
        </label>
        <p className={max && count > max ? "text-red-700" : "text-gray-500"}>
          {count}
          {max ? ` / ${max}` : " characters"}
        </p>
        <fieldset className="space-y-2">
          <legend>Channels</legend>
          {channels
            .filter((c) => c.brandId === brand)
            .map((c) => (
              <label className="block" key={c.id}>
                <Checkbox
                  name="channelId"
                  value={c.id}
                  checked={selected.includes(c.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, c.id]
                        : selected.filter((id) => id !== c.id),
                    )
                  }
                />{" "}
                {c.displayName}
              </label>
            ))}
          {!channels.some((c) => c.brandId === brand) && (
            <Link
              className="text-emerald-700 underline"
              href={`/app/brands/${brand}`}
            >
              Connect a channel
            </Link>
          )}
        </fieldset>
        <label className="block">
          Media URLs (up to four HTTPS images)
          <Textarea
            className="block w-full rounded border p-3"
            name="mediaUrls"
            value={media}
            onChange={(e) => setMedia(e.target.value)}
            placeholder="One URL per line"
          />
        </label>
        <label className="block">
          Link
          <Input
            name="linkUrl"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
        <label className="block">
          Publishing
          <Select
            name="when"
            className="block rounded border p-3"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          >
            <option value="schedule">Schedule</option>
            <option value="now">Publish now</option>
          </Select>
        </label>
        {when === "schedule" && (
          <label className="block">
            Date and time ({brands.find((b) => b.id === brand)?.timezone})
            <Input
              name="scheduledAt"
              type="datetime-local"
              defaultValue={initial.scheduledAt}
            />
          </label>
        )}
        <p className="text-sm text-zinc-600">
          Times use {brands.find((b) => b.id === brand)?.timezone}, your brand’s
          timezone.
        </p>
        <label className="block">
          <Checkbox
            name="requiresApproval"
            defaultChecked={approvalLinks && initial.requiresApproval}
            disabled={!approvalLinks}
          />{" "}
          Requires client approval
        </label>
        {!approvalLinks && <p>Included with Agency — <Link href="/app/billing" className="underline">upgrade</Link></p>}
        <p className="text-sm text-gray-500">
          Posts requiring approval stay on hold. Open the saved post to copy its
          client approval link.
        </p>
        {state.error && (
          <p role="alert" className="text-red-700">
            {state.error}
          </p>
        )}
        {(!canPublish || readOnly) && (
          <p>
            {readOnly
              ? "This brand is read-only under your plan."
              : "Publishing requires an active plan or trial. Drafts remain available."}{" "}
            <Link href="/app/billing" className="underline">
              Review Billing
            </Link>
          </p>
        )}
        {!channels.some(c => c.brandId === brand && selected.includes(c.id)) && <p>Connect a channel to publish · <Link href={`/app/brands/${brand}#connect`} className="underline">Connect a channel</Link></p>}
        <div className="flex gap-3">
          <Button
            variant="secondary"
            name="intent"
            value="draft"
            disabled={pending || readOnly}
          >
            Save draft
          </Button>
          <Button
            name="intent"
            value="schedule"
            disabled={pending || !canPublish || readOnly || !channels.some(c => c.brandId === brand && selected.includes(c.id))}
          >
            {pending ? "Saving…" : when === "now" ? "Publish now" : "Schedule"}
          </Button>
        </div>
      </form>
      <aside
        className="space-y-4 lg:sticky lg:top-6"
        aria-label="Live post preview"
      >
        <div>
          <h2>Live preview</h2>
          <p className="text-sm text-zinc-600">
            A general preview. Each channel may display your post differently.
          </p>
        </div>
        <Card className="space-y-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-800"
            >
              {brands
                .find((b) => b.id === brand)
                ?.name.slice(0, 2)
                .toUpperCase()}
            </span>
            <div>
              <p className="font-semibold">
                {brands.find((b) => b.id === brand)?.name}
              </p>
              <p className="text-sm text-zinc-600">Post preview</p>
            </div>
          </div>
          <p className="min-h-24 whitespace-pre-wrap break-words">
            {body ||
              "Your story starts here. Write something your audience will love."}
          </p>
          {link && <p className="break-all text-sm text-emerald-700">{link}</p>}
          <div className="grid grid-cols-2 gap-2">
            {media
              .split(/\s+/)
              .filter((u) => u.startsWith("https://"))
              .slice(0, 4)
              .map((u, i) => (
                <img
                  key={u}
                  src={u}
                  alt={`Media preview ${i + 1}`}
                  referrerPolicy="no-referrer"
                  className="aspect-square w-full rounded-lg object-cover"
                  onError={() =>
                    setFailedImages((old) =>
                      old.includes(u) ? old : [...old, u],
                    )
                  }
                />
              ))}
          </div>
          {failedImages.some((u) => media.includes(u)) && (
            <p role="alert">
              An image could not load. Check its public HTTPS URL and image
              format.
            </p>
          )}
          <div className="border-t border-zinc-200 pt-4" aria-live="polite">
            {channels
              .filter((c) => c.brandId === brand && selected.includes(c.id))
              .map((c) => (
                <p
                  key={c.id}
                  className={`text-sm ${count > c.max ? "text-red-700" : count >= c.max * 0.9 ? "text-amber-800" : "text-emerald-800"}`}
                >
                  {c.displayName}: {count} / {c.max} ·{" "}
                  {count > c.max
                    ? "Over limit"
                    : count >= c.max * 0.9
                      ? "Near limit"
                      : "Within limit"}
                </p>
              ))}
            {!selected.length && (
              <p className="text-sm text-zinc-600">
                Select channels to see their character limits.
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
