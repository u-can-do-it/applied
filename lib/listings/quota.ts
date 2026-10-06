// A board whose API has a quota of calls (its listing's minutesPerCall): the schedule runs its scrapers as
// often as their calls allow, on average one call per that many minutes over all of them; the scheduled runs
// in between skip them, as do the ones in the first minutes of an hour when its API turns calls away then
// (skipHourStart). A run you start yourself takes them anyway (and counts: the next scheduled one waits
// from it). Shared by the server (lib/listings/pipeline/fetch.ts) and Settings (when it runs next).
import type { Scraper } from '../db/repos/scrapers';
import type { Zone } from '../dates';
import { kindOf } from './kinds';
import { expandUrl } from './match';
import { inHours, type ScrapeSettings } from './settings';

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

/** In the first minutes of an hour (UTC), when the board's API turns calls away (Adzuna answers 503 at :00). */
function atHourStart(scraper: Pick<QuotaScraper, 'kind'>, at: number) {
  const skip = kindOf(scraper.kind).skipHourStart;
  return skip !== undefined && new Date(at).getUTCMinutes() < skip;
}

export function isDue(scraper: QuotaScraper, scrapers: readonly QuotaScraper[], keywords: string[], now = Date.now()) {
  if (atHourStart(scraper, now)) return false;
  const next = nextRunAt(scraper, scrapers, keywords);
  return next === null || now >= next;
}

/**
 * When the schedule runs a scraper its quota holds back, for Settings: the quota's time, moved to the next
 * fromHour:00 when that falls outside the hours, then past the first minutes of an hour its API skips.
 * null: not held back, or the schedule is paused.
 */
export function nextScheduledAt(
  scraper: QuotaScraper,
  scrapers: readonly QuotaScraper[],
  settings: Pick<ScrapeSettings, 'enabled' | 'fromHour' | 'toHour' | 'keywords'>,
  zone: Pick<Zone, 'hour'>,
): number | null {
  const next = nextRunAt(scraper, scrapers, settings.keywords);
  if (next === null || !settings.enabled) return null;
  // minute by minute (zones with half-hour offsets too), a day and a half at most
  let at = Math.ceil(next / 60_000) * 60_000;
  for (
    let step = 0;
    step < 36 * 60 && (!inHours(zone.hour(at), settings.fromHour, settings.toHour) || atHourStart(scraper, at));
    step++
  )
    at += 60_000;
  return at;
}
