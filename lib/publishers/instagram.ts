import type { Publisher } from './types';
import { downloadImage, checkLength, failure, guarded, pollingPause, postText, publishingDeadline } from './http';
import { bearer, oauthJson } from './oauth-http';
import { FACEBOOK_GRAPH_VERSION } from './oauth-config';
export const INSTAGRAM_TEXT_LIMIT = 2200;
export const INSTAGRAM_MEDIA_LIMIT = 10;
/** Instagram Business publishing runs on the Facebook Graph API with a Page token. */
export const instagram: Publisher = {
  provider: 'instagram', maxMediaBytes: 8000000, maxTextLength: INSTAGRAM_TEXT_LIMIT, credentialFields: [],
  async validate(c) {
    return guarded('Instagram', async () => {
      if (!c.externalId) throw failure('AUTH_EXPIRED', 'Reconnect Instagram: the linked Business account is unknown.');
      const r = await oauthJson<{ id?: string; username?: string }>('instagram', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(c.externalId)}?fields=id,username`, { headers: bearer(c) });
      if (!r.id || !r.username) throw failure('AUTH_EXPIRED', 'Reconnect Instagram: the Business account was not accepted.');
      return { externalId: r.id, displayName: `@${r.username}`, url: `https://www.instagram.com/${encodeURIComponent(r.username)}/` };
    });
  },
  async publish(c, input) {
    return guarded('Instagram', () => publishingDeadline(async () => {
      if (!c.externalId) throw failure('AUTH_EXPIRED', 'Reconnect Instagram: the linked Business account is unknown.');
      const text = postText(input), images = input.mediaUrls ?? [];
      checkLength('Instagram', text, INSTAGRAM_TEXT_LIMIT);
      // Instagram has no text-only feed post; refusing beats silently dropping the caption.
      if (!images.length) throw failure('CONTENT_REJECTED', 'Instagram requires at least one image. Add an image or exclude this channel.');
      if (images.length > INSTAGRAM_MEDIA_LIMIT) throw failure('CONTENT_REJECTED', `Postial supports up to ${INSTAGRAM_MEDIA_LIMIT} images on Instagram.`);
      for (const url of images) await downloadImage('Instagram', url, instagram.maxMediaBytes);
      const container = async (body: Record<string, string>) => {
        const r = await oauthJson<{ id?: string }>('instagram', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(c.externalId!)}/media`, { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
        if (!r.id) throw failure('UNKNOWN', 'Instagram did not confirm the request. Check the account before retrying.');
        return r.id;
      };
      const ready = async (id: string) => {
        for (let n = 0; n < 30; n++) {
          const r = await oauthJson<{ status_code?: string }>('instagram', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(id)}?fields=status_code`, { headers: bearer(c) });
          if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return;
          if (r.status_code === 'EXPIRED' || r.status_code === 'ERROR') throw failure('CONTENT_REJECTED', 'Instagram could not process the post images.');
          await pollingPause();
        }
        throw failure('PROVIDER_DOWN', 'Instagram is still processing the images.');
      };
      let creation: string;
      if (images.length > 1) {
        const children: string[] = [];
        for (const image_url of images) { const id = await container({ image_url, is_carousel_item: 'true' }); await ready(id); children.push(id); }
        creation = await container({ media_type: 'CAROUSEL', caption: text, children: children.join(',') });
      } else creation = await container({ image_url: images[0], caption: text });
      await ready(creation);
      const r = await oauthJson<{ id?: string }>('instagram', `/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(c.externalId)}/media_publish`, { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: creation }) });
      if (!r.id) throw failure('UNKNOWN', 'Instagram did not confirm the post. Check the account before retrying.');
      return { remoteId: r.id };
    }, input.signal));
  },
};
