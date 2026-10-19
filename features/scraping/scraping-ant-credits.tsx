'use client';

import { use } from 'react';
import { useZone } from '@/components/time-zone';
import { creditsUntil, monthlyCredits, type CreditsAnswer } from '@/lib/listings/credits';
import type { ScrapeSettings } from '@/lib/listings/settings';
import type { Scraper } from '@/lib/db/repos/scrapers';

// The scrapers list's line about ScrapingAnt: the credits left (read when the page loads) and what the scrapers
// of the boards read through it spend in a month at their intervals (lib/listings/credits.ts).

const count = (credits: number) => credits.toLocaleString('en-US');

export function ScrapingAntCredits({
  answer,
  scrapers,
  schedule,
}: {
  answer: Promise<CreditsAnswer>;
  scrapers: Scraper[];
  schedule: Pick<ScrapeSettings, 'everyMinutes' | 'weekendEveryMinutes' | 'fromHour' | 'toHour' | 'keywords'>;
}) {
  const { formatDayOf } = useZone();
  const result = use(answer);
  const each = monthlyCredits(scrapers, schedule);
  if (!each.length) return null;
  const monthly = each.reduce((sum, scraper) => sum + scraper.credits, 0);
  const credits = 'credits' in result ? result.credits : null;
  const needed = credits ? creditsUntil(monthly, credits.resetsAt) : 0;
  const short = credits && needed > credits.left;
  return (
    <div className="mt-2.5 text-xs text-muted-foreground">
      <p className="m-0">
        <strong className="font-medium text-foreground">ScrapingAnt</strong>:{' '}
        {'error' in result
          ? `can’t tell the credits left (${result.error}).`
          : credits
            ? `${count(credits.left)} of ${count(credits.total)} credits left, until ${formatDayOf(credits.resetsAt)}.`
            : 'no SCRAPINGANT_API_KEY, so these boards’ pages fail.'}{' '}
        Their scrapers spend about {count(monthly)} a month on their pages at these intervals (
        {each.map((scraper) => `${scraper.name} ${count(scraper.credits)}`).join(' · ')}), plus a credit for each ad
        read.
      </p>
      {credits && (monthly > credits.total || short) && (
        <p className="m-0 mt-0.5 text-warning">
          {short
            ? `About ${count(needed)} until then: more than is left. Give them longer intervals (Edit → Runs every).`
            : `More than the plan’s ${count(credits.total)} a month: give them longer intervals (Edit → Runs every).`}
        </p>
      )}
    </div>
  );
}
