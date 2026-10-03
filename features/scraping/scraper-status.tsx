'use client';

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
        Not run yet{scraper.mark === null ? ' · its first run only saves (no Telegram)' : ''}
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
