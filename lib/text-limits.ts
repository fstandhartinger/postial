import { parseTweet } from 'twitter-text';
/** One final-text and grapheme policy shared by UI, actions and adapters. */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function countText(text: string) { return Array.from(segmenter.segment(text)).length; }
export function postText(input: { text: string; linkUrl?: string }) {
  return input.linkUrl && !input.text.includes(input.linkUrl) ? `${input.text}\n${input.linkUrl}` : input.text;
}
export function channelTextLimit(channel: { provider: string; meta?: { maxTextLength?: number } }) {
  return channel.provider === 'mastodon' ? channel.meta?.maxTextLength ?? 500 : channel.provider === 'bluesky' ? 300 : channel.provider === 'telegram' ? 4096 : channel.provider === 'x' ? 280 : channel.provider === 'threads' ? 500 : 0;
}

/** Official weighted counting includes t.co URLs, Unicode and emoji sequences. */
export function countXText(text: string) { return parseTweet(text).weightedLength; }
export function countChannelText(text: string, provider: string) { return provider === 'x' ? countXText(text) : countText(text); }
