import { type PublicApproval } from "@/lib/approvals";
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function https(value: string | null) {
  if (!value) return false;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
const providers = { bluesky: "Bluesky", mastodon: "Mastodon", telegram: "Telegram", x: "X", threads: "Threads", linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram" };
const style = `*{box-sizing:border-box}body{margin:0;background:#f5f7f6;color:#17231e;font:16px/1.6 system-ui,sans-serif}main{max-width:680px;margin:32px auto;padding:0 20px}header{border-top:5px solid var(--brand);padding:24px;background:white;border-radius:16px 16px 0 0}h1{font-size:24px;margin:0}h2{font-size:19px}article,section{padding:24px;background:white;margin-bottom:20px;border-radius:0 0 16px 16px;overflow-wrap:anywhere}section{border-radius:16px}p{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto;border-radius:10px;margin:12px 0}a{color:#065f46;overflow-wrap:anywhere}label{display:block;font-weight:600;margin-top:16px}input,textarea{display:block;width:100%;font:inherit;padding:12px;border:1px solid #6b7871;border-radius:8px}textarea{min-height:120px;resize:vertical}button{font:inherit;font-weight:600;border:1px solid #446252;border-radius:8px;padding:12px 18px;min-height:48px;background:#065f46;color:white;cursor:pointer}button+button{background:white;color:#17231e}.buttons{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.status{background:#e8f4ec;padding:16px;border-radius:8px}.error{color:#9b1c1c}.muted{color:#4d6055}footer{text-align:center;padding:12px;color:#4d6055}.skip{position:absolute;left:-9999px}.skip:focus{position:static}@media(max-width:420px){main{margin:16px auto;padding:0 12px}article,section,header{padding:20px}}`;
export function approvalDocument(post: PublicApproval | null, options: { error?: string; confirmed?: boolean; name?: string; comment?: string } = {}) {
  const color = post && /^#[\da-f]{6}$/i.test(post.color) ? post.color : "#047857";
  const date = (at: Date) => escape(at.toLocaleString("en-GB", { timeZone: post?.timezone || "UTC", dateStyle: "medium", timeStyle: "short" }));
  const last = post?.lastDecision;
  const content = !post ? `<section role="alert"><h1>This approval link is no longer available</h1><p>This link may be incorrect, expired, or already used. We cannot tell which from here.</p><p>Ask the sender for a new link. If you need help, email <a href="mailto:info@productivity-boost.com">info@productivity-boost.com</a>.</p></section>` : `
    <header><p class="muted">Client review</p><h1>${escape(post.name)}</h1></header>
    <article aria-label="Social post"><p>${escape(post.body)}</p>
    ${post.mediaUrls.map((url, i) => https(url) ? `<img src="?media=${i}" alt="${escape(post.mediaAlt[url]?.trim() || `Image ${i + 1} of ${post.mediaUrls.length}`)}" referrerpolicy="no-referrer" loading="lazy">` : "").join("")}
    ${https(post.linkUrl) ? `<a href="${escape(post.linkUrl)}" rel="noreferrer noopener" target="_blank">${escape(post.linkUrl)}</a>` : ""}
    <p class="muted">${post.scheduledAt ? `Scheduled for ${date(post.scheduledAt)} (${escape(post.timezone)})` : "No publishing time set"}</p>
    <p class="muted">${post.targets.map((t) => `${providers[t.provider]} · ${escape(t.name)}`).join("<br>")}</p></article>
    <section aria-label="Review decision">
    ${options.confirmed ? '<p class="status" role="status">Thank you. Your decision has been saved.</p>' : ""}
    ${last ? `<p class="status">${post.status === "pending_approval" ? "Awaiting your review after resubmission" : last.decision === "approved" ? "Approved by" : last.decision === "changes_requested" ? "Changes requested by" : "Previously approved by"} ${escape(last.name)} on ${date(last.at)} (${escape(post.timezone)})</p>${last.comment ? `<p>${escape(last.comment)}</p>` : ""}` : "<h2>Your feedback</h2>"}
    ${options.error ? `<p id="review-error" class="error" role="alert">${escape(options.error)}</p>` : ""}
    ${post.reviewable ? `<p>You can update your decision until publishing starts.</p>
    <form method="post"${options.error ? ' aria-describedby="review-error"' : ""}>
      <input type="hidden" name="approvalVersion" value="${escape(post.approvalVersion)}">
      <label for="reviewerName">Name (required)</label><input id="reviewerName" name="reviewerName" required maxlength="80" autocomplete="name" value="${escape(options.name)}">
      <label for="comment">Comment (required when requesting changes)</label><textarea id="comment" name="comment" maxlength="1000">${escape(options.comment)}</textarea>
      <div class="buttons"><button name="decision" value="approved">Approve</button><button name="decision" value="changes_requested">Request changes</button></div>
    </form>` : '<p>This post is read-only. Publishing has started or finished.</p>'}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="same-origin"><title>${post ? `${escape(post.name)} · Review post` : "Page not found"} · Postial</title><style>${style}</style></head><body style="--brand:${color}"><a class="skip" href="#main">Skip to content</a><main id="main">${content}<footer>Powered by Postial</footer></main></body></html>`;
}
