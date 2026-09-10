import { createTransport } from 'nodemailer';
import type { NodemailerConfig } from '@auth/core/providers/nodemailer';
import { rateLimitIdentityHash, sharedRateLimit, trustedClientIp } from '@/lib/rate-limit';

/** Auth.js's documented default; used by the provider and all user-facing copy. */
export const SIGN_IN_LINK_MAX_AGE_SECONDS = 24 * 60 * 60;
export const SIGN_IN_EMAIL_RATE_LIMIT = 3;
export const SIGN_IN_EMAIL_RATE_WINDOW_SECONDS = 15 * 60;
export const SIGN_IN_IP_RATE_LIMIT = 10;
export const SIGN_IN_IP_RATE_WINDOW_SECONDS = 60 * 60;
// The login Server Action records a funnel event before Auth.js invokes the
// provider. Bound that database write separately from the delivery budget.
export const SIGN_IN_ACTION_RATE_LIMIT = 10;
export const SIGN_IN_ACTION_RATE_WINDOW_SECONDS = 60;

export async function signInActionLimited(requestHeaders: Headers): Promise<boolean> {
  const retry = await sharedRateLimit(
    `signin:action:${rateLimitIdentityHash(trustedClientIp(requestHeaders))}`,
    SIGN_IN_ACTION_RATE_LIMIT,
    SIGN_IN_ACTION_RATE_WINDOW_SECONDS,
  );
  return retry > 0;
}

export function signInLinkLifetime(maxAgeSeconds: number): string {
  if (maxAgeSeconds % 3600 === 0) return `${maxAgeSeconds / 3600} hour${maxAgeSeconds / 3600 === 1 ? '' : 's'}`;
  if (maxAgeSeconds % 86400 === 0) return `${maxAgeSeconds / 86400} day${maxAgeSeconds / 86400 === 1 ? '' : 's'}`;
  if (maxAgeSeconds % 60 === 0) return `${maxAgeSeconds / 60} minute${maxAgeSeconds / 60 === 1 ? '' : 's'}`;
  return `${maxAgeSeconds} second${maxAgeSeconds === 1 ? '' : 's'}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string);
}

export async function sendPostialVerificationRequest(params: Parameters<NodemailerConfig['sendVerificationRequest']>[0]): Promise<void> {
  const { identifier, url, provider } = params;
  const normalizedIdentifier = normalizeEmail(identifier);
  const requestHeaders = params.request?.headers ?? new Headers();
  const [recipientRetry, ipRetry] = await Promise.all([
    sharedRateLimit(`signin:recipient:${rateLimitIdentityHash(normalizedIdentifier)}`, SIGN_IN_EMAIL_RATE_LIMIT, SIGN_IN_EMAIL_RATE_WINDOW_SECONDS),
    sharedRateLimit(`signin:ip:${rateLimitIdentityHash(trustedClientIp(requestHeaders))}`, SIGN_IN_IP_RATE_LIMIT, SIGN_IN_IP_RATE_WINDOW_SECONDS),
  ]);
  if (recipientRetry || ipRetry) {
    const domain = normalizedIdentifier.slice(normalizedIdentifier.indexOf('@') + 1);
    const scope = recipientRetry ? 'recipient' : 'ip';
    console.info('Sign-in email rate limit reached', { scope, domain, identity: rateLimitIdentityHash(normalizedIdentifier).slice(0, 12) });
    return;
  }
  const safeUrl = escapeHtml(url);
  const safeIdentifier = escapeHtml(normalizedIdentifier);
  const lifetime = signInLinkLifetime(provider.maxAge ?? SIGN_IN_LINK_MAX_AGE_SECONDS);
  const text = `Hello,\n\nA sign-in to Postial was requested for ${identifier}.\n\nSign in to Postial:\n${url}\n\nThis link is valid for ${lifetime} and works only once. If you did not request this, you can safely ignore this email.\n\nPostial\nhttps://postial.co\nIf you need help, contact info@productivity-boost.com.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e4e7;"><tr><td style="padding:32px;"><p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#18181b;">Postial</p><p style="margin:0 0 16px;">Hello,</p><p style="margin:0 0 24px;">A sign-in to Postial was requested for <strong>${safeIdentifier}</strong>.</p><p style="margin:0 0 24px;"><a href="${safeUrl}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:4px;">Sign in to Postial</a></p><p style="margin:0 0 8px;">If the button does not work, use this full link:</p><p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><code>${safeUrl}</code></p><p style="margin:0 0 16px;">This link is valid for ${lifetime} and works only once. If you did not request this, you can safely ignore this email.</p><p style="margin:0;color:#52525b;font-size:14px;">Postial<br><a href="https://postial.co" style="color:#047857;">https://postial.co</a><br>If you need help, contact <a href="mailto:info@productivity-boost.com" style="color:#047857;">info@productivity-boost.com</a>.</p></td></tr></table></td></tr></table></body></html>`;
  const transport = createTransport(provider.server);
  const result = await transport.sendMail({ to: normalizedIdentifier, from: provider.from, subject: 'Your Postial sign-in link', text, html });
  const failed = [...(result.rejected || []), ...(result.pending || [])].filter(Boolean);
  if (failed.length) throw new Error(`Email (${failed.join(', ')}) could not be sent`);
}

/** Bound before Nodemailer's address parser; identity only, never a mail options object. */
export function normalizeEmail(identifier: string): string {
  if (typeof identifier !== 'string' || identifier.length > 254) throw new Error('Invalid email address');
  const value = identifier.normalize('NFKC').trim().toLowerCase();
  if (value.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value) || value.startsWith('.') || value.includes('..') || value.includes('.@')) throw new Error('Invalid email address');
  return value;
}
