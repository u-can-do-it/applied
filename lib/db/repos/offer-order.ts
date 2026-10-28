import 'server-only';
import { asc, desc, sql } from 'drizzle-orm';
import { aiVerdicts, offersUnique } from '../schema';
import type { JobFilter } from './offers';

// The order of the job lists (lib/db/repos/offers.ts): newest first, a search's best match first, or by
// day with each day's best fit first.

/** a job's day, the day it was first seen in time zone `tz` */
export const dayOf = (tz: string) => sql`(${offersUnique.firstSeen} at time zone ${tz})::date`;

/** a search's jobs as {job id: its place}, one parameter however many there are */
export const placeIn = (ranked: string[]) =>
  sql`(${JSON.stringify(Object.fromEntries(ranked.map((jobId, place) => [jobId, place])))}::jsonb ->> ${offersUnique.jobId})::int`;

// newest first; the board and id make the order total, so pages don't overlap
export const newestFirst = [desc(offersUnique.firstSeen), asc(offersUnique.src), asc(offersUnique.id)];

/**
 * The best fit first: the matches by score, then the jobs not judged (no score), then the rejected ones
 * by score (as the fit badge, lib/shared/fit.ts, a rejected job is poor whatever its score).
 */
const bestFitFirst = [asc(sql`${aiVerdicts.match} is false`), sql`${aiVerdicts.score} desc nulls last`];

/**
 * A search's best match first, the others newest first; `byFit`: by day in time zone `tz`, newest day
 * first, each day's best fit first (newest first without the verdicts joined, `judged`).
 */
export const order = (filter: JobFilter, tz: string, judged: boolean) => {
  if (filter.byFit) return judged ? [desc(dayOf(tz)), ...bestFitFirst, ...newestFirst] : newestFirst;
  return filter.ranked && !filter.byDate ? [asc(placeIn(filter.ranked)), ...newestFirst] : newestFirst;
};
