'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { OfferWindow } from '@/lib/offer-window';

export const offerKey = (jobId: string) => ['offer', jobId] as const;

/** GET /api/offer: the job's complete ad with the board's details, your note and the AI's verdict. */
export async function loadOffer(jobId: string): Promise<OfferWindow> {
  const res = await fetch(`/api/offer?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as OfferWindow;
}

// fetched as you point at the window's button (or tab to it), so the click finds it in: younger than
// this, the click uses it; the window then checks it again as it opens
const PREFETCHED_FOR_MS = 30_000;
export const offerQuery = (jobId: string) => ({
  queryKey: offerKey(jobId),
  queryFn: () => loadOffer(jobId),
  staleTime: PREFETCHED_FOR_MS,
});

/**
 * One offer's window. Closed, it's forgotten (gcTime 0, and removed: a prefetched one got the default
 * gcTime), so the next opening shows the note as it is then.
 */
export function useOffer(jobId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: offerKey(jobId), queryFn: () => loadOffer(jobId), gcTime: 0 });
  useEffect(() => () => queryClient.removeQueries({ queryKey: offerKey(jobId), exact: true }), [jobId, queryClient]);
  return query;
}
