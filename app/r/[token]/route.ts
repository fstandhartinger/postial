import { publicApproval } from "@/lib/approvals";
import { approvalDocument } from "@/components/approvals/document";
import { submitApproval } from "./actions";
import { approvalMedia } from "./media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const responseHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, { params }: Context) {
  const post = await publicApproval((await params).token);
  const media = new URL(_request.url).searchParams.get("media");
  if (post && media !== null) {
    if (!/^[0-3]$/.test(media) || !post.mediaUrls[Number(media)]) return new Response("Image unavailable", { status: 404, headers: responseHeaders });
    return approvalMedia(post.mediaUrls[Number(media)]);
  }
  return new Response(approvalDocument(post), { status: post ? 200 : 404, headers: responseHeaders });
}
export async function POST(request: Request, { params }: Context) {
  const { token } = await params;
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    return new Response("Unsupported form", { status: 415, headers: responseHeaders });
  // Bound the actual body, including chunked requests, before parsing it.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); return new Response("Form too large", { status: 413, headers: responseHeaders }); }
    chunks.push(value);
  }
  const form = new FormData();
  for (const [key, value] of new URLSearchParams(Buffer.concat(chunks).toString("utf8"))) form.append(key, value);
  const result = await submitApproval(token, form);
  const post = result.status === 404 ? null : await publicApproval(token);
  return new Response(approvalDocument(post, {
    error: result.error, confirmed: result.status === 200,
    name: String(form.get("reviewerName") || "").slice(0, 80), comment: String(form.get("comment") || "").slice(0, 1000),
  }), { status: result.status, headers: { ...responseHeaders, ...(result.status === 429 ? { "Retry-After": "3600" } : {}) } });
}
