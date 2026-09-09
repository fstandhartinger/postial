import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
export function publicImageAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** Serve only this post's raster images on our origin under the existing CSP.
 * Resolve once and pin the validated IP; never follow redirects or forward cookies.
 */
export async function approvalMedia(source: string) {
  const unavailable = () => new Response("Image unavailable", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Type": "text/plain" } });
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return unavailable();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const records = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("timeout")), 3000); timer.unref(); }),
    ]);
    if (!records.length || records.some((r) => !publicImageAddress(r.address))) return unavailable();
    const pinned = records[0];
    const image = await new Promise<{ body: Buffer; type: string }>((resolve, reject) => {
      const req = request(url, {
        method: "GET", agent: false, family: pinned.family,
        headers: { Accept: "image/png,image/jpeg,image/webp,image/gif", "User-Agent": "Postial-Approval-Preview/1.0" },
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      }, (res) => {
        const type = res.headers["content-type"]?.split(";")[0].trim() || "";
        if (res.statusCode !== 200 || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)) {
          res.destroy(); reject(new Error("unavailable")); return;
        }
        let length = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 5 * 1024 * 1024) { res.destroy(); reject(new Error("too large")); }
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve({ body: Buffer.concat(chunks), type }));
      });
      const timer = setTimeout(() => req.destroy(new Error("timeout")), 5000);
      req.on("close", () => clearTimeout(timer));
      req.on("error", reject);
      req.end();
    });
    return new Response(new Uint8Array(image.body), { headers: {
      "Content-Type": image.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
    } });
  } catch { return unavailable(); }
}
