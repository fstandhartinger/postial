import type { Publisher } from './types';
import { checkLength, downloadImage, failure, guarded, postText, publishingDeadline } from './http';
import { bearer, oauthJson, oauthJsonResponse } from './oauth-http';
import { FACEBOOK_GRAPH_VERSION } from './oauth-config';
export const FACEBOOK_TEXT_LIMIT = 63206;
export const FACEBOOK_MEDIA_LIMIT = 10;
export const facebook: Publisher = {
  provider: 'facebook', maxMediaBytes: 8000000, maxTextLength: FACEBOOK_TEXT_LIMIT, credentialFields: [],
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
      const images = input.mediaUrls ?? [];
      if (images.length > FACEBOOK_MEDIA_LIMIT) throw failure('CONTENT_REJECTED', `Postial supports up to ${FACEBOOK_MEDIA_LIMIT} images on Facebook.`);
      for (const url of images) await downloadImage('Facebook', url, facebook.maxMediaBytes);
      // Images upload as unpublished Page photos; a failure aborts before any text-only feed post exists.
      const mediaIds: string[] = [];
      for (const url of images) {
        const r = await oauthJson<{ id?: string }>('facebook', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(c.externalId)}/photos`, { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ url, published: 'false' }) });
        if (!r.id) throw failure('UNKNOWN', 'Facebook did not confirm the image upload. Check the Page before retrying.');
        mediaIds.push(r.id);
      }
      const body: Record<string, string> = { message: text };
      mediaIds.forEach((id, index) => { body[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id }); });
      const r = await oauthJsonResponse<{ id?: string }>('facebook', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(c.externalId)}/feed`, { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
      if (!r.body.id) throw failure('UNKNOWN', 'Facebook did not confirm the post. Check the Page before retrying.');
      return { remoteId: r.body.id, url: `https://www.facebook.com/${r.body.id}` };
    }, input.signal));
  },
};
