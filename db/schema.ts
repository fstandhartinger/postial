import { pgTable, text, timestamp, integer, primaryKey, pgEnum, boolean, uuid } from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"), email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }), image: text("image"),
});
export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<AdapterAccountType>().notNull(), provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(), refresh_token: text("refresh_token"),
  access_token: text("access_token"), expires_at: integer("expires_at"), token_type: text("token_type"),
  scope: text("scope"), id_token: text("id_token"), session_state: text("session_state"),
}, t => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});
export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(), token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.identifier, t.token] })]);
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRole("role").default("member").notNull(),
}, t => [primaryKey({ columns: [t.workspaceId, t.userId] })]);
export const plan = pgEnum("plan", ["starter", "agency"]);
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().unique().references(() => workspaces.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").unique(), stripeSubscriptionId: text("stripe_subscription_id").unique(),
  plan: plan("plan").notNull().default("starter"), status: text("status").notNull().default("trialing"),
  trialEnd: timestamp("trial_end", { withTimezone: true }), currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
