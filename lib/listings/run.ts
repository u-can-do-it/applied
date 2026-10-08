import 'server-only';
import { after } from 'next/server';
import { AI_BUDGET_MS, SCRAPE_LOCK_SECONDS } from '../budgets';
import { activeChannels } from '../channels';
import * as queueRepo from '../db/repos/notify-queue';
import * as runsRepo from '../db/repos/scrape-runs';
import * as scrapersRepo from '../db/repos/scrapers';
import * as settingsRepo from '../db/repos/scrape-settings';
import * as stateRepo from '../db/repos/scrape-state';
import { log } from '../log';
import { message } from '../shared/errors';
import { aiFilter } from './pipeline/ai-filter';
import { newJobs, selectAnnouncable } from './pipeline/announce';
import { fetchListings, scrapersToRun, type BrowserPages } from './pipeline/fetch';
import type { RunError, RunSummary } from './pipeline/model';
import { notify, type Notified } from './pipeline/notify';
import { addedPerScraper, scraperOutcomes, summarize } from './pipeline/outcomes';
import { pickOwners } from './pipeline/owners';
import { ingest, recordOutcomes } from './pipeline/persist';
import type { ScrapeSettings } from './settings';
import type { Trigger } from './triggers';

export type { RunSummary } from './pipeline/model';

// One run = every enabled scraper: fetch, parse, filter, save new offers, queue the new jobs for
// the notification channels (Telegram, push), check them against the active AI profile and send
// the matches (unless muted).
// The steps are in ./pipeline; this file puts them in order, under the lock, with the run log.

const EMPTY = { found: 0, kept: 0, added: 0, fresh: 0, notified: 0, errors: [] as RunError[], ms: 0 };

/**
 * Runs every enabled scraper. `locked`: the caller already took the lock (the endpoint does,
 * so it can answer "busy" right away). `background`: the AI check and the notifications go on
 * after the answer (the "Scrape now" button doesn't wait for OpenAI). `scraper`: that one only
 * (its run button in Settings), switched on or not. `browser`: these scrapers (on or not), from the
 * pages a browser fetched for them (the bookmarklet), not fetched here.
 */
export async function runAll(
  trigger: Trigger,
  opts: {
    locked?: boolean;
    background?: boolean;
    scraper?: string;
    browser?: { scrapers: readonly string[]; pages: BrowserPages };
  } = {},
): Promise<RunSummary> {
  if (!opts.locked && !(await stateRepo.lock(SCRAPE_LOCK_SECONDS)))
    return { ...EMPTY, skipped: 'Another run is still going.' };
  const startedAt = Date.now();
  let runId: number | null = null;
  let unlockLater = false;
  try {
    const [settings, scrapers] = await Promise.all([settingsRepo.get(), scrapersRepo.list()]);
    const { browser } = opts;
    const chosen = browser
      ? scrapers.filter((scraper) => browser.scrapers.includes(scraper.id))
      : opts.scraper
        ? scrapers.filter((scraper) => scraper.id === opts.scraper)
        : scrapersToRun(scrapers, settings, trigger === 'cron');
    if ((browser || opts.scraper) && !chosen.length) return { ...EMPTY, skipped: 'This scraper no longer exists.' };
    runId = await runsRepo.start(trigger);

    const fetched = await fetchListings(chosen, settings, browser?.pages);
    const owners = pickOwners(fetched);
    const added = await ingest(owners);
    const fresh = selectAnnouncable(added, owners, settings);
    const addedBy = addedPerScraper(added, owners);
    const outcomes = scraperOutcomes(fetched, addedBy);
    await recordOutcomes(outcomes);

    const summary = summarize({ fetched, owners, added, fresh, ms: Date.now() - startedAt });
    const { errors } = summary;
    for (const failed of errors)
      log.warn('Scraper failed', { scrapeRunId: runId, trigger, scraper: failed.scraper, error: failed.error });
    await runsRepo.finish(runId, {
      found: summary.found,
      kept: summary.kept,
      added: summary.added,
      fresh: summary.fresh,
      notified: 0,
      errors,
    });

    const jobs = newJobs(added);
    // the announced ones wait in the queue; the channels get the matches
    const send = settings.notify && (await activeChannels()).length > 0;
    if (send) await queueRepo.enqueue(fresh);
    const tail = aiTail({ runId, settings, jobs, send, errors, deadline: startedAt + AI_BUDGET_MS });

    if (opts.background && (jobs.length || fresh.length)) {
      after(() =>
        tail()
          .catch((failure: unknown) => {
            log.error('Scrape run: AI check / notifications failed', { scrapeRunId: runId, trigger, error: failure });
          })
          .finally(() => stateRepo.unlock().catch(() => {})),
      );
      unlockLater = true; // only once after() took it: if that throws, `finally` below unlocks
      return { ...summary, notifyLater: true };
    }
    const { sent, more } = await tail();
    return { ...summary, notified: sent, errors: [...errors, ...more], ms: Date.now() - startedAt };
  } catch (error) {
    // the database or something unexpected: keep it in the run log, so Settings shows it
    log.error('Scrape run failed', { scrapeRunId: runId, trigger, error });
    const errors = [{ scraper: 'Run', error: message(error) }];
    if (runId !== null) await runsRepo.finish(runId, { ...EMPTY, errors }).catch(() => {});
    return { ...EMPTY, errors, ms: Date.now() - startedAt };
  } finally {
    if (!unlockLater) await stateRepo.unlock().catch(() => {});
  }
}

/**
 * Steps 6 and 7 (aiFilter → notify), then what they did into the run log. Returned as a function:
 * it runs now, or after the answer (`background`).
 */
function aiTail(run: {
  runId: number;
  settings: ScrapeSettings;
  jobs: string[];
  send: boolean;
  errors: RunError[];
  deadline: number;
}) {
  return async (): Promise<{ sent: number; more: RunError[] }> => {
    const more: RunError[] = [];
    const note = (scraper: string, error?: string | null, warning = false) => {
      if (error && !more.some((had) => had.error === error))
        more.push({ scraper, error, ...(warning && { warning: true as const }) });
    };
    const filtered = await aiFilter(run.settings, run.jobs, run.deadline);
    note('AI', filtered.error);
    const notified: Notified = run.send ? await notify({ deadline: run.deadline }) : { sent: 0, matched: null };
    note('AI / Notify', notified.error);
    // a channel failed but another sent them: a warning, not a failure
    if (notified.warning) note('Notify', `Sent ${notified.sent}; ${notified.warning}`, true);
    if (filtered.checked || run.send || more.length)
      await runsRepo.update(run.runId, {
        notified: notified.sent,
        matched: filtered.matched,
        errors: [...run.errors, ...more],
      });
    return { sent: notified.sent, more };
  };
}
