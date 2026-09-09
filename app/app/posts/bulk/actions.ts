"use server";
import { sessionActionBudget } from '@/lib/rate-limit';
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { brands } from "@/db/schema";
import { coreContext } from "@/lib/core";
import { localDateTime } from "@/lib/timezone";
import { assertBulk, saveBulk, type BulkResult } from "@/lib/api/bulk";
const rowSchema = z.object({
  text: z.string(),
  channelIds: z.array(z.string()),
  scheduledAt: z.string(),
  imageUrl: z.string(),
  requiresApproval: z.boolean(),
  importErrors: z.array(z.string()).optional(),
});
export async function saveBulkAction(
  brandId: string,
  rows: unknown,
  draft: boolean,
): Promise<BulkResult[]> {
  const ctx = await coreContext();
  await sessionActionBudget(ctx.userId);
  assertBulk(rows);
  const [brand] = await ctx.db
    .select()
    .from(brands)
    .where(
      and(eq(brands.id, brandId), eq(brands.workspaceId, ctx.workspace.id)),
    );
  if (!brand)
    return rows.map((_, index) => ({
      index,
      status: 404,
      error: { code: "not_found", message: "Brand not found." },
    }));
  const results: BulkResult[] = [];
  for (const [index, input] of rows.entries()) {
    try {
      const r = rowSchema.parse(input);
      if (r.importErrors?.length) throw Error(r.importErrors.join(" "));
      const [result] = await saveBulk(ctx, [
        {
          brand_id: brandId,
          body: r.text,
          channel_ids: r.channelIds,
          media_urls: r.imageUrl ? [r.imageUrl] : [],
          requires_approval: r.requiresApproval,
          ...(!draft
            ? {
                scheduled_at: localDateTime(
                  r.scheduledAt,
                  brand.timezone,
                ).toISOString(),
              }
            : {}),
        },
      ]);
      results.push({ ...result, index });
    } catch (e) {
      results.push({
        index,
        status: 422,
        error: {
          code: "validation_error",
          message:
            e instanceof z.ZodError
              ? "Invalid row."
              : e instanceof Error
                ? e.message
                : "Invalid row.",
        },
      });
    }
  }
  revalidatePath("/app", "layout");
  return results;
}
