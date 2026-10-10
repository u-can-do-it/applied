import type { Queued } from '../../db/repos/notify-queue';
import type { ScraperOutcome } from '../../db/repos/scrapers';
import { offerKey, type AddedOffer, type Fetched, type Owners, type RunError, type RunSummary } from './model';

// Step 5, the outcomes (pure): what each scraper's run did, its new watermark, and the run's counts.
// recordOutcomes (persist.ts) saves them.

/** How many of the new offers each scraper owns, by scraper id. */
export function addedPerScraper(added: readonly AddedOffer[], owners: Owners): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of added) {
    const own = owners.get(offerKey(row));
    if (own) counts.set(own.scraper.id, (counts.get(own.scraper.id) ?? 0) + 1);
  }
  return counts;
}

export type ScraperRunOutcome = { id: string; outcome: ScraperOutcome };

export function scraperOutcomes(
  fetched: readonly Fetched[],
  addedBy: ReadonlyMap<string, number>,
): ScraperRunOutcome[] {
  return fetched.map(({ scraper, result }) => ({
    id: scraper.id,
    outcome: {
      ok: result.ok,
      found: result.found,
      kept: result.kept.length,
      added: addedBy.get(scraper.id) ?? 0,
      error: result.error,
      ms: result.ms,
      proxied: result.proxied,
      // the watermark moves only on a successful run; null -> "has run" even with nothing dated
      mark: result.ok ? Math.max(scraper.mark ?? -Infinity, result.maxSort ?? -Infinity, 0) : scraper.mark,
    },
  }));
}

/** The scrapers that failed (in part), for the run log. */
export const runErrors = (fetched: readonly Fetched[]): RunError[] =>
  fetched.flatMap(({ scraper, result }) => (result.error ? [{ scraper: scraper.name, error: result.error }] : []));

/** The run's counts, before the AI check and the notifications. */
export function summarize(run: {
  fetched: readonly Fetched[];
  owners: Owners;
  added: readonly AddedOffer[];
  fresh: readonly Queued[];
  ms: number;
}): RunSummary {
  return {
    found: run.fetched.reduce((sum, { result }) => sum + result.found, 0),
    kept: run.owners.size,
    added: run.added.length,
    fresh: run.fresh.length,
    notified: 0,
    errors: runErrors(run.fetched),
    ms: run.ms,
  };
}
