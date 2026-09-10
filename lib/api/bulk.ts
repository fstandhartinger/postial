import { and, eq, sql } from "drizzle-orm";
import { apiIdempotency } from "@/db/schema";
import { workspaceEntitlements } from "@/lib/entitlements";
import { MAX_BULK_ROWS } from "@/lib/bulk";
import { hash, type ApiContext } from "./auth";
import { ApiError, apiError, json } from "./errors";
import { postInput, readJson } from "./posts";
import { savePost, type PostContext, type Tx } from "./post-service";
import { recordFunnelEvent } from '@/lib/funnel';
export type BulkResult = {
  index: number;
  status: number;
  id?: string;
  post_status?: string;
  error?: { code: string; message: string };
};
export function assertBulk(input: unknown): asserts input is unknown[] {
  if (!Array.isArray(input) || !input.length || input.length > MAX_BULK_ROWS)
    throw new ApiError(
      422,
      "validation_error",
      "Send an array of 1–200 posts.",
    );
}
export async function saveBulk(
  ctx: PostContext,
  input: unknown,
  transaction?: Tx,
): Promise<BulkResult[]> {
  assertBulk(input);
  const context = {
    ...ctx,
    access: ctx.access ?? (await workspaceEntitlements(ctx.workspace)),
  };
  const results: BulkResult[] = [];
  for (const [index, row] of input.entries()) {
    try {
      const parsed = postInput
        .extend({
          media_urls: postInput.shape.media_urls.unwrap().max(1).default([]),
        })
        .safeParse(row);
      if (!parsed.success)
        throw new ApiError(
          422,
          "validation_error",
          parsed.error.issues[0].message,
        );
      const d = parsed.data,
        form = new FormData();
      for (const [key, value] of Object.entries({
        brandId: d.brand_id,
        body: d.body,
        mediaUrls: d.media_urls.join("\n"),
        mediaAlt: JSON.stringify(d.media_alt),
        linkUrl: d.link_url ?? "",
        intent: d.scheduled_at ? "schedule" : "draft",
        when: d.scheduled_at === "now" ? "now" : "later",
        scheduledAt: d.scheduled_at ?? "",
        requiresApproval: d.requires_approval ? "on" : "",
      }))
        form.set(key, value);
      d.channel_ids.forEach((id) => form.append("channelId", id));
      // Savepoint isolates even database errors to this row within an idempotent request.
      const id = transaction
        ? await transaction.transaction((tx) =>
            savePost(context, form, true, tx),
          )
        : await savePost(context, form, true);
      results.push({
        index,
        status: 201,
        id,
        post_status: !d.scheduled_at
          ? "draft"
          : d.requires_approval
            ? "pending_approval"
            : "scheduled",
      });
      if (d.scheduled_at && !transaction) await recordFunnelEvent('post_scheduled', { workspaceId: context.workspace.id });
    } catch (error) {
      const response = apiError(error, "bulk");
      results.push({
        index,
        status: response.status,
        ...(await response.json()),
      });
    }
  }
  return results;
}
export async function createBulk(request: Request, ctx: ApiContext) {
  const input = await readJson(request, 2 * 1024 * 1024);
  assertBulk(input);
  const idem = request.headers.get("idempotency-key");
  if (idem !== null && !/^[\x21-\x7e]{1,200}$/.test(idem))
    throw new ApiError(
      422,
      "validation_error",
      "Idempotency-Key must contain 1–200 printable non-space ASCII characters.",
    );
  const requestHash = hash("POST /api/v1/posts/bulk\n" + JSON.stringify(input));
  const context = {
    ...ctx,
    access: await workspaceEntitlements(ctx.workspace),
  };
  const run = async (tx?: Tx) => ({ data: await saveBulk(context, input, tx) });
  if (!idem) return json(await run());
  const result = await ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ctx.key.id + ":" + idem},0))`,
    );
    const [old] = await tx
      .select()
      .from(apiIdempotency)
      .where(
        and(eq(apiIdempotency.keyId, ctx.key.id), eq(apiIdempotency.key, idem)),
      );
    if (old && +old.expiresAt > Date.now()) {
      if (old.requestHash !== requestHash)
        throw new ApiError(
          409,
          "idempotency_conflict",
          "This key was used with a different request.",
        );
      return old.response;
    }
    const response = await run(tx),
      expiresAt = new Date(Date.now() + 86400000);
    await tx
      .insert(apiIdempotency)
      .values({
        keyId: ctx.key.id,
        key: idem,
        requestHash,
        response,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [apiIdempotency.keyId, apiIdempotency.key],
        set: { requestHash, response, expiresAt },
      });
    return response;
  });
  for (const row of input as Array<{ scheduled_at?: unknown }>)
    if (row?.scheduled_at) await recordFunnelEvent('post_scheduled', { workspaceId: ctx.workspace.id });
  return json(result);
}
