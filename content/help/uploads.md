# Upload images and add descriptions

Attach supported images while respecting storage, network limits and public-link access.

## Steps

1. In the composer, choose an image file: JPEG, PNG, WebP or GIF, up to 5 MiB each.
2. Upload up to four images per post; the bulk planner allows one image per row.
3. Add image descriptions for Bluesky and Mastodon; other current adapters do not forward them.
4. Check the selected network’s limit. Bluesky downloads are limited to 1 MB per image; keep images below that for mixed-network posts.
5. Alternatively expand URL entry and use a publicly reachable HTTPS image URL.
6. After publishing, inspect warnings for any omitted media.

Workspace storage is 200 MiB on Starter and 2 GiB with active Agency access. Uploads are limited to 30 per minute per user/workspace. Images are validated and normalized; they are not resized. A file that uploads successfully can still exceed a network’s smaller limit. No video upload is provided.

Media is stored on Hetzner infrastructure in Germany. Image links are public to anyone who has the URL, including networks that fetch the image. Unused uploads older than 30 days are removed by daily maintenance; referenced images remain. Deleting a workspace removes its hosted images, but downloaded or previously cached copies and network posts may remain.

## Related

- [First post](/docs/first-post)
- [Bulk csv](/docs/bulk-csv)
- [Data privacy](/docs/data-privacy)
