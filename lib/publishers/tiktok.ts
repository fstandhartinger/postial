import type { Publisher } from './types';
import { checkLength, downloadVideo, failure, guarded, jsonBody, postText, pollingPause, publishingDeadline, uploadChunk } from './http';
import { bearer, oauthJson, tiktokToken, tokenCredentials } from './oauth-http';
export const TIKTOK_TEXT_LIMIT = 2200;
/** The Content Posting API accepts up to 4 GB, but this adapter holds the whole video in memory
 * (download buffer, then the Blob copy, then a per-chunk slice) and the container runs with a
 * 768 MB limit, so Postial caps downloads far below TikTok's ceiling. Raising this materially
 * requires streaming the download to disk first, not just a bigger number here. */
export const TIKTOK_VIDEO_LIMIT = 128 * 1024 * 1024;
/** TikTok chunk rules: 5 MB to 64 MB per chunk, the final chunk may reach 128 MB, at most 1000 chunks. */
const TIKTOK_CHUNK_MAX = 64_000_000;
const TIKTOK_CHUNK_MIN = 5_000_000;
export function tiktokChunkPlan(size: number): { chunkSize: number; totalChunks: number } {
  if (size <= 0) return { chunkSize: 0, totalChunks: 0 };
  if (size < TIKTOK_CHUNK_MIN) return { chunkSize: size, totalChunks: 1 };
  const totalChunks = Math.min(1000, Math.ceil(size / TIKTOK_CHUNK_MAX));
  return { chunkSize: Math.floor(size / totalChunks), totalChunks };
}
/** TikTok Direct Post: query creator info, init the video, chunked PUT upload, then poll the status. */
export const tiktok: Publisher = {
  provider: 'tiktok', maxMediaBytes: TIKTOK_VIDEO_LIMIT, maxTextLength: TIKTOK_TEXT_LIMIT, credentialFields: [],
  async validate(c) {
    return guarded('TikTok', async () => {
      const r = await oauthJson<{ data?: { user?: { open_id?: string; display_name?: string } } }>('tiktok', '/v2/user/info/?fields=open_id,display_name', { headers: bearer(c) });
      if (!r.data?.user?.open_id) throw failure('AUTH_EXPIRED', 'Reconnect TikTok: the account was not accepted.');
      return { externalId: r.data.user.open_id, displayName: r.data.user.display_name || r.data.user.open_id };
    });
  },
  async refreshCredentials(c) {
    if (Number(c.expiresAt) > Date.now() + 300000) return null;
    if (!c.refreshToken) throw failure('AUTH_EXPIRED', 'Reconnect TikTok to renew publishing access.');
    try { return tokenCredentials((await tiktokToken({ grant_type: 'refresh_token', refresh_token: c.refreshToken })).token, c); }
    catch { throw failure('AUTH_EXPIRED', 'Reconnect TikTok: access could not be renewed.'); }
  },
  async publish(c, input) {
    return guarded('TikTok', () => publishingDeadline(async () => {
      const text = postText(input), media = input.mediaUrls ?? [];
      checkLength('TikTok', text, TIKTOK_TEXT_LIMIT);
      // TikTok has no text-only or image post; refusing beats silently dropping the video.
      if (!media.length) throw failure('CONTENT_REJECTED', 'TikTok requires a video. Add a video or exclude this channel.');
      if (media.length > 1) throw failure('CONTENT_REJECTED', 'TikTok posts carry one video. Remove the extra media or exclude this channel.');
      const video = await downloadVideo('TikTok', media[0], TIKTOK_VIDEO_LIMIT);
      const size = video.size;
      if (!size) throw failure('CONTENT_REJECTED', 'TikTok received an empty video.');
      const { chunkSize, totalChunks } = tiktokChunkPlan(size);
      const info = await oauthJson<{ data?: { privacy_level_options?: string[] } }>('tiktok', '/v2/post/publish/creator_info/query/', { ...jsonBody({}), headers: bearer(c) });
      const options = info.data?.privacy_level_options ?? [];
      // Unaudited apps may only post privately; SELF_ONLY is the only level always offered.
      const privacy = options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
      if (!privacy) throw failure('PROVIDER_DOWN', 'TikTok did not return the privacy options for this account. Please try again.');
      const init = await oauthJson<{ data?: { publish_id?: string; upload_url?: string } }>('tiktok', '/v2/post/publish/video/init/', { ...jsonBody({ post_info: { title: text, privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 0 }, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: totalChunks } }), headers: bearer(c) });
      const publishId = init.data?.publish_id, uploadUrl = init.data?.upload_url;
      if (!publishId || !uploadUrl) throw failure('UNKNOWN', 'TikTok did not confirm the video upload. Check the account before retrying.');
      let offset = 0;
      for (let i = 0; i < totalChunks; i++) {
        // The final chunk absorbs the trailing bytes, so it may exceed chunkSize (up to 128 MB).
        const end = (i === totalChunks - 1 ? size : offset + chunkSize) - 1;
        const chunk = new Uint8Array(await video.slice(offset, end + 1).arrayBuffer());
        const status = await uploadChunk('TikTok', uploadUrl, chunk, { 'Content-Type': video.type || 'video/mp4', 'Content-Range': `bytes ${offset}-${end}/${size}` });
        if (status !== (i === totalChunks - 1 ? 201 : 206)) throw failure('NETWORK', 'TikTok could not accept the video upload. Please try again.');
        offset = end + 1;
      }
      for (let n = 0; n < 60; n++) {
        const s = await oauthJson<{ data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: number[] } }>('tiktok', '/v2/post/publish/status/fetch/', { ...jsonBody({ publish_id: publishId }), headers: bearer(c) });
        const state = s.data?.status;
        if (state === 'PUBLISH_COMPLETE') {
          const postId = s.data?.publicaly_available_post_id?.[0];
          return { remoteId: String(postId ?? publishId) };
        }
        if (state === 'FAILED') {
          const reason = s.data?.fail_reason ?? '';
          if (reason === 'internal') throw failure('PROVIDER_DOWN', 'TikTok hit an internal error while processing the video. Please try again.');
          if (reason === 'auth_removed') throw failure('AUTH_EXPIRED', 'Reconnect TikTok: the account removed Postial access while the video was processing.');
          if (reason === 'video_pull_failed') throw failure('NETWORK', 'TikTok could not retrieve the video. Please try again.');
          if (/file_format|duration|frame_rate|picture_size/.test(reason)) throw failure('CONTENT_REJECTED', 'TikTok rejected the video. Use an MP4, WebM or MOV file within TikTok size, duration and picture limits.');
          throw failure('CONTENT_REJECTED', 'TikTok rejected the post. Review the video and caption, then try again.');
        }
        await pollingPause();
      }
      throw failure('PROVIDER_DOWN', 'TikTok is still processing the video. Please try again.');
    }, input.signal));
  },
};
