'use client';

import Link from 'next/link';
import { CheckIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useZone } from '@/components/time-zone';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { seconds } from '@/lib/shared/format';

/** How a scraper's last run went. */
export function ScraperStatus({ scraper }: { scraper: Scraper }) {
  const { formatTime } = useZone();
  if (!scraper.lastRunAt)
    return (
      <p className="m-0 mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
        Not run yet{scraper.mark === null ? ' · its first run only saves (no notifications)' : ''}
      </p>
    );
  const when = formatTime(scraper.lastRunAt);
  if (scraper.lastStatus === 'error' && !scraper.lastFound) {
    return (
      <p className="m-0 mt-0.5 text-xs [overflow-wrap:anywhere]">
        <span className="text-warning">
          <XIcon role="img" aria-label="Failed" /> {when} · {scraper.lastError}
        </span>
      </p>
    );
  }
  return (
    <p className="m-0 mt-0.5 text-xs [overflow-wrap:anywhere]">
      <CheckIcon className="text-success" role="img" aria-label="OK" /> {when} · {scraper.lastFound} on the page ·{' '}
      {scraper.lastKept} kept · {scraper.lastNew} new
      {scraper.lastMs !== null && <span className="text-muted-foreground"> · {seconds(scraper.lastMs, 1)}</span>}
      {scraper.lastError && (
        <span className="text-warning">
          {' · '}
          <TriangleAlertIcon /> {scraper.lastError}
        </span>
      )}
      {scraper.mark === null && <span className="text-muted-foreground"> · next run only saves</span>}
    </p>
  );
}

/**
 * Settings' line about a scraper: whether its last run went through (the details are on Activity), and when
 * it runs next if its board's quota of calls holds it back (`nextAt`).
 */
export function ScraperBrief({ scraper, nextAt }: { scraper: Scraper; nextAt?: number | null }) {
  const { formatTime } = useZone();
  const firstRun = scraper.mark === null && (
    <span className="text-muted-foreground"> · its next run only saves (no notifications)</span>
  );
  // a time already past still holds: the next run is after it
  const waits = scraper.enabled && nextAt && (
    <span className="text-muted-foreground"> · runs again after {formatTime(nextAt)} (its board’s quota of calls)</span>
  );
  if (!scraper.lastRunAt) return <p className="m-0 mt-0.5 text-xs text-muted-foreground">Not run yet{firstRun}</p>;
  const failed = scraper.lastStatus === 'error' || scraper.lastError;
  return (
    <p className="m-0 mt-0.5 text-xs">
      {failed ? (
        <span className="text-warning">
          <TriangleAlertIcon /> The last run ({formatTime(scraper.lastRunAt)}) had a problem:{' '}
          <Link href="/activity" className="text-brand underline-offset-4 hover:underline">
            see Activity
          </Link>
        </span>
      ) : (
        <span className="text-muted-foreground">
          <CheckIcon className="text-success" role="img" aria-label="OK" /> Last run {formatTime(scraper.lastRunAt)}:{' '}
          {scraper.lastNew} new
        </span>
      )}
      {waits}
      {firstRun}
    </p>
  );
}
