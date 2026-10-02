'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

const EVERY_MS = 60_000; // scraping runs every 5 min, so once a minute is plenty
const ON_RETURN_MS = 15_000; // coming back to the tab refreshes if the data is older than this

const timeLabel = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

// Polls the server for the current URL via router.refresh(): fresh Supabase data, same
// scroll position, same search-box text. The list's <Suspense> key doesn't change, so
// React swaps the new rows in place instead of flashing the skeleton.
export function AutoRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    setUpdatedAt(last.current);

    const refresh = () => {
      last.current = Date.now();
      startTransition(() => router.refresh());
    };

    // only poll while the tab is visible - no point loading data nobody sees
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, EVERY_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current > ON_RETURN_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [router]);

  // the transition ends once the refreshed rows are on screen
  useEffect(() => {
    if (!pending && last.current) setUpdatedAt(last.current);
  }, [pending]);

  return (
    <p className="live" aria-live="polite">
      <span className={`dot${pending ? ' busy' : ''}`} aria-hidden="true" />
      {updatedAt === null ? 'Live' : pending ? 'Updating…' : `Updated ${timeLabel.format(updatedAt)}`}
    </p>
  );
}
