'use client';

import { useRefreshWhile } from '@/components/use-refresh-while';

// an AI batch takes up to two minutes and saves its verdicts as it ends: a score shows within this of it
export const MATCHING_REFRESH_MS = 15_000;

/**
 * Refreshes the list while any of its jobs is being matched (`matching`: their ids), so their scores come
 * in without a reload; with none left (all judged, or the scrape let go of them) it stops. AutoRefresh's
 * once a minute is for news the list doesn't know is coming.
 */
export function RefreshWhileMatching({ matching }: { matching: string[] }) {
  useRefreshWhile(matching.length > 0, MATCHING_REFRESH_MS, matching.join(' '));
  return null;
}
