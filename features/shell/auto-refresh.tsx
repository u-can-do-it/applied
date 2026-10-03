'use client';

import { useQuery, type Query } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { cn } from '@/lib/shared/cn';

const EVERY_MS = 60_000; // scraping runs every 5 min at most, so asking once a minute is plenty
const ON_RETURN_MS = 15_000; // back in the browser tab: ask right away if the last answer is older

const timeLabel = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

async function serverVersion(): Promise<string> {
  const res = await fetch('/api/changes', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // logged out: next time
  return ((await res.json()) as { v: string }).v;
}

/** when the server was last asked (answered or not) */
const lastAsked = (query: Query<string>) => Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt);
/** asks again on mount / on coming back only if the last answer is older than `ms` */
const olderThan = (ms: number) => (query: Query<string>) => (Date.now() - lastAsked(query) > ms ? 'always' : false);
/**
 * A minute after the server was last asked, by whichever page. A page's timer starts when it's
 * opened: counting a whole minute from there would wait up to two after the last check.
 */
const untilDue = (query: Query<string>) => {
  const asked = lastAsked(query);
  return asked ? Math.max(1000, EVERY_MS - (Date.now() - asked)) : EVERY_MS;
};

// Keeps the page current without loading it again on every visit. A page you go back to comes
// from the client cache (staleTimes in next.config), so switching tabs is instant. While the tab
// is visible, the server is asked once a minute whether anything changed (lib/changes.ts); only
// then router.refresh() brings the new data into this page, in place (its <Suspense> keys stay,
// so no skeleton). That refresh also drops the other pages from the cache: they load fresh once.
//
// The data version is one query for the whole visit (every page's header shares it): the minute is
// the visit's, not the page's, and a page opened within it doesn't ask again.
export function AutoRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { data: version, dataUpdatedAt } = useQuery({
    queryKey: ['data-version'],
    queryFn: serverVersion,
    refetchInterval: untilDue, // while the tab is visible
    refetchOnMount: olderThan(EVERY_MS),
    refetchOnWindowFocus: olderThan(ON_RETURN_MS), // the tab shown again
    refetchOnReconnect: 'always', // back online
  });

  // The version this page shows. A new one from the server refreshes the page; the first one (the
  // visit's first page) or the one the page had when it was shown (another page, or this one coming
  // back) is only learnt.
  const shows = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (version === undefined) return;
    if (shows.current !== undefined && version !== shows.current) startTransition(() => router.refresh());
    shows.current = version;
  }, [version, router]);
  useEffect(
    () => () => {
      shows.current = undefined; // left (it stays mounted, hidden, for going back)
    },
    [],
  );

  return (
    <p
      className="m-0 flex items-center gap-1.5 text-[13px] text-muted-foreground tabular-nums max-[480px]:hidden"
      aria-live="polite"
    >
      <span className={cn('size-[7px] rounded-full bg-success', pending && 'animate-pulse')} aria-hidden="true" />
      {!dataUpdatedAt ? 'Live' : pending ? 'Updating…' : `Updated ${timeLabel.format(dataUpdatedAt)}`}
    </p>
  );
}
