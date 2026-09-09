import { createHash } from 'node:crypto';
import { type Credentials, type Publisher, PublishError } from './types';
import { publishingDeadline, checkLength, downloadImage, guarded, httpsOrigin, json, jsonBody, postText } from './http';

type DidDocument = { service?: { id: string; type?: string; serviceEndpoint: string }[] };
type Session = { did: string; handle: string; accessJwt: string; didDoc?: DidDocument };
async function resolveDid(did: string): Promise<DidDocument | undefined> {
  if (did.startsWith('did:plc:')) return json<DidDocument>('Bluesky', `https://plc.directory/${encodeURIComponent(did)}`);
  if (did.startsWith('did:web:')) {
    const parts = did.slice(8).split(':').map(decodeURIComponent);
    const origin = httpsOrigin(`https://${parts[0]}`);
    return json<DidDocument>('Bluesky', `${origin}/${parts.length === 1 ? '.well-known' : parts.slice(1).map(encodeURIComponent).join('/')}/did.json`);
  }
}
function pdsEndpoint(doc?: DidDocument) {
  const endpoint = doc?.service?.find(s => s.id.endsWith('#atproto_pds') || s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
  return endpoint ? httpsOrigin(endpoint) : undefined;
}
async function session(credentials: Credentials) {
  const login = (pds: string) => json<Session>('Bluesky', `${pds}/xrpc/com.atproto.server.createSession`, jsonBody({ identifier: credentials.identifier, password: credentials.appPassword }));
  let pds = 'https://bsky.social';
  let auth: Session;
  try { auth = await login(pds); }
  catch (error) {
    // Custom PDS accounts cannot necessarily authenticate on bsky.social.
    // Resolve a public handle; email identifiers have no public DID lookup.
    if (!(error instanceof PublishError) || error.code !== 'AUTH_EXPIRED' || !credentials.identifier || credentials.identifier.includes('@')) throw error;
    const identity = await json<{ did: string }>('Bluesky', `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(credentials.identifier)}`);
    const endpoint = pdsEndpoint(await resolveDid(identity.did));
    if (!endpoint || endpoint === pds) throw error;
    pds = endpoint;
    auth = await login(pds);
  }
  const endpoint = pdsEndpoint(auth.didDoc ?? await resolveDid(auth.did));
  if (endpoint && endpoint !== pds) { pds = endpoint; auth = await login(pds); }
  return { ...auth, pds };
}
function facets(text: string) {
  const encoder = new TextEncoder();
  return Array.from(text.matchAll(/https?:\/\/[^\s<>]+/gu), match => {
    const uri = match[0].replace(/[.,!?;:]+$/u, '');
    const start = match.index!;
    return { index: { byteStart: encoder.encode(text.slice(0, start)).length, byteEnd: encoder.encode(text.slice(0, start) + uri).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] };
  });
}
export const bluesky: Publisher = {
  provider: 'bluesky', maxMediaBytes: 1000000, maxTextLength: 300,
  credentialFields: [
    { key: 'identifier', label: 'Handle or email', secret: false },
    { key: 'appPassword', label: 'App password', secret: true, help: 'Create an app password in Settings → App Passwords. Never use your main password.' },
  ],
  validate(credentials) { return guarded('Bluesky', async () => {
    const auth = await session(credentials);
    return { externalId: auth.did, displayName: `@${auth.handle}`, url: `https://bsky.app/profile/${auth.handle}` };
  }); },
  publish(credentials, input) { return publishingDeadline(() => guarded('Bluesky', async () => {
    const text = postText(input);
    checkLength('Bluesky', text, 300);
    const auth = await session(credentials);
    const headers = { Authorization: `Bearer ${auth.accessJwt}` };
    // ATProto record keys allow alphanumeric strings. Hash is stable across retries.
    const rkey = createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 32);
    const recordUrl = `${auth.pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: auth.did, collection: 'app.bsky.feed.post', rkey })}`;
    const existing = await json<{ uri?: string; error?: string }>('Bluesky', recordUrl, { headers }, true);
    if (existing.uri) return { remoteId: existing.uri, url: `https://bsky.app/profile/${auth.handle}/post/${rkey}` };
    const warnings: string[] = [];
    const images: { alt: string; image: unknown }[] = [];
    if ((input.mediaUrls?.length ?? 0) > 4) warnings.push('Bluesky allows four images; extra images were omitted.');
    for (const url of input.mediaUrls?.slice(0, 4) ?? []) {
      try {
        const blob = await downloadImage('Bluesky', url, bluesky.maxMediaBytes);
        const uploaded = await json<{ blob: unknown }>('Bluesky', `${auth.pds}/xrpc/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...headers, 'Content-Type': blob.type }, body: blob });
        images.push({ alt: '', image: uploaded.blob });
      } catch (error) {
        if (!(error instanceof PublishError) || error.code !== 'CONTENT_REJECTED') throw error;
        warnings.push('An image was omitted: Bluesky requires supported images no larger than 1 MB.');
      }
    }
    const request = jsonBody({ repo: auth.did, rkey, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), facets: facets(text), ...(images.length ? { embed: { $type: 'app.bsky.embed.images', images } } : {}) } });
    const result = await json<{ uri: string }>('Bluesky', `${auth.pds}/xrpc/com.atproto.repo.createRecord`, { ...request, headers: { ...request.headers, ...headers } });
    return { remoteId: result.uri, url: `https://bsky.app/profile/${auth.handle}/post/${result.uri.split('/').pop()}`, ...(warnings.length ? { warnings } : {}) };
  }), input.signal); },
};
