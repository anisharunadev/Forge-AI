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
