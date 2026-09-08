import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self' https://api.stripe.com; form-action 'self' https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
};
export default nextConfig;
