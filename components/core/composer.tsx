"use client";
import Link from "next/link";
import { countChannelText, countText, MAX_POST_TEXT_LENGTH, postText } from "@/lib/text-limits";
/* eslint-disable @next/next/no-img-element -- User-provided previews intentionally bypass the server image proxy. */
import { useActionState, useState, useRef } from "react";
import { coreAction } from "@/app/app/actions";
import { Input, Select, Textarea, Checkbox } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
type Brand = { id: string; name: string; timezone: string; readOnly?: boolean };
type Channel = {
  id: string;
  brandId: string;
  displayName: string;
  provider: string;
  max: number;
  status?: string;
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
    mediaAlt?: Record<string,string>;
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
  const [mediaAlt,setMediaAlt] = useState(initial.mediaAlt ?? {});
  const [imageUrl,setImageUrl] = useState('');
  const [previewChannel,setPreviewChannel] = useState('');
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  async function upload(files: FileList | File[]) {
    if (uploadingRef.current || readOnly) return;
    const list = Array.from(files);
    if (list.length + media.split(/\s+/).filter(Boolean).length > 4) { setUploadError('Use up to four images per post.'); return; }
    if (list.some(f => f.size > 5 * 1024 * 1024)) { setUploadError('Each image must be at most 5 MB.'); return; }
    uploadingRef.current = true; setUploading(true); setUploadError('');
    try {
      for (const file of list) {
        setProgress(0);
        const url = await new Promise<string>((resolve,reject) => {
          const xhr = new XMLHttpRequest(); xhr.open('POST','/api/media'); xhr.timeout = 60000;
          xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded/e.total*100)); };
          xhr.onerror = xhr.ontimeout = () => reject(new Error('Upload failed. Please try again.'));
          xhr.onload = () => {
            try { const result = JSON.parse(xhr.responseText); if (xhr.status !== 201) reject(new Error(result.error?.message ?? 'Upload failed.')); else resolve(result.url); }
            catch { reject(new Error('Upload failed. Please try again.')); }
          };
          const form = new FormData(); form.set('file',file); form.set('brand_id',brand); xhr.send(form);
        });
        setMedia(old => [...old.split(/\s+/).filter(Boolean),url].join('\n'));
      }
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Upload failed.'); }
    finally { uploadingRef.current = false; setUploading(false); }
  }
  const [link, setLink] = useState(initial.linkUrl ?? "");
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const readOnly = brands.find((b) => b.id === brand)?.readOnly;
  const text = postText({ text: body, linkUrl: link });
  const bodyCount = countText(body);
  const [when, setWhen] = useState("schedule");
  const channelCounts = channels
    .filter((c) => selected.includes(c.id) && c.brandId === brand)
    .map((c) => ({ ...c, count: countChannelText(text, c.provider) }));
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
        <p className={bodyCount > MAX_POST_TEXT_LENGTH ? "text-sm text-red-700" : "text-sm text-gray-500"}>
          {bodyCount} / {MAX_POST_TEXT_LENGTH} characters
          {bodyCount > MAX_POST_TEXT_LENGTH ? " — shorten before saving." : ""}
        </p>
        <div aria-live="polite" className="text-sm">
          {channelCounts.map((c) => (
            <p key={c.id} className={c.max > 0 && c.count > c.max ? "text-red-700" : "text-gray-500"}>
              {c.displayName}: {c.count}{c.max > 0 ? ` / ${c.max}` : " characters"}
            </p>
          ))}
        </div>
        {!!channelCounts.length && <section aria-label="Network preview" className="rounded-xl border p-3"><div role="tablist" aria-label="Preview network" className="flex flex-wrap gap-2">{channelCounts.map((c,i)=><button key={c.id} type="button" role="tab" aria-selected={(channelCounts.some(c=>c.id===previewChannel)?previewChannel:channelCounts[0].id)===c.id} onClick={()=>setPreviewChannel(c.id)} className="rounded border px-3 py-2">{c.provider}{i===0?'':''}</button>)}</div>{channelCounts.filter(c=>c.id===(channelCounts.some(c=>c.id===previewChannel)?previewChannel:channelCounts[0].id)).map(c=><div role="tabpanel" key={c.id}><p className="whitespace-pre-wrap break-words">{c.max>0 && c.count>c.max ? Array.from(text).slice(0,c.max).join('') : text}{c.max>0 && c.count>c.max ? '…' : ''}</p><p>{c.count} / {c.max || 'unlimited'} characters. {c.max>0 && c.count>c.max ? 'Over limit — shorten before publishing.' : 'Within limit.'}</p><p className="text-sm">Approximate preview; actual layout varies. Up to four images. {['bluesky','mastodon'].includes(c.provider)?'Image alt text is included.':'This channel does not receive image alt text.'}</p></div>)}</section>}
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
                {c.displayName}{c.status && c.status !== "active" ? " (reconnect before publishing)" : ""}
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
        <div className="space-y-3 rounded-xl border-2 border-dashed border-zinc-300 p-4"
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files); }}>
          <label className="block font-medium">Upload images
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple
              disabled={uploading || readOnly} className="mt-2 block w-full text-sm"
              onChange={e => { if(e.target.files) void upload(e.target.files); e.target.value = ''; }} />
          </label>
          <p className="text-sm text-zinc-600">Drop images here or choose files. JPEG, PNG, WebP or GIF; up to 5 MB each, four per post.</p>
          {uploading && <div role="status">Uploading… {progress}%<progress className="block w-full" max={100} value={progress} /></div>}
          {uploadError && <p role="alert" className="text-red-700">{uploadError}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{media.split(/\s+/).filter(Boolean).slice(0,4).map((url,i) => (
            <div key={i} className="min-w-0">
              <img src={url} alt={mediaAlt[url] || `Uploaded image ${i+1}`} className="aspect-square w-full rounded-lg object-cover" referrerPolicy="no-referrer" />
              <label className="block text-sm">Alt text for image {i+1}<input className="block w-full rounded border p-2" maxLength={1000} value={mediaAlt[url] ?? ''} onChange={e=>setMediaAlt(old=>({...old,[url]:e.target.value}))}/></label>
              <button type="button" disabled={uploading} className="mt-1 whitespace-nowrap text-sm text-red-700 underline" onClick={() => setMedia(media.split(/\s+/).filter(Boolean).filter((_,index) => index !== i).join('\n'))}>Remove image {i+1}</button>
            </div>
          ))}</div>
        </div>
        <input type="hidden" name="mediaUrls" value={media}/>
        <input type="hidden" name="mediaAlt" value={JSON.stringify(mediaAlt)}/>
        <details><summary className="cursor-pointer text-emerald-700">Add image by URL</summary><label className="block">Public HTTPS image URL<input className="block w-full rounded border p-3" type="url" value={imageUrl} onChange={e=>setImageUrl(e.target.value)}/></label><Button type="button" disabled={uploading || media.split(/\s+/).filter(Boolean).length >= 4} onClick={()=>{if(/^https:\/\//.test(imageUrl)){setMedia(old=>[...old.split(/\s+/).filter(Boolean),imageUrl].join('\n'));setImageUrl('');}}}>Add image</Button></details>
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
            disabled={uploading || pending || readOnly}
          >
            Save draft
          </Button>
          <Button
            name="intent"
            value="schedule"
            disabled={uploading || pending || !canPublish || readOnly || !channels.some(c => c.brandId === brand && selected.includes(c.id))}
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {media
              .split(/\s+/)
              .filter((u) => u.startsWith("https://") || /^http:\/\/127\.0\.0\.1:\d+\/m\//.test(u))
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
            {channelCounts.map((c) => (
                <p
                  key={c.id}
                  className={`text-sm ${c.max > 0 && c.count > c.max ? "text-red-700" : c.max > 0 && c.count >= c.max * 0.9 ? "text-amber-800" : "text-emerald-800"}`}
                >
                  {c.displayName}: {c.count}{c.max > 0 ? ` / ${c.max}` : " characters"} ·{" "}
                  {c.max > 0 && c.count > c.max
                    ? "Over limit"
                    : c.max > 0 && c.count >= c.max * 0.9
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
