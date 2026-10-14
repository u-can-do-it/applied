import 'server-only';
import { isAdText, type Ad } from '../../ads/details';
import { readPosting } from '../../ads/linkedin';
import { linkedin } from '../../boards/linkedin';
import * as alertsRepo from '../../db/repos/alert-jobs';
import * as offersRepo from '../../db/repos/offers';
import type { Scraper } from '../../db/repos/scrapers';
import { Deferred } from '../../pace';
import { message } from '../../shared/errors';
import type { AlertOutcome } from '../alert-email';
import { seniorityOf } from '../extract';
import { areaTest, keywordTest, titleTest } from '../match';
import { linkedinRemote } from '../parsers/linkedin';
import type { ScrapeSettings } from '../settings';
import type { Found } from '../types';
import { MAX_READS } from './ad-check';
import type { ScrapeResult } from './fetch';
import type { Fetched } from './model';

// Part of step 1, after the scrapers: the jobs LinkedIn's alert emails named (alert_jobs, from
// POST /api/alerts/linkedin). An email gives only their ids, so each one's posting is read
// (lib/ads/linkedin.ts): its title, company, place and ad, which the filters check as they do the LinkedIn
// scrapers' offers (a keyword in the title or the ad). One a scraper has (saved before, or kept in this
// run) isn't read. Read as the ad check reads: one at a time, at most MAX_READS a run, none after one
// that fails or comes back empty, nor past the deadline or LinkedIn's batch (lib/pace.ts); the rest wait
// for the next run, or a follow-up's.

/** Their place in a run: a scraper of their own, not in the scrapers table (its outcome isn't saved). */
export const ALERTS: Scraper = {
  id: 'linkedin-alert-emails',
  position: 0,
  name: 'LinkedIn alert emails',
  src: linkedin.id,
  kind: linkedin.id,
  enabled: true,
  config: linkedin.listing.defaults,
  mark: 0, // has run: what it keeps is announced
  lastRunAt: null,
  lastStatus: null,
  lastFound: null,
  lastKept: null,
  lastNew: null,
  lastError: null,
  lastMs: null,
  lastProxied: null,
  lastCompleteAt: null,
  followUp: null,
};

/** waiting jobs looked at in a run: the ones a scraper has cost nothing, the rest are read up to MAX_READS */
const BATCH = 100;

export type Alerts = {
  fetched: Fetched;
  /** saves what became of the jobs: once the offers are saved, so a run that fails before reads them again */
  settle: () => Promise<void>;
};

/** Null: no job waits. `scraped`: the offers the scrapers kept in this run. Never throws. */
export async function fetchAlerts(
  settings: ScrapeSettings,
  scraped: readonly Found[],
  deadline: number,
): Promise<Alerts | null> {
  const startedAt = Date.now();
  const src = linkedin.id;
  const outcomes = new Map<string, AlertOutcome>();
  const kept: Found[] = [];
  const skipped = { keyword: 0, area: 0, ignored: 0 };
  let waiting: string[];
  let error: string | null = null;
  try {
    waiting = await alertsRepo.waiting(src, BATCH);
    if (!waiting.length) return null;
    const known = await offersRepo.knownIds(src, waiting);
    for (const offer of scraped) if (offer.src === src) known.add(offer.id);
    for (const id of waiting) if (known.has(id)) outcomes.set(id, 'known');
  } catch (failure) {
    return {
      fetched: { scraper: ALERTS, result: failed(message(failure), startedAt) },
      settle: () => Promise.resolve(),
    };
  }

  const { checkKeyword, checkLocation } = linkedin.listing.defaults;
  const named = checkKeyword ? keywordTest(settings.keywords) : null;
  const inArea = checkLocation ? areaTest(settings) : null;
  const ignored = titleTest(settings.ignore);
  for (const id of waiting.filter((id) => !outcomes.has(id)).slice(0, MAX_READS)) {
    if (Date.now() >= deadline) break;
    let posting: Ad & { title: string };
    try {
      posting = await readPosting(id);
      if (!posting.title || !isAdText(posting.text)) throw new Error('it came back empty (a login wall?)');
    } catch (failure) {
      if (!(failure instanceof Deferred)) error = `job ${id}: ${message(failure)}`;
      break;
    }
    const offer = toOffer(id, posting);
    let outcome: AlertOutcome = 'skipped';
    if (named && !named([offer.title, posting.text])) skipped.keyword++;
    else if (inArea && !inArea(offer)) skipped.area++;
    else if (ignored(offer.title)) skipped.ignored++;
    else {
      kept.push(offer);
      outcome = 'kept';
    }
    outcomes.set(id, outcome);
  }

  const left = waiting.length - outcomes.size;
  const result: ScrapeResult = {
    ok: !error || outcomes.size > 0,
    error: error && `reading the jobs: ${error}; ${left} wait for the next run`,
    found: outcomes.size,
    kept,
    skipped,
    pages: [],
    proxied: 0,
    complete: !left,
    unread: { pages: [], ads: [] }, // they wait in alert_jobs
    ms: Date.now() - startedAt,
  };
  return { fetched: { scraper: ALERTS, result }, settle: () => alertsRepo.settle(src, outcomes) };
}

/** The job as a LinkedIn card has it. */
function toOffer(id: string, posting: Ad & { title: string }): Found {
  const place = posting.details.location ?? '';
  return {
    src: linkedin.id,
    id,
    title: posting.title,
    company: posting.details.company ?? null,
    seniority: seniorityOf(posting.title),
    remote: linkedinRemote(posting.title, place),
    url: `https://www.linkedin.com/jobs/view/${id}`,
    locations: place ? [place] : [],
    skills: [],
  };
}

const failed = (error: string, startedAt: number): ScrapeResult => ({
  ok: false,
  error,
  found: 0,
  kept: [],
  skipped: { keyword: 0, area: 0, ignored: 0 },
  pages: [],
  proxied: 0,
  complete: false,
  unread: { pages: [], ads: [] },
  ms: Date.now() - startedAt,
});
