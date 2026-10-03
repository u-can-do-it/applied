'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/shared/cn';
import { kindOf } from '@/lib/listings/kinds';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { ScraperStatus } from '@/features/scraping/scraper-status';

/** Each scraper's last run: when, what it found, kept and added, or what went wrong. */
export function ScraperResults({ scrapers }: { scrapers: Scraper[] }) {
  if (!scrapers.length)
    return <p className="my-1.5 text-xs text-muted-foreground">No scrapers (Settings → Scrapers).</p>;
  return (
    <ul className="m-0 list-none border-t p-0">
      {scrapers.map((scraper) => (
        <li key={scraper.id} className={cn('border-b py-2 text-sm', !scraper.enabled && 'opacity-55')}>
          <strong>{scraper.name}</strong> <Badge variant="quiet">{kindOf(scraper.kind).label}</Badge>
          {!scraper.enabled && <span className="text-xs text-muted-foreground"> · off</span>}
          <ScraperStatus scraper={scraper} />
        </li>
      ))}
    </ul>
  );
}
