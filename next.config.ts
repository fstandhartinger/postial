import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || process.env.DEPLOYMENT_VERSION || process.env.GIT_SHA,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async headers() {
    return [{source: '/api/v1/:path*', headers: [{key: 'Cache-Control', value: 'no-store'}]}, { source: '/:path*', headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.stripe.com; form-action 'self' https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com https://x.com https://twitter.com https://api.twitter.com https://threads.net https://www.threads.net https://threads.com https://www.threads.com https://www.instagram.com https://www.facebook.com https://www.linkedin.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
};
export default nextConfig;
