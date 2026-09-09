import type { Publisher } from './types';
import { bearer, linkedinToken, oauthJson, oauthJsonResponse, tokenCredentials } from './oauth-http';
import { checkLength, failure, guarded, postText, publishingDeadline } from './http';

export const LINKEDIN_VERSION = process.env.LINKEDIN_VERSION || '202508';

export const linkedin: Publisher = {
  provider: 'linkedin', maxMediaBytes: 0, maxTextLength: 3000, credentialFields: [],
  async validate(c) {
    return guarded('LinkedIn', async () => {
      const r = await oauthJson<{ sub?: string; name?: string; localizedFirstName?: string; localizedLastName?: string; vanityName?: string }>('linkedin', '/v2/userinfo', { headers: bearer(c) });
      if (!r.sub) throw failure('AUTH_EXPIRED', 'Reconnect LinkedIn.');
      const name = r.name || [r.localizedFirstName, r.localizedLastName].filter(Boolean).join(' ') || r.sub;
      return { externalId: r.sub, displayName: name, ...(r.vanityName ? { url: `https://www.linkedin.com/in/${encodeURIComponent(r.vanityName)}` } : {}) };
    });
  },
  async refreshCredentials(c) {
    if (Number(c.expiresAt) > Date.now() + 300000) return null;
    if (!c.refreshToken) return null;
    try { return tokenCredentials(await linkedinToken({ grant_type: 'refresh_token', refresh_token: c.refreshToken }), c); }
    catch { throw failure('AUTH_EXPIRED', 'Reconnect LinkedIn: access could not be renewed.'); }
  },
  async publish(c, input) {
    return guarded('LinkedIn', () => publishingDeadline(async () => {
      const text = postText(input); checkLength('LinkedIn', text, 3000);
      const warnings = input.mediaUrls?.length ? ['LinkedIn images are not supported by this adapter yet; the text was published without media.'] : undefined;
      const r = await oauthJsonResponse<{ id?: string }>('linkedin', '/rest/posts', { method: 'POST', headers: { ...bearer(c), 'Content-Type': 'application/json', 'LinkedIn-Version': LINKEDIN_VERSION, 'X-Restli-Protocol-Version': '2.0.0' }, body: JSON.stringify({ author: `urn:li:person:${c.externalId || ''}`, commentary: text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }) });
      const id = r.response.headers.get('x-restli-id') || r.body.id;
      if (!id) throw failure('UNKNOWN', 'LinkedIn did not confirm publication. Check the account before retrying.');
      const url = /^(urn:li:(?:share|ugcPost):[^/]+)$/.exec(id)?.[1];
      return { remoteId: id, ...(url ? { url: `https://www.linkedin.com/feed/update/${encodeURIComponent(url)}` } : {}), warnings };
    }, input.signal));
  },
};
