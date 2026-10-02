'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

const EVERY_MS = 60_000; // scraping runs every 5 min at most, so asking once a minute is plenty
const ON_RETURN_MS = 15_000; // back in the browser tab: ask right away if the last answer is older

const timeLabel = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

// For the whole visit (every page's header shares them): the data version the pages show, and
// when the server was last asked.
let known: string | null = null;
let lastCheck = 0;

async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/changes', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as { v: string }).v : null;
  } catch {
    return null; // offline, or logged out: next time
  }
}

// Keeps the page current without loading it again on every visit. A page you go back to comes
// from the client cache (staleTimes in next.config), so switching tabs is instant. While the tab
// is visible, the server is asked once a minute whether anything changed (lib/changes.ts); only
// then router.refresh() brings the new data into this page, in place (its <Suspense> keys stay,
// so no skeleton). That refresh also drops the other pages from the cache: they load fresh once.
export function AutoRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let shown = true; // false once the page is left (it stays mounted, hidden, for going back)
    const check = async () => {
      lastCheck = Date.now();
      const v = await serverVersion();
      if (!shown || v === null) return;
      if (known !== null && v !== known) startTransition(() => router.refresh());
      known = v;
      setCheckedAt(lastCheck);
    };
    const due = (ms: number) => document.visibilityState === 'visible' && Date.now() - lastCheck > ms;

    // the visit's first page: learn the version it shows; another one: ask only if it's been a minute
    if (due(known === null ? 0 : EVERY_MS)) check();
    else setCheckedAt(lastCheck || null);

    // a ticker rather than a 60 s interval: each page restarts this, but the minute is the visit's
    const id = setInterval(() => due(EVERY_MS) && check(), 5_000);
    const onVisible = () => due(ON_RETURN_MS) && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      shown = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, [router]);

  return (
    <p className="live" aria-live="polite">
      <span className={`dot${pending ? ' busy' : ''}`} aria-hidden="true" />
      {checkedAt === null ? 'Live' : pending ? 'Updating…' : `Updated ${timeLabel.format(checkedAt)}`}
    </p>
  );
}
