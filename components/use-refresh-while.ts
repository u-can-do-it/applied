'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * While `active`, the page is refreshed (router.refresh()) every `ms`; a new `data` from the
 * refreshed page starts the count again, so the next refresh is `ms` after it. A refresh that
 * brings nothing new doesn't stop it: only `active` going false does. One timer at a time.
 * For server-rendered data that changes while something runs on the server (an ad text being
 * fetched): the refresh is what brings it, so a client-side query wouldn't do.
 */
export function useRefreshWhile(active: boolean, ms: number, data: unknown) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), ms);
    return () => clearInterval(timer);
  }, [active, ms, data, router]);
}
