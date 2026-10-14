import { byId } from '../../boards';
import type { Scraper } from '../../db/repos/scrapers';
import type { FollowUp } from '../types';
import type { ScrapeResult } from './fetch';

// What a paced board's scraper (lib/pace.ts: LinkedIn) couldn't read in a run, the pages that failed or
// didn't fit the board's batch and the ads its keyword check didn't get to, waits in scrapers.follow_up for
// a follow-up FOLLOW_UP_MINUTES later: those alone, on Supabase Cron's knock between the scheduled runs
// (checkDue), or as the scraper's part of a run due by then. Until then the runs leave the scraper out
// (scrapersToRun), so the backlog isn't asked for again in a burst. Once nothing is left, the scraper's last
// complete run is the one that left it: its pages and its follow-ups' together covered its {since}. After
// MAX_FOLLOW_UPS it's given up, and the next run reads its whole window again.

export const FOLLOW_UP_MINUTES = 5;
/** half an hour of them: a page that fails every time (a changed search) isn't asked for all day */
export const MAX_FOLLOW_UPS = 6;
// Supabase Cron's knocks aren't exactly five minutes apart
const SLACK_MS = 60_000;

export const followUpDue = (followUp: Pick<FollowUp, 'at'>, now = Date.now()) =>
  Date.parse(followUp.at) - SLACK_MS <= now;

/** The scrapers whose follow-up is due, for a run of them alone (Supabase Cron's knock between the runs). */
export const scrapersToFollowUp = (scrapers: readonly Scraper[], now = Date.now()): Scraper[] =>
  scrapers.filter((scraper) => scraper.enabled && scraper.followUp && followUpDue(scraper.followUp, now));

/** A paced board's scrapers get follow-ups; the others' next run reads their whole window again. */
export const followsUp = (scraper: Pick<Scraper, 'src'>) => Boolean(byId(scraper.src)?.pace);

/**
 * After a run of the scraper (`startedAt`; `scraper.followUp`: what the run followed up, if anything): what
 * waits for its next follow-up (null: nothing, or given up), and the run its {since} starts from now on
 * (null: the one before stays).
 */
export function afterRun(
  scraper: Pick<Scraper, 'src' | 'followUp'>,
  result: Pick<ScrapeResult, 'complete' | 'unread'>,
  startedAt: number,
  now = Date.now(),
): { followUp: FollowUp | null; completeAt: string | null } {
  const paced = followsUp(scraper);
  const earlier = paced ? scraper.followUp : null;
  const from = earlier?.from ?? new Date(startedAt).toISOString();
  if (result.complete) return { followUp: null, completeAt: paced ? from : new Date(now).toISOString() };
  const tries = earlier ? earlier.tries + 1 : 0;
  if (!paced || tries >= MAX_FOLLOW_UPS) return { followUp: null, completeAt: null };
  const at = new Date(now + FOLLOW_UP_MINUTES * 60_000).toISOString();
  return { followUp: { from, at, tries, pages: result.unread.pages, ads: result.unread.ads }, completeAt: null };
}
