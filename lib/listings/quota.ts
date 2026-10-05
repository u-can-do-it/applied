// A board whose API has a quota of calls (its listing's minutesPerCall): the schedule runs its scrapers as
// often as their calls allow, on average one call per that many minutes over all of them; the scheduled runs
// in between skip them. A run you start yourself takes them anyway (and counts: the next scheduled one waits
// from it). Shared by the server (lib/listings/pipeline/fetch.ts) and Settings (when it runs next).
import type { Scraper } from '../db/repos/scrapers';
import { kindOf } from './kinds';
import { expandUrl } from './match';

type QuotaScraper = Pick<Scraper, 'kind' | 'enabled' | 'config' | 'lastRunAt'>;

// a run's scrapers are recorded a little after it starts, so the next one an interval later finds a little
// less gone: within this, it's due
const EARLY_MS = 5 * 60_000;

/** The calls one run of a scraper makes: one per keyword with {keyword}, per page. */
function callsOf(scraper: QuotaScraper, keywords: string[]): number {
  try {
    return expandUrl(scraper.config.url, keywords, scraper.config.pages).length;
  } catch {
    return 0; // a link that can't be expanded makes no call
  }
}

/** Minutes between two runs of the board's scrapers; null: no quota, every run. */
export function intervalOf(scraper: QuotaScraper, scrapers: readonly QuotaScraper[], keywords: string[]) {
  const perCall = kindOf(scraper.kind).minutesPerCall;
  if (!perCall) return null;
  const calls = scrapers
    .filter((other) => other.enabled && other.kind === scraper.kind)
    .reduce((sum, other) => sum + callsOf(other, keywords), 0);
  return perCall * Math.max(1, calls);
}

/** The earliest a scraper runs again (ms); null: on the next run. */
export function nextRunAt(scraper: QuotaScraper, scrapers: readonly QuotaScraper[], keywords: string[]) {
  const every = intervalOf(scraper, scrapers, keywords);
  if (!every || !scraper.lastRunAt) return null;
  // a failed run waits the same (a used-up quota answers 429 until it resets); Scrape now tries it any time
  return Date.parse(scraper.lastRunAt) + every * 60_000 - EARLY_MS;
}

export function isDue(scraper: QuotaScraper, scrapers: readonly QuotaScraper[], keywords: string[], now = Date.now()) {
  const next = nextRunAt(scraper, scrapers, keywords);
  return next === null || now >= next;
}
