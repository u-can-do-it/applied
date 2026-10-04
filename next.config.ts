import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static shell (header, search, chips) is prerendered and prefetched once for the route;
  // the offer list streams into its <Suspense> fallback, so clicks commit immediately.
  cacheComponents: true,
  // lib/outbound.ts connects through an undici Agent of its own (the SSRF checks at connect time):
  // loaded from node_modules as is, next to Node's own fetch, rather than bundled
  serverExternalPackages: ['undici'],
  partialPrefetching: true,
  // the service worker: always checked for a new version (it controls every page), and only ever run
  // as itself (public/sw.js loads nothing)
  headers: () =>
    Promise.resolve([
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]),
  experimental: {
    // the AI filter's file upload (5 MB max) goes through a server action; default is 1 MB
    serverActions: { bodySizeLimit: '6mb' },
    // a page you've been on shows at once when you come back to it (for 30 min). AutoRefresh
    // refreshes the page you're on when the data changed, and so does anything you change there
    // (a server action's refresh()); either drops the other pages from this cache
    staleTimes: { dynamic: 1800 },
  },
};

export default nextConfig;
