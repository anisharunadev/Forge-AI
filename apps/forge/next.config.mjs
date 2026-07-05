/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Forge console is a UI shell over the orchestrator REST API;
  // there is no SSR data fetching from internal services, so we keep
  // output mode = standalone for the smallest possible install footprint.
  output: 'standalone',
  // The orchestrator runs on :4000 in dev. Allow images from any host
  // during v1 so seeded avatar URLs and asset CDN's just work; tighten
  // in v1.1 when production branding lands.
  images: { remotePatterns: [{ protocol: 'http', hostname: '**' }] },
  // Phase 8 SC-8.8 — hardened security headers. Mirror the FastAPI
  // middleware at the Next.js layer so the SPA shell also carries the
  // headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy, Permissions-Policy).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob: https:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' ws: wss: https:; " +
              "frame-ancestors 'none'; " +
              "base-uri 'self'; " +
              "form-action 'self'",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "accelerometer=(), camera=(), geolocation=(), gyroscope=(), " +
              "magnetometer=(), microphone=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
  // Step 44 — Stories moved from `/project-intelligence/stories` to its
  // own top-level `/stories` route. These redirects preserve bookmarks
  // + external links without forcing a server-rendered intermediate.
  async redirects() {
    return [
      {
        source: '/project-intelligence/stories',
        destination: '/stories',
        permanent: true,
      },
      {
        source: '/project-intelligence/stories/:id',
        destination: '/stories/:id',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
