import {
  pgTable,
  text,
  timestamp,
  integer,
  primaryKey,
  pgEnum,
  boolean,
  uuid,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", {
    mode: "date",
    withTimezone: true,
  }),
  image: text("image"),
});
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  trialUsedAt: timestamp("trial_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const memberRole = pgEnum("member_role", ["owner", "admin", "member"]);
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").default("member").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);
export const plan = pgEnum("plan", ["starter", "agency"]);
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  plan: plan("plan").notNull().default("starter"),
  status: text("status").notNull().default("incomplete"),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const channelProvider = pgEnum("channel_provider", [
  "bluesky",
  "mastodon",
  "telegram",
  "x",
  "threads",
]);
export const channelStatus = pgEnum("channel_status", [
  "active",
  "token_expired",
  "disconnected",
]);
export const postStatus = pgEnum("post_status", [
  "draft",
  "pending_approval",
  "changes_requested",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "partially_failed",
  "failed",
  "skipped",
]);
export const targetStatus = pgEnum("target_status", [
  "needs_review",
  "held",
  "queued",
  "publishing",
  "published",
  "failed",
  "skipped",
]);
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color").notNull().default("#047857"),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("brands_workspace_slug").on(t.workspaceId, t.slug)],
);
export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  provider: channelProvider("provider").notNull(),
  displayName: text("display_name").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url"),
  credentialsEnc: text("credentials_enc").notNull(),
  meta: jsonb("meta").$type<{ maxTextLength?: number }>().notNull().default({}),
  status: channelStatus("status").notNull().default("active"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const posts = pgTable("posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
  linkUrl: text("link_url"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: postStatus("status").notNull().default("draft"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approvalToken: text("approval_token").unique(),
  approvalNote: text("approval_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const postTargets = pgTable(
  "post_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    status: targetStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    remoteId: text("remote_id"),
    remoteUrl: text("remote_url"),
    lastErrorCode: text("last_error_code"),
    lastErrorHuman: text("last_error_human"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("post_target_channel").on(t.postId, t.channelId),
    index("targets_due").on(t.status, t.nextAttemptAt),
  ],
);
export const postEvents = pgTable("post_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").references(() => postTargets.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const approvalDecision = pgEnum("approval_decision", ["approved", "changes_requested"]);
export const approvalDecisions = pgTable("approval_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  decision: approvalDecision("decision").notNull(),
  comment: text("comment").notNull().default(""),
  reviewerName: text("reviewer_name").notNull(),
  reviewerIpHash: text("reviewer_ip_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("approval_decisions_post_created").on(t.postId, t.createdAt)]);

// Persistent, atomic limits shared by every application replica. No raw IPs or tokens.
export const approvalRateLimits = pgTable("approval_rate_limits", {
  key: text("key").primaryKey(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  attempts: integer("attempts").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const apiRateLimits = pgTable("api_rate_limits", {
  keyId: uuid("key_id").primaryKey().references(() => apiKeys.id, { onDelete: "cascade" }),
  attempts: integer("attempts").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const apiIdempotency = pgTable("api_idempotency", {
  keyId: uuid("key_id").notNull().references(() => apiKeys.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  response: jsonb("response").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({columns: [t.keyId, t.key]}), index("api_idempotency_expiry").on(t.expiresAt)]);
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretHash: text("secret_hash").notNull(),
  secretEnc: text("secret_enc").notNull(),
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").$type<"pending" | "delivered" | "failed" | "paused" | "canceled">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
  responseStatus: integer("response_status"),
  pauseReason: text("pause_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("webhook_deliveries_due").on(t.status, t.nextAttemptAt)]);

/** OAuth grants are session-bound, single-use and expire after ten minutes. Verifier is encrypted. */
export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  codeVerifier: text('code_verifier').notNull(),
  brandId: uuid('brand_id').notNull().references(() => brands.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
