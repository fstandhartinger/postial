/**
 * Shared publisher contract. Adapters live in lib/publishers/<provider>.ts and are
 * registered in lib/publishers/index.ts. The publishing worker (lib/publishing) only
 * depends on this file.
 */
export type Provider = "bluesky" | "mastodon" | "telegram" | "x" | "threads";

/** Provider-specific credentials, stored encrypted at rest. Never logged. */
export type Credentials = Record<string, string>;

export interface PublishInput {
  /** Plain text body, already trimmed. Adapters enforce provider limits and report PERMANENT errors when exceeded. */
  text: string;
  /** Publicly fetchable media URLs (images only for now). Adapters may ignore media they cannot handle and say so in `warnings`. */
  mediaUrls?: string[];
  /** Optional link to attach/preview when the provider supports it. */
  linkUrl?: string;
  /** Stable id of the post target; adapters may use it as an idempotency key where the provider supports one. */
  idempotencyKey: string;
  signal?: AbortSignal;
  meta?: { maxTextLength?: number };
}

export interface PublishResult {
  remoteId: string;
  /** Public permalink if the provider exposes one. */
  url?: string;
  warnings?: string[];
}

export interface AccountInfo {
  meta?: { maxTextLength?: number };
  /** Provider-side account/channel identifier. */
  externalId: string;
  /** What we show the user: @handle, channel title, instance handle. */
  displayName: string;
  /** Public profile/channel URL if any. */
  url?: string;
}

export type PublishErrorCode =
  | "AUTH_EXPIRED" // token/password no longer valid → mark channel token_expired, do not retry
  | "RATE_LIMITED" // retry after backoff
  | "NETWORK" // transient → retry
  | "PROVIDER_DOWN" // 5xx → retry
  | "CONTENT_REJECTED" // too long, unsupported media, policy → permanent
  | "DUPLICATE" // provider says identical post exists → treat as published if remoteId known, else permanent
  | "UNKNOWN"; // permanent after max attempts

export class PublishError extends Error {
  readonly code: PublishErrorCode;
  readonly retryable: boolean;
  /** One or two plain-English sentences a non-technical client can understand. No tokens, no stack traces. */
  readonly humanMessage: string;
  /** Seconds to wait before the next attempt when the provider told us (e.g. Retry-After). */
  readonly retryAfterSeconds?: number;
  constructor(args: { code: PublishErrorCode; retryable: boolean; humanMessage: string; retryAfterSeconds?: number; cause?: unknown }) {
    super(`${args.code}: ${args.humanMessage}`, { cause: args.cause });
    this.name = "PublishError";
    this.code = args.code;
    this.retryable = args.retryable;
    this.humanMessage = args.humanMessage;
    this.retryAfterSeconds = args.retryAfterSeconds;
  }
}

export interface Publisher {
  readonly provider: Provider;
  /** Hard text limit the composer shows; 0 = unlimited. */
  readonly maxTextLength: number;
  readonly maxMediaBytes: number;
  /** Fields the connect form must collect, in order. */
  readonly credentialFields: ReadonlyArray<{ key: string; label: string; help?: string; secret: boolean; placeholder?: string }>;
  /** Verifies credentials against the provider and returns the account we would post as. Throws PublishError(AUTH_EXPIRED|NETWORK|...). */
  validate(credentials: Credentials): Promise<AccountInfo>;
  /** Return renewed credentials before publishing; the worker persists them under a channel lock. */
  refreshCredentials?(credentials: Credentials): Promise<Credentials | null>;
  /** Publishes one post. Throws PublishError. Must never throw anything else. */
  publish(credentials: Credentials, input: PublishInput): Promise<PublishResult>;
}
