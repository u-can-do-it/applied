import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static shell (header, search, chips) is prerendered and prefetched once for the route;
  // the offer list streams into its <Suspense> fallback, so clicks commit immediately.
  cacheComponents: true,
  partialPrefetching: true,
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
