/** One final-text and grapheme policy shared by UI, actions and adapters. */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function countText(text: string) { return Array.from(segmenter.segment(text)).length; }
export function postText(input: { text: string; linkUrl?: string }) {
  return input.linkUrl && !input.text.includes(input.linkUrl) ? `${input.text}\n${input.linkUrl}` : input.text;
}
export function channelTextLimit(channel: { provider: string; meta?: { maxTextLength?: number } }) {
  return channel.provider === 'mastodon' ? channel.meta?.maxTextLength ?? 500 : channel.provider === 'bluesky' ? 300 : channel.provider === 'telegram' ? 4096 : channel.provider === 'x' ? 280 : channel.provider === 'threads' ? 500 : 0;
}

/** X counts each recognized URL as 23, emoji as 2, and CJK as 2. */
export function countXText(text: string) {
  const normalized = text.normalize('NFC');
  const weighted = (part: string) => Array.from(segmenter.segment(part)).reduce((sum, { segment }) => {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment)) return sum + 2;
    return sum + Array.from(segment).reduce((n, char) => {
      const cp = char.codePointAt(0)!;
      return n + (cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2);
    }, 0);
  }, 0);
  let total = 0, end = 0;
  for (const match of normalized.matchAll(/https?:\/\/[^\s<>]+/gu)) {
    const url = match[0].replace(/[.,!?;:]+$/u, '');
    total += weighted(normalized.slice(end, match.index)) + 23;
    end = match.index + url.length;
  }
  return total + weighted(normalized.slice(end));
}
export function countChannelText(text: string, provider: string) { return provider === 'x' ? countXText(text) : countText(text); }
