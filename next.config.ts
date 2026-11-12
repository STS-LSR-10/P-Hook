import type { NextConfig } from "next";

// The Content-Security-Policy is report-only for now: nothing is blocked, and the browser tells
// /api/csp-report what would have been (see docs/DEPLOY.md). It names where scripts, pictures and
// requests may come from; inline scripts stay allowed until Next's are given nonces.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.line-scdn.net",
  "style-src 'self' 'unsafe-inline'",
  // slips and entry photos are signed links to Supabase Storage
  "img-src 'self' data: blob: https://*.line-scdn.net https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://api.line.me https://access.line.me https://*.line-scdn.net https://*.line.me",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

// Safe, low-risk response headers.
const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // LIFF runs in the LINE webview (not an iframe), so framing can be refused outright.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
