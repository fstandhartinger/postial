import { anonymousLimit } from '@/lib/rate-limit';
import { readForm } from '@/lib/http/body';
import { apiError } from '@/lib/api/errors';
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
  const limited = await anonymousLimit(_request.headers, 'approval', 60);
  if (limited) return limited;
  const post = await publicApproval((await params).token);
  const media = new URL(_request.url).searchParams.get("media");
  if (post && media !== null) {
    if (!/^[0-3]$/.test(media) || !post.mediaUrls[Number(media)]) return new Response("Image unavailable", { status: 404, headers: responseHeaders });
    return approvalMedia(post.mediaUrls[Number(media)]);
  }
  return new Response(approvalDocument(post), { status: post ? 200 : 404, headers: responseHeaders });
}
export async function POST(request: Request, { params }: Context) {
  const limited = await anonymousLimit(request.headers, 'approval', 60);
  if (limited) return limited;
  const { token } = await params;
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    return new Response("Unsupported form", { status: 415, headers: responseHeaders });
  let form: FormData;
  try { form = await readForm(request); } catch(e) { return apiError(e); }
  const result = await submitApproval(token, form);
  const post = result.status === 404 ? null : await publicApproval(token);
  return new Response(approvalDocument(post, {
    error: result.error, confirmed: result.status === 200,
    name: String(form.get("reviewerName") || "").slice(0, 80), comment: String(form.get("comment") || "").slice(0, 1000),
  }), { status: result.status, headers: { ...responseHeaders, ...(result.status === 429 ? { "Retry-After": "3600" } : {}) } });
}
