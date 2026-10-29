'use client';

import { useQuery } from '@tanstack/react-query';

/** GET /api/ad-texts: every application's saved ad text, by job id. */
async function loadAdTexts(): Promise<Map<string, string>> {
  const res = await fetch('/api/ad-texts', { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  const { texts } = (await res.json()) as { texts: { jobId: string; content: string }[] };
  return new Map(texts.map((text) => [text.jobId, text.content]));
}

// a text saved since (an ad read in the background, one you edited) is in after this, or on the next visit
const FRESH_FOR_MS = 60_000;

/** The ad texts, for the Applied tab's search of everything: loaded only while it's `on`. */
export function useAdTexts(on: boolean) {
  return useQuery({ queryKey: ['ad-texts'], queryFn: loadAdTexts, enabled: on, staleTime: FRESH_FOR_MS });
}
