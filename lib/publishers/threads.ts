import type { Publisher } from './types';
import { checkLength, failure, guarded, pollingPause, postText, publishingDeadline } from './http';
import { validatePublicUrl } from './safe-fetch';
import { bearer, oauthJson, tokenCredentials, type TokenResponse } from './oauth-http';
export const threads: Publisher = {
  provider: 'threads', maxTextLength: 500, credentialFields: [],
  async validate(c) {
    return guarded('Threads', async () => {
      const r = await oauthJson<{ id: string; username: string }>('threads', '/v1.0/me?fields=id,username', { headers: bearer(c) });
      if (!r.id || !r.username) throw failure('AUTH_EXPIRED', 'Reconnect Threads.');
      return { externalId: r.id, displayName: `@${r.username}`, url: `https://www.threads.net/@${encodeURIComponent(r.username)}` };
    });
  },
  async refreshCredentials(c) {
    if (Number(c.expiresAt) > Date.now() + 7 * 86400000) return null;
    if (Number(c.expiresAt) <= Date.now()) throw failure('AUTH_EXPIRED', 'Reconnect Threads: the token has expired.');
    // Meta only refreshes tokens at least 24 hours old.
    if (Number(c.issuedAt) > Date.now() - 86400000) return null;
    try { return tokenCredentials(await oauthJson<TokenResponse>('threads', '/refresh_access_token?grant_type=th_refresh_token', { headers: bearer(c) }), c); }
    catch { throw failure('AUTH_EXPIRED', 'Reconnect Threads: access could not be renewed.'); }
  },
  async publish(c, input) {
    return guarded('Threads', () => publishingDeadline(async () => {
      const text = postText(input), images = input.mediaUrls ?? [];
      checkLength('Threads', text, 500);
      if (images.length > 4) throw failure('CONTENT_REJECTED', 'SocialMint supports up to four images.');
      for (const url of images) await validatePublicUrl(url);
      const post = async (path: string, body: Record<string, string>) => {
        const r = await oauthJson<{ id: string }>('threads', `/v1.0${path}`, { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
        if (!r.id) throw failure('UNKNOWN', 'Threads did not confirm the request. Check the account before retrying.');
        return r.id;
      };
      const ready = async (id: string) => {
        for (let n = 0; n < 30; n++) {
          const r = await oauthJson<{ status: string }>('threads', `/v1.0/${encodeURIComponent(id)}?fields=status`, { headers: bearer(c) });
          if (r.status === 'FINISHED') return;
          if (r.status !== 'IN_PROGRESS') throw failure('CONTENT_REJECTED', 'Threads could not process the post images.');
          await pollingPause();
        }
        throw failure('PROVIDER_DOWN', 'Threads is still processing the images.');
      };
      let container: string;
      if (images.length > 1) {
        const children: string[] = [];
        for (const image_url of images) { const id = await post('/me/threads', { media_type: 'IMAGE', image_url, is_carousel_item: 'true' }); await ready(id); children.push(id); }
        container = await post('/me/threads', { media_type: 'CAROUSEL', text, children: children.join(',') });
      } else container = await post('/me/threads', { media_type: images.length ? 'IMAGE' : 'TEXT', text, ...(images.length ? { image_url: images[0] } : {}) });
      await ready(container);
      const id = await post('/me/threads_publish', { creation_id: container });
      return { remoteId: id };
    }, input.signal));
  },
};
