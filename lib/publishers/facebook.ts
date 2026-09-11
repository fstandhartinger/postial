import type { Publisher } from './types';
import { checkLength, failure, guarded, postText, publishingDeadline } from './http';
import { bearer, oauthJson, oauthJsonResponse } from './oauth-http';
import { FACEBOOK_GRAPH_VERSION } from './oauth-config';
export const FACEBOOK_TEXT_LIMIT = 63206;
export const facebook: Publisher = {
  provider: 'facebook', maxMediaBytes: 0, maxTextLength: FACEBOOK_TEXT_LIMIT, credentialFields: [],
  async validate(c) {
    return guarded('Facebook', async () => {
      const r = await oauthJson<{ id?: string; name?: string }>('facebook', `/${FACEBOOK_GRAPH_VERSION}/me?fields=id,name`, { headers: bearer(c) });
      if (!r.id) throw failure('AUTH_EXPIRED', 'Reconnect Facebook: the Page token was not accepted.');
      return { externalId: r.id, displayName: r.name || r.id, url: `https://www.facebook.com/${encodeURIComponent(r.id)}` };
    });
  },
  async publish(c, input) {
    return guarded('Facebook', () => publishingDeadline(async () => {
      const text = postText(input);
      checkLength('Facebook', text, FACEBOOK_TEXT_LIMIT);
      if (!c.externalId) throw failure('AUTH_EXPIRED', 'Reconnect Facebook: the Page for this channel is unknown.');
      // Facebook accepts image attachments, but this adapter publishes text only and says so instead of dropping media silently.
      const warnings = input.mediaUrls?.length ? ['Facebook currently publishes text only; images and videos were not attached to this post.'] : undefined;
      const r = await oauthJsonResponse<{ id?: string }>('facebook', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(c.externalId)}/feed`, { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ message: text }) });
      if (!r.body.id) throw failure('UNKNOWN', 'Facebook did not confirm the post. Check the Page before retrying.');
      return { remoteId: r.body.id, url: `https://www.facebook.com/${r.body.id}`, warnings };
    }, input.signal));
  },
};
