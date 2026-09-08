import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './schema';
export const billingState = pgTable('stripe_billing_state', {
  workspaceId: uuid('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  pastDueSince: timestamp('past_due_since', { withTimezone: true }),
  checkoutSessionId: text('checkout_session_id'),
  checkoutPlan: text('checkout_plan'),
});
export const stripeEvents = pgTable('stripe_processed_events', {
  id: text('id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
