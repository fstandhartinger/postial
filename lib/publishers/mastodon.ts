import { type Publisher, PublishError } from './types';
import { pollingPause, publishingDeadline, checkLength, downloadImage, failure, guarded, httpsOrigin, json, jsonBody, postText } from './http';

// Instance limits learned by validation/publishing; never cache credentials.
const limits = new Map<string, number>();
async function textLimit(origin: string) {
  try {
    const info = await json<{ configuration?: { statuses?: { max_characters?: number } } }>('Mastodon', `${origin}/api/v2/instance`);
    const value = info.configuration?.statuses?.max_characters;
    const limit = typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 500;
    limits.set(origin, limit);
    return limit;
  } catch (error) {
    if (error instanceof PublishError && error.code === 'UNKNOWN') return limits.get(origin) ?? 500;
    throw error;
  }
}
export const mastodon: Publisher = {
  provider: 'mastodon', maxMediaBytes: 16000000, maxTextLength: 500,
  credentialFields: [
    { key: 'instanceUrl', label: 'Instance URL', placeholder: 'https://mastodon.social', secret: false },
    { key: 'accessToken', label: 'Access token', secret: true, help: 'Preferences → Development → New application. Select write:statuses, write:media and read:accounts.' },
  ],
  validate(credentials) { return guarded('Mastodon', async () => {
    const origin = httpsOrigin(credentials.instanceUrl);
    const account = await json<{ id: string; acct: string; url: string }>('Mastodon', `${origin}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    const maxTextLength = await textLimit(origin);
    return { externalId: account.id, displayName: `@${account.acct.includes('@') ? account.acct : `${account.acct}@${new URL(origin).host}`}`, url: account.url, meta: { maxTextLength } };
  }); },
  publish(credentials, input) { return publishingDeadline(() => guarded('Mastodon', async () => {
    const origin = httpsOrigin(credentials.instanceUrl);
    const text = postText(input);
    checkLength('Mastodon', text, input.meta?.maxTextLength ?? await textLimit(origin));
    const headers = { Authorization: `Bearer ${credentials.accessToken}` };
    const ids: string[] = [];
    for (const url of input.mediaUrls?.slice(0, 4) ?? []) {
      const file = await downloadImage('Mastodon', url, mastodon.maxMediaBytes);
      const form = new FormData(); form.append('file', file, 'image');
      let media = await json<{ id: string; url?: string | null }>('Mastodon', `${origin}/api/v2/media`, { method: 'POST', headers, body: form });
      const id = media.id;
      for (let attempt = 0; !media.url && attempt < 20; attempt++) {
        await pollingPause();
        media = await json('Mastodon', `${origin}/api/v1/media/${encodeURIComponent(id)}`, { headers });
      }
      if (!media.url) throw failure('PROVIDER_DOWN', 'Mastodon is still processing the image. Please try again later.');
      ids.push(id);
    }
    const request = jsonBody({ status: text, media_ids: ids });
    const status = await json<{ id: string; url: string }>('Mastodon', `${origin}/api/v1/statuses`, { ...request, headers: { ...request.headers, ...headers, 'Idempotency-Key': input.idempotencyKey } });
    return { remoteId: status.id, url: status.url, ...((input.mediaUrls?.length ?? 0) > 4 ? { warnings: ['Mastodon allows four images; extra images were omitted.'] } : {}) };
  }), input.signal); },
};
