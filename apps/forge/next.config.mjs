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
  // M18 — Product transformation cut. The following routes were removed
  // as part of collapsing the 12-center navigation to the single
  // `/workflow` spine. Bookmarks + external links are preserved via
  // redirects to the canonical replacement (or to `/workflow` when no
  // equivalent exists).
  async redirects() {
    return [
      // Legacy dashboard → workflow shell.
      { source: '/dashboard', destination: '/workflow', permanent: true },
      // Center pages removed in M18.
      { source: '/forge-command-center', destination: '/workflow', permanent: true },
      { source: '/stories', destination: '/workflow/idea', permanent: true },
      { source: '/stories/:id', destination: '/workflow/idea', permanent: true },
      { source: '/refactor', destination: '/workflow/develop', permanent: true },
      { source: '/refactor/:path*', destination: '/workflow/develop', permanent: true },
      { source: '/validator', destination: '/workflow/develop', permanent: true },
      { source: '/validator/:path*', destination: '/workflow/develop', permanent: true },
      { source: '/organization-knowledge', destination: '/workflow/idea', permanent: true },
      { source: '/project-intelligence', destination: '/workflow/architecture', permanent: true },
      { source: '/project-intelligence/:path*', destination: '/workflow/architecture', permanent: true },
      { source: '/personas', destination: '/workflow', permanent: true },
      { source: '/personas/:path*', destination: '/workflow', permanent: true },
      { source: '/governance-center', destination: '/governance', permanent: true },
      { source: '/governance-center/:path*', destination: '/governance', permanent: true },
    ];
  },
};

export default nextConfig;
