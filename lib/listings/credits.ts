// ScrapingAnt's credits, for Settings: what the scrapers of the boards read through it (their `blocksServer`)
// spend in a month, from how often the schedule runs them, and what's left. Shared by the server and the browser.
import { byId } from '../boards';
import type { Scraper } from '../db/repos/scrapers';
import { kindOf } from './kinds';
import { callsOf, EARLY_MS, intervalOf } from './quota';
import type { ScrapeSettings } from './settings';

/** a page through a datacenter proxy; through a residential one (its board's `residential`), measured October 2026 */
export const DATACENTER_CREDITS = 1;
export const RESIDENTIAL_CREDITS = 25;

const MONTH_DAYS = 30;
const WEEKEND_DAYS = (MONTH_DAYS * 2) / 7;

/** The plan's credits (lib/scraping-ant.ts: creditsLeft). */
export type CreditsLeft = { total: number; left: number; resetsAt: string };
/** What Settings gets: the credits left, null without a key, or why they couldn't be read. */
export type CreditsAnswer = { credits: CreditsLeft | null } | { error: string };

type CreditScraper = Pick<Scraper, 'id' | 'name' | 'kind' | 'src' | 'enabled' | 'config' | 'lastRunAt'>;
type Schedule = Pick<ScrapeSettings, 'everyMinutes' | 'weekendEveryMinutes' | 'fromHour' | 'toHour' | 'keywords'>;

/**
 * Minutes between a scraper's runs on a schedule of `step` minutes: the first run at or past its interval, less
 * the 5 minutes it's due early (lib/listings/quota.ts); without an interval, every run.
 */
export function runsEvery(interval: number | null, step: number): number {
  if (!interval) return step;
  return step * Math.max(1, Math.ceil((interval - EARLY_MS / 60_000) / step));
}

/** Credits a month, per enabled scraper of a board read through ScrapingAnt: its pages only, not its ads. */
export function monthlyCredits(
  scrapers: readonly CreditScraper[],
  schedule: Schedule,
): { id: string; name: string; credits: number }[] {
  const { fromHour, toHour, keywords } = schedule;
  const minutesADay = (fromHour === toHour ? 24 : (toHour - fromHour + 24) % 24) * 60;
  return scrapers
    .filter((scraper) => scraper.enabled && kindOf(scraper.kind).proxied)
    .map((scraper) => {
      const interval = intervalOf(scraper, scrapers, keywords);
      const runs =
        (minutesADay / runsEvery(interval, schedule.everyMinutes)) * (MONTH_DAYS - WEEKEND_DAYS) +
        (minutesADay / runsEvery(interval, schedule.weekendEveryMinutes)) * WEEKEND_DAYS;
      const perPage = byId(scraper.src)?.residential?.test(scraper.config.url)
        ? RESIDENTIAL_CREDITS
        : DATACENTER_CREDITS;
      return { id: scraper.id, name: scraper.name, credits: Math.round(runs * callsOf(scraper, keywords) * perPage) };
    });
}

/** What the scrapers would spend from now until the plan's credits reset, at their monthly pace. */
export const creditsUntil = (monthly: number, resetsAt: string, now = Date.now()) =>
  Math.round((monthly * Math.max(0, Date.parse(resetsAt) - now)) / (MONTH_DAYS * 86_400_000));
