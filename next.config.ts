import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static shell (header, search, chips) is prerendered and prefetched once for the route;
  // the offer list streams into its <Suspense> fallback, so clicks commit immediately.
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // the AI filter's file upload (5 MB max) goes through a server action; default is 1 MB
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default nextConfig;
