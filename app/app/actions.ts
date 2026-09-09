"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  brands,
  channels,
  workspaces,
} from "@/db/schema";
import { coreContext, isUuid } from "@/lib/core";
import { encryptCredentials } from "@/lib/crypto";
import {
  availableProviders,
  getPublisher,
  PublishError,
} from "@/lib/publishers";
import { validateConnection } from "@/lib/publishers/connection";
import { workspaceEntitlements } from '@/lib/entitlements';
import { checkChannelHealth } from "@/lib/publishing/health";
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
import { ApiError } from "@/lib/api/errors";
import { InputError, check, https, savePost, changeTarget, duplicatePost } from "@/lib/api/post-service";
export async function coreAction(
  _state: { error: string },
  form: FormData,
): Promise<{ error: string }> {
  const { db, workspace, userId } = await coreContext();
  let destination = "/app";
  try {
    const action = str(form, "action");
    const access = await workspaceEntitlements(workspace);
    if (action === "brand") {
      const name = str(form, "name"),
        color = str(form, "color"),
        timezone = str(form, "timezone");
      check(
        name.length > 0 && name.length <= 80,
        "Enter a brand name (up to 80 characters).",
      );
      check(/^#[0-9a-f]{6}$/i.test(color), "Choose a valid color.");
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      } catch {
        throw new InputError("Enter an IANA timezone, such as Europe/Berlin.");
      }
      const limit = access.limit;
      const brand = await db.transaction(async (tx) => {
        await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspace.id))
          .for("update");
        const existing = await tx
          .select({ id: brands.id })
          .from(brands)
          .where(eq(brands.workspaceId, workspace.id));
        check(
          existing.length < limit,
          `Your plan supports ${limit} brands. Review Billing to upgrade.`,
        );
        const [b] = await tx
          .insert(brands)
          .values({
            workspaceId: workspace.id,
            name,
            color,
            timezone,
            slug:
              (name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "") || "brand") +
              "-" +
              crypto.randomUUID().slice(0, 8),
          })
          .returning();
        return b;
      });
      destination = `/app/brands/${brand.id}`;
    } else if (action === "connect" || action === "disconnect") {
      const brandId = str(form, "brandId");
      check(isUuid(brandId), "Choose a brand.");
      const [brand] = await db
        .select()
        .from(brands)
        .where(
          and(eq(brands.id, brandId), eq(brands.workspaceId, workspace.id)),
        );
      check(brand, "Brand not found.");
      check(access.activeBrandIds.includes(brandId), "This brand is read-only under your plan. Review Billing.");
      if (action === "connect") {
        const provider = availableProviders().find(
          (p) => p === str(form, "provider"),
        );
        check(provider && provider !== "x" && provider !== "threads", "Choose an available provider. Use the OAuth button for X or Threads.");
        const publisher = getPublisher(provider);
        const credentials: Record<string, string> = {};
        for (const field of publisher.credentialFields) {
          credentials[field.key] = str(form, "credential:" + field.key);
          check(
            credentials[field.key] && credentials[field.key].length <= 10000,
            `Enter ${field.label}.`,
          );
        }
        const account = await validateConnection(publisher, credentials);
        const values = {
          brandId,
          provider,
          credentialsEnc: encryptCredentials(credentials),
          displayName: account.displayName,
          externalId: account.externalId,
          url: account.url && https(account.url) ? account.url : null,
          meta: account.meta ?? {},
          lastCheckedAt: new Date(),
          lastHealthError: null,
          status: "active" as const,
        };
        await db.transaction(async (tx) => {
          await tx
            .select()
            .from(brands)
            .where(eq(brands.id, brandId))
            .for("update");
          const [existing] = await tx
            .select({ id: channels.id })
            .from(channels)
            .where(
              and(
                eq(channels.brandId, brandId),
                eq(channels.provider, provider),
                eq(channels.externalId, account.externalId),
              ),
            );
          if (existing)
            await tx
              .update(channels)
              .set(values)
              .where(eq(channels.id, existing.id));
          else await tx.insert(channels).values(values);
        });
      } else {
        const id = str(form, "channelId");
        check(isUuid(id), "Choose a channel.");
        await db
          .update(channels)
          .set({ status: "disconnected", credentialsEnc: "" })
          .where(and(eq(channels.id, id), eq(channels.brandId, brandId)));
      }
      destination = str(form,"returnTo") === "channels" ? "/app/channels" : `/app/brands/${brandId}`;
    } else if (action === "check_channel") {
      const id = str(form,"channelId");
      check(isUuid(id), "Choose a channel.");
      const [c] = await db.select({brandId:channels.brandId}).from(channels).innerJoin(brands,eq(brands.id,channels.brandId)).where(and(eq(channels.id,id),eq(brands.workspaceId,workspace.id)));
      check(c && access.activeBrandIds.includes(c.brandId), "Channel unavailable or brand read-only.");
      await checkChannelHealth(id,workspace.id);
      destination = "/app/channels";
    } else if (action === "duplicate") {
      const id = await duplicatePost({db,workspace,userId},str(form,"postId"));
      destination = `/app/posts/${id}/edit`;
    } else if (action === "post") {
      const postId = await savePost({db, workspace, userId}, form);
      destination = `/app/posts/${postId}`;
    } else if (action === "retry" || action === "skip") {
      const postId = await changeTarget({db, workspace, userId}, form, action);
      destination = `/app/posts/${postId}`;
    } else throw new InputError("Unknown action.");
  } catch (e) {
    return {
      error:
        e instanceof InputError || e instanceof ApiError
          ? e.message
          : e instanceof PublishError
            ? e.humanMessage
            : "Unable to save right now. Please try again.",
    };
  }
  revalidatePath("/app", "layout");
  redirect(destination);
}
