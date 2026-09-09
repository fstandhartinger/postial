'use server';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { coreContext } from '@/lib/core';
import { apiKeys, webhookEndpoints } from '@/db/schema';
import { createApiKey } from '@/lib/api/auth';
import { createWebhook, sendTestEvent } from '@/lib/api/webhooks';
import { ApiError } from '@/lib/api/errors';
import { PublishError } from '@/lib/publishers';
import { isUuid } from '@/lib/api/post-service';
export type SettingsState = {error?: string; secret?: string; message?: string};
export async function settingsAction(_state: SettingsState, form: FormData): Promise<SettingsState> {
  const ctx = await coreContext();
  try {
    if (ctx.workspace.ownerUserId !== ctx.userId) throw new ApiError(403, 'forbidden', 'Only the workspace owner can manage API settings.');
    const action = String(form.get('action')), id = String(form.get('id') ?? '');
    let result: SettingsState = {};
    if (action === 'create_key') {
      const key = await createApiKey(ctx.workspace.id, ctx.userId, String(form.get('name') ?? ''), form.getAll('scope').map(String));
      result = {secret: key.token, message: 'Copy your API key now. It will not be shown again.'};
    } else if (action === 'create_webhook') {
      const endpoint = await createWebhook(ctx.workspace.id, String(form.get('url') ?? '').trim(), form.getAll('event').map(String));
      result = {secret: endpoint.secret, message: 'Copy your signing secret now. It will not be shown again.'};
    } else {
      if (!isUuid(id)) throw new ApiError(422, 'validation_error', 'Invalid identifier.');
      if (action === 'revoke') {
        await ctx.db.update(apiKeys).set({revokedAt: new Date()}).where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.workspace.id)));
        result = {message: 'Key revoked.'};
      } else if (action === 'disable_webhook') {
        await ctx.db.update(webhookEndpoints).set({active: false}).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, ctx.workspace.id)));
        result = {message: 'Webhook disabled.'};
      } else if (action === 'test_webhook') {
        await sendTestEvent(ctx.workspace.id, id); result = {message: 'Test queued. Refresh in 30 seconds to see the delivery result.'};
      } else throw new ApiError(422, 'validation_error', 'Unknown action.');
    }
    revalidatePath('/app/settings/api');
    return result;
  } catch (e) {
    return {error: e instanceof ApiError ? e.message : e instanceof PublishError ? e.humanMessage : 'Unable to update API settings. Please try again.'};
  }
}
