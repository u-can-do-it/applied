import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static shell (header, search, chips) is prerendered and prefetched once for the route;
  // the offer list streams into its <Suspense> fallback, so clicks commit immediately.
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
