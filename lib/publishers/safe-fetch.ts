import { localMediaUrl } from '@/lib/media/url';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';
import ipaddr from 'ipaddr.js';
import { PublishError } from './types';

const rejected = () => new PublishError({ code: 'CONTENT_REJECTED', retryable: false, humanMessage: 'Use a public HTTPS URL. Private or reserved network addresses are not allowed.' });
export function publicAddress(address: string): boolean {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === 'unicast';
  } catch { return false; }
}
/** Validate ALL answers, not just the one the operating system prefers. */
export async function validatePublicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw rejected(); }
  if (localMediaUrl(value)) return {url, host: '127.0.0.1', addresses: [{address:'127.0.0.1', family:4}]};
  if (url.protocol !== 'https:' || url.username || url.password) throw rejected();
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw rejected();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: {address: string; family: number}[];
  try {
    addresses = isIP(host) ? [{address: host, family: isIP(host)}] : await Promise.race([
      dns.lookup(host, {all: true, verbatim: true}),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS deadline')), 3000); }),
    ]);
  } catch {
    throw new PublishError({code: 'NETWORK', retryable: true, humanMessage: 'The URL host could not be resolved. Check the URL and try again; DNS may be temporarily unavailable.'});
  } finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw rejected();
  return { url, host, addresses };
}
/** The TLS connection retains the original hostname/SNI and uses only checked IPs. */
export function pinnedAgent(host: string, addresses: { address: string; family: number }[]) {
  return new Agent({ connect: { lookup: (hostname, options, callback) => {
    if (hostname.replace(/\.$/, '') !== host) return callback(new Error('Outbound hostname mismatch'), '', 4);
    const candidates = addresses.filter(a => !options.family || a.family === options.family);
    if (!candidates.length) return callback(new Error('No checked address'), '', 4);
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  } } });
}
export async function safeFetch(value: string, init: RequestInit = {}, maxBytes = 64 * 1024): Promise<Response> {
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : [])]);
  // Race DNS and stream reads as well: an uncooperative peer must not extend the deadline.
  let abortListener: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(new Error('Outbound request timed out'));
    if (signal.aborted) abortListener(); else signal.addEventListener('abort', abortListener, { once: true });
  });
  const work = async () => {
    let next = value;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const { url, host, addresses } = await validatePublicUrl(next);
      signal.throwIfAborted();
      const agent = pinnedAgent(host, addresses);
      try {
        const response = await fetch(url.href, { ...init, signal, redirect: 'manual', dispatcher: agent } as RequestInit);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          // Do not forward credentials or repeat writes to a redirected origin.
          if (!location || redirects === 3 || (init.method && init.method !== 'GET') || new Headers(init.headers).has('authorization')) throw rejected();
          next = new URL(location, url).href;
          continue;
        }
        const limit = response.ok ? Math.min(maxBytes, 5 * 1024 * 1024) : 64 * 1024;
        const tooLarge = () => new PublishError({ code: 'CONTENT_REJECTED', retryable: false, humanMessage: 'The response exceeds the download limit (5 MB images, 64 KB JSON).' });
        if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw tooLarge(); }
        const reader = response.body?.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        if (reader) try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            size += value.byteLength;
            if (size > limit) throw tooLarge();
            chunks.push(new Uint8Array(value));
          }
        } finally { void reader.cancel().catch(() => {}); }
        return new Response([204, 205, 304].includes(response.status) ? null : new Blob(chunks), { status: response.status, headers: response.headers });
      } finally { await agent.destroy(); }
    }
    throw rejected();
  };
  try { return await Promise.race([work(), aborted]); }
  finally { signal.removeEventListener('abort', abortListener); }
}
