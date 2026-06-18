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
};

export default nextConfig;