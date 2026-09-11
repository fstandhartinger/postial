import { createTransport } from 'nodemailer';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { channelAlertEmails, channels, users, workspaces } from '@/db/schema';
import { appUrl } from '@/lib/stripe';
import { normalizeEmail } from '@/lib/auth-email';
import { recordError } from '@/lib/error-visibility';
import type { Tx } from '@/lib/api/post-service';

// Only confirmed operational incidents mail the workspace owner. needs_review is
// deliberately excluded: an uncertain result must not cry wolf by email (in-app
// notification and webhooks cover it; a real failure lands as a final `failed`).
export const alertMailKinds = ['token_expired', 'failed'] as const;
export type AlertMailKind = typeof alertMailKinds[number];

/**
 * Record an incident inside the caller's transaction. At most one mail per
 * (workspace, kind, channel) in any 24h window, anchored at the last send attempt:
 * incidents inside the window leave the row untouched, bursts before the first
 * send aggregate their post ids into one mail. Rolls back with the transaction,
 * so nothing is mailed for work that was never committed.
 */
export async function recordChannelAlert(tx: Tx, workspaceId: string, channelId: string, kind: AlertMailKind, postId: string | null = null) {
  const added = postId ? JSON.stringify([postId]) : '[]';
  await tx.execute(sql`
    insert into channel_alert_emails (workspace_id, channel_id, kind, post_ids)
    values (${workspaceId}, ${channelId}, ${kind}, ${added}::jsonb)
    on conflict (workspace_id, channel_id, kind) do update set
      post_ids = case
        when greatest(coalesce(channel_alert_emails.sent_at, '-infinity'::timestamptz), coalesce(channel_alert_emails.attempted_at, '-infinity'::timestamptz)) > now() - interval '24 hours'
          then channel_alert_emails.post_ids
        when channel_alert_emails.pending
          then channel_alert_emails.post_ids || ${added}::jsonb
        else ${added}::jsonb end,
      pending = case
        when greatest(coalesce(channel_alert_emails.sent_at, '-infinity'::timestamptz), coalesce(channel_alert_emails.attempted_at, '-infinity'::timestamptz)) > now() - interval '24 hours'
          then channel_alert_emails.pending
        else true end
  `);
}

/** A channel that is connected/active again may alert again immediately. */
export async function clearChannelAlertLocks(tx: Tx, channelId: string) {
  await tx.delete(channelAlertEmails).where(eq(channelAlertEmails.channelId, channelId));
}

function providerLabel(provider: string): string {
  return provider === 'x' ? 'X' : provider === 'threads' ? 'Threads' : provider === 'linkedin' ? 'LinkedIn'
    : provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function alertMailContent(kind: AlertMailKind, channelName: string, provider: string, postIds: string[]): { subject: string; text: string; html: string } {
  const { url, label } = kind === 'failed' && postIds.length === 1
    ? { url: new URL(`/app/posts/${postIds[0]}`, appUrl()).toString(), label: 'Open the affected post' }
    : { url: new URL('/app/channels', appUrl()).toString(), label: 'Open channels' };
  const count = postIds.length;
  const posts = `${count} post${count === 1 ? '' : 's'}`;
  const name = providerLabel(provider);
  const heading = kind === 'token_expired'
    ? `Channel access expired: ${channelName}`
    : `Publishing failed on ${channelName}`;
  const paragraph = kind === 'token_expired'
    ? `The connection between Postial and your ${name} channel "${channelName}" has expired.${count ? ` ${posts} could not be published because of this.` : ''} Nothing will be published to this channel until it is reconnected. Affected posts stay in your history and need to be retried once the channel works again; they do not resume on their own.`
    : `${posts} to your ${name} channel "${channelName}" could not be published and ${count === 1 ? 'has' : 'have'} stopped retrying. The affected ${count === 1 ? 'post remains' : 'posts remain'} in your history and can be retried manually after the cause is resolved.`;
  const text = `Hello,\n\n${paragraph}\n\n${label}:\n${url}\n\nPostial`;
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e4e7;"><tr><td style="padding:32px;"><p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#18181b;">Postial</p><h1 style="font-size:20px;">${escape(heading)}</h1><p style="margin:0 0 24px;">${escape(paragraph)}</p><p style="margin:0;"><a href="${url.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:4px;">${escape(label)}</a></p><p style="margin:0 0 8px;">If the button does not work, use this full link:</p><p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><code>${escape(url)}</code></p></td></tr></table></td></tr></table></body></html>`;
  return { subject: heading, text, html };
}

/**
 * Send the one aggregated mail for a recorded incident, if any is pending. Called
 * only after the recording transaction has committed. Never rejects: failures are
 * persisted on the row, reported to error visibility, and swallowed so the publish
 * path is never blocked by mail.
 */
export async function sendPendingChannelAlertMail(workspaceId: string, channelId: string, kind: AlertMailKind): Promise<void> {
  const db = getDb();
  const key = and(eq(channelAlertEmails.workspaceId, workspaceId), eq(channelAlertEmails.channelId, channelId), eq(channelAlertEmails.kind, kind));
  try {
    const claimed = await db.transaction(async tx => {
      const [row] = await tx.select({ postIds: channelAlertEmails.postIds }).from(channelAlertEmails)
        .where(and(key, eq(channelAlertEmails.pending, true))).for('update');
      if (!row) return null;
      await tx.update(channelAlertEmails).set({ pending: false, attemptedAt: new Date(), error: null }).where(key);
      return row;
    });
    if (!claimed) return;
    const [recipient] = await db.select({ email: users.email }).from(workspaces)
      .innerJoin(users, eq(users.id, workspaces.ownerUserId)).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!recipient?.email) throw new Error('Workspace owner email is unavailable');
    const [channel] = await db.select({ displayName: channels.displayName, provider: channels.provider }).from(channels)
      .where(eq(channels.id, channelId)).limit(1);
    if (!channel) throw new Error('Channel is unavailable');
    const mail = alertMailContent(kind, channel.displayName, channel.provider, [...new Set(claimed.postIds)]);
    const transport = createTransport(process.env.SMTP_URL);
    const result = await transport.sendMail({ to: normalizeEmail(recipient.email), from: process.env.EMAIL_FROM ?? 'Postial <noreply@mail.postial.co>', subject: mail.subject, text: mail.text, html: mail.html });
    const failed = [...(result.rejected || []), ...(result.pending || [])].filter(Boolean);
    if (failed.length) throw new Error(`Email (${failed.join(', ')}) could not be sent`);
    await db.update(channelAlertEmails).set({ sentAt: new Date() }).where(key);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Channel alert email failed';
    await db.update(channelAlertEmails).set({ pending: true, error: message }).where(key).catch(() => {});
    await recordError(error, { route: 'worker:alert-mail', status: 500, authenticated: false });
  }
}
