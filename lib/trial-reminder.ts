import { createTransport } from 'nodemailer';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, workspaces, subscriptions } from '@/db/schema';
import { subscriptionReminderEmails } from '@/db/billing-schema';
import { appUrl } from '@/lib/stripe';
import { normalizeEmail } from '@/lib/auth-email';
import { recordError } from '@/lib/error-visibility';

type ReminderKind = 'trial_will_end' | 'payment_failed' | 'trial_ended' | 'trial_started';

function trialDate(value: Date): string {
  return value.toLocaleDateString('en-GB', { timeZone: 'UTC', dateStyle: 'long' });
}

function content(kind: ReminderKind, trialEnd: Date | null): { subject: string; text: string; html: string } {
  const billingUrl = new URL('/app/billing', appUrl()).toString();
  const date = trialEnd ? trialDate(trialEnd) : 'the end of your trial';
  const text = kind === 'trial_started'
    ? `Hello,\n\nYour Postial trial is running until ${date}. No card is needed and nothing is charged when it ends.\n\nA good first step is one brand and one draft: drafting and client approval work without connecting a channel. You will need a channel only when a post should actually go out.\n\nOpen Postial:\n${new URL('/app', appUrl()).toString()}\n\nPostial`
    : kind === 'trial_ended'
    ? `Hello,\n\nYour Postial trial has ended and nothing further will be published, because no payment method is on file. Your brands, drafts and history remain as they are. Posts that were scheduled for after the trial do not go out on their own; once a plan is active you can retry them from your history.\n\nStart a plan:\n${billingUrl}\n\nPostial`
    : kind === 'trial_will_end'
    ? `Hello,\n\nYour Postial trial ends on ${date}. Without a payment method on file, publishing will not continue after the trial ends. Scheduled posts will pause when publishing access is unavailable; drafts and history remain available.\n\nUpdate billing:\n${billingUrl}\n\nPostial`
    : `Hello,\n\nPostial could not process the payment for your subscription. Publishing access remains available temporarily while the payment is past due; after up to seven days, publishing will be paused until billing is updated. Drafts and history remain available.\n\nUpdate billing:\n${billingUrl}\n\nPostial`;
  const heading = kind === 'trial_started' ? 'Your Postial trial is running'
    : kind === 'trial_ended' ? 'Your Postial trial has ended'
    : kind === 'trial_will_end' ? 'Your Postial trial is ending' : 'Postial payment could not be processed';
  // Render EVERY block between the greeting and the link, not just the first one. The
  // trial-start notice carries its actionable sentence in a second block, and taking only
  // one silently dropped it from the HTML version that most clients display.
  const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const blocks = text.split('\n\n').slice(1, -2).filter(block => block.trim());
  const safeParagraph = blocks.map(escapeHtml).join('</p><p style="margin:0 0 24px;">');
  const safeHeading = heading.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  // The button has to lead where the text says. A trial that just started has nothing to
  // pay, and sending someone to a billing page as their first step after signing up is both
  // the wrong destination and a poor first impression.
  const target = kind === 'trial_started'
    ? { url: new URL('/app', appUrl()).toString(), label: 'Open Postial' }
    : { url: billingUrl, label: kind === 'trial_ended' ? 'Start a plan' : 'Update billing' };
  const safeUrl = target.url.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e4e7;"><tr><td style="padding:32px;"><p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#18181b;">Postial</p><h1 style="font-size:20px;">${safeHeading}</h1><p style="margin:0 0 24px;">${safeParagraph}</p><p style="margin:0;"><a href="${safeUrl}" style="display:inline-block;background:#047857;color:#ffffff;padding:12px 20px;text-decoration:none;font-weight:bold;border-radius:4px;">${escapeHtml(target.label)}</a></p><p style="margin:0 0 8px;">If the button does not work, use this full link:</p><p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><code>${safeUrl}</code></p></td></tr></table></td></tr></table></body></html>`;
  return { subject: heading, text, html };
}

export async function sendSubscriptionReminder(subscriptionId: string, kind: ReminderKind): Promise<void> {
  const db = getDb();
  const reserved = await db.insert(subscriptionReminderEmails).values({ subscriptionId, kind }).onConflictDoNothing().returning({ subscriptionId: subscriptionReminderEmails.subscriptionId });
  if (!reserved.length) {
    // A row already exists. Skip only when the mail actually went out: reserving before
    // sending means one transient SMTP failure would otherwise silence the reminder
    // forever, and this is the single message that turns a card-less trial into revenue.
    // While sent_at is null a previous attempt failed, so let Stripe's own redelivery
    // (bounded, over about three days) try again.
    const [existing] = await db.select({ sentAt: subscriptionReminderEmails.sentAt })
      .from(subscriptionReminderEmails)
      .where(and(eq(subscriptionReminderEmails.subscriptionId, subscriptionId), eq(subscriptionReminderEmails.kind, kind)))
      .limit(1);
    if (existing?.sentAt) return;
    await db.update(subscriptionReminderEmails).set({ attemptedAt: new Date(), error: null })
      .where(and(eq(subscriptionReminderEmails.subscriptionId, subscriptionId), eq(subscriptionReminderEmails.kind, kind)));
  }
  try {
    const [row] = await db.select({ email: users.email, trialEnd: subscriptions.trialEnd })
      .from(subscriptions)
      .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
      .innerJoin(users, eq(users.id, workspaces.ownerUserId))
      .where(and(eq(subscriptions.stripeSubscriptionId, subscriptionId), eq(subscriptions.stripeSubscriptionId, subscriptionId)))
      .limit(1);
    if (!row?.email) throw new Error('Subscription owner email is unavailable');
    const recipient = normalizeEmail(row.email);
    const mail = content(kind, row.trialEnd);
    const transport = createTransport(process.env.SMTP_URL);
    const result = await transport.sendMail({ to: recipient, from: process.env.EMAIL_FROM ?? 'Postial <noreply@mail.postial.co>', subject: mail.subject, text: mail.text, html: mail.html });
    const failed = [...(result.rejected || []), ...(result.pending || [])].filter(Boolean);
    if (failed.length) throw new Error(`Email (${failed.join(', ')}) could not be sent`);
    await db.update(subscriptionReminderEmails).set({ sentAt: new Date() }).where(and(eq(subscriptionReminderEmails.subscriptionId, subscriptionId), eq(subscriptionReminderEmails.kind, kind)));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Subscription reminder email failed';
    await db.update(subscriptionReminderEmails).set({ error: message }).where(and(eq(subscriptionReminderEmails.subscriptionId, subscriptionId), eq(subscriptionReminderEmails.kind, kind))).catch(() => {});
    await recordError(error, { route: 'stripe:subscription-reminder', status: 500, authenticated: false });
  }
}

export { content as subscriptionReminderContent };
