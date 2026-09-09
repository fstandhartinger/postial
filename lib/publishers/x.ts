import type { Publisher } from './types';
import { downloadImage, failure, guarded, jsonBody, postText, publishingDeadline } from './http';
import { countXText } from '../text-limits';
import { bearer, oauthJson, tokenCredentials, xToken } from './oauth-http';
export const x: Publisher = {
  provider: 'x', maxMediaBytes: 5000000, maxTextLength: 280, credentialFields: [],
  async validate(c) {
    return guarded('X', async () => {
      const r = await oauthJson<{ data: { id: string; username: string } }>('x', '/2/users/me', { headers: bearer(c) });
      if (!r.data?.id || !r.data.username) throw failure('AUTH_EXPIRED', 'Reconnect X.');
      return { externalId: r.data.id, displayName: `@${r.data.username}`, url: `https://x.com/${encodeURIComponent(r.data.username)}` };
    });
  },
  async refreshCredentials(c) {
    if (Number(c.expiresAt) > Date.now() + 300000) return null;
    if (!c.refreshToken) throw failure('AUTH_EXPIRED', 'Reconnect X to renew publishing access.');
    try { return tokenCredentials(await xToken({ grant_type: 'refresh_token', refresh_token: c.refreshToken }), c); }
    catch { throw failure('AUTH_EXPIRED', 'Reconnect X: access could not be renewed.'); }
  },
  async publish(c, input) {
    return guarded('X', () => publishingDeadline(async () => {
      const text = postText(input), images = input.mediaUrls ?? [];
      if (countXText(text) > 280 || images.length > 4) throw failure('CONTENT_REJECTED', 'X allows 280 weighted characters and up to four images.');
      const ids: string[] = [];
      for (const url of images) {
        const blob = await downloadImage('X', url, x.maxMediaBytes);
        const r = await oauthJson<{ data: { id: string; processing_info?: { state: string } } }>('x', '/2/media/upload', { ...jsonBody({ media: Buffer.from(await blob.arrayBuffer()).toString('base64'), media_type: blob.type, media_category: 'tweet_image' }), headers: { ...bearer(c), 'Content-Type': 'application/json' } });
        if (!r.data?.id || (r.data.processing_info && r.data.processing_info.state !== 'succeeded')) throw failure('CONTENT_REJECTED', 'X could not finish processing this image.');
        ids.push(r.data.id);
      }
      const r = await oauthJson<{ data: { id: string } }>('x', '/2/tweets', { ...jsonBody({ text, ...(ids.length ? { media: { media_ids: ids } } : {}) }), headers: { ...bearer(c), 'Content-Type': 'application/json' } });
      if (!r.data?.id) throw failure('UNKNOWN', 'X did not confirm publication. Check the account before retrying.');
      return { remoteId: r.data.id, url: `https://x.com/i/web/status/${encodeURIComponent(r.data.id)}` };
    }, input.signal));
  },
};
