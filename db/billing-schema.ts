import { pgTable, text, timestamp, uuid, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './schema';
export const billingState = pgTable('stripe_billing_state', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  pastDueSince: timestamp('past_due_since', { withTimezone: true }),
  checkoutSessionId: text('checkout_session_id'),
  checkoutPlan: text('checkout_plan'),
  checkoutLease: text('checkout_lease'),
  checkoutLeaseUntil: timestamp('checkout_lease_until', { withTimezone: true }),
});
export const stripeEvents = pgTable('stripe_processed_events', {
  id: text('id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const retiredSubscriptions = pgTable('stripe_retired_subscriptions', {
  id: text('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
});

export const subscriptionReminderEmails = pgTable('stripe_subscription_reminder_emails', {
  subscriptionId: text('subscription_id').notNull(),
  kind: text('kind').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  error: text('error'),
}, table => [primaryKey({ columns: [table.subscriptionId, table.kind] })]);
