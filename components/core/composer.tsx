"use client";
/* eslint-disable @next/next/no-img-element -- User-provided previews intentionally bypass the server image proxy. */
import { useActionState, useState } from "react";
import { coreAction } from "@/app/app/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
type Brand = { id: string; name: string; timezone: string };
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
}: {
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
  const [when, setWhen] = useState("schedule");
  const limits = channels
    .filter((c) => selected.includes(c.id) && c.brandId === brand && c.max > 0)
    .map((c) => c.max);
  const max = limits.length ? Math.min(...limits) : 0;
  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="action" value="post" />
      <input type="hidden" name="postId" value={initial.id ?? ""} />
      <label className="block">
        Brand
        <select
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
        </select>
      </label>
      <label className="block">
        Post text
        <textarea
          className="block min-h-40 w-full rounded-xl border p-4"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </label>
      <p
        className={
          max && Array.from(body).length > max
            ? "text-red-700"
            : "text-gray-500"
        }
      >
        {Array.from(body).length}
        {max ? ` / ${max}` : " characters"}
      </p>
      <fieldset className="space-y-2">
        <legend>Channels</legend>
        {channels
          .filter((c) => c.brandId === brand)
          .map((c) => (
            <label className="block" key={c.id}>
              <input
                type="checkbox"
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
          <a
            className="text-emerald-700 underline"
            href={`/app/brands/${brand}`}
          >
            Connect a channel
          </a>
        )}
      </fieldset>
      <label className="block">
        Media URLs (up to four HTTPS images)
        <textarea
          className="block w-full rounded border p-3"
          name="mediaUrls"
          value={media}
          onChange={(e) => setMedia(e.target.value)}
          placeholder="One URL per line"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        {media
          .split(/\s+/)
          .filter((u) => u.startsWith("https://"))
          .slice(0, 4)
          .map((u, i) => (
            <img
              key={i}
              src={u}
              alt={`Media preview ${i + 1}`}
              referrerPolicy="no-referrer"
              className="h-24 w-24 rounded object-cover"
            />
          ))}
      </div>
      <label className="block">
        Link
        <Input name="linkUrl" type="url" defaultValue={initial.linkUrl} />
      </label>
      <label className="block">
        Publishing
        <select
          name="when"
          className="block rounded border p-3"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        >
          <option value="schedule">Schedule</option>
          <option value="now">Publish now</option>
        </select>
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
      <label className="block">
        <input
          name="requiresApproval"
          type="checkbox"
          defaultChecked={initial.requiresApproval}
        />{" "}
        Requires client approval
      </label>
      <p className="text-sm text-gray-500">
        Posts requiring approval stay on hold. Client approval links arrive in
        the next release.
      </p>
      {state.error && (
        <p role="alert" className="text-red-700">
          {state.error}
        </p>
      )}
      <div className="flex gap-3">
        <Button name="intent" value="draft" disabled={pending}>
          Save draft
        </Button>
        <Button name="intent" value="schedule" disabled={pending}>
          {pending ? "Saving…" : when === "now" ? "Publish now" : "Schedule"}
        </Button>
      </div>
    </form>
  );
}
