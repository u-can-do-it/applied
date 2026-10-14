import 'server-only';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { scrapeState, type ScrapeStateRow } from '../schema';

// The scraping machine's state, one row: the run lock, the last call and run, notifications muted, the last
// LinkedIn alert email.

export type ScrapeState = Omit<ScrapeStateRow, 'id'>;

const NONE: ScrapeState = {
  lockedUntil: null,
  lastCallAt: null,
  lastRunAt: null,
  muted: false,
  alertEmailAt: null,
  alertEmailJobs: null,
};

export async function get(): Promise<ScrapeState> {
  const row = first(
    await db()
      .select({
        lockedUntil: scrapeState.lockedUntil,
        lastCallAt: scrapeState.lastCallAt,
        lastRunAt: scrapeState.lastRunAt,
        muted: scrapeState.muted,
        alertEmailAt: scrapeState.alertEmailAt,
        alertEmailJobs: scrapeState.alertEmailJobs,
      })
      .from(scrapeState)
      .limit(1),
  );
  return row ?? NONE;
}

async function patch(fields: Partial<ScrapeState>) {
  await db().update(scrapeState).set(fields).where(eq(scrapeState.id, true));
}

export const markCall = () => patch({ lastCallAt: new Date().toISOString() });
export const setMuted = (muted: boolean) => patch({ muted });
export const unlock = () => patch({ lockedUntil: null });
/** A LinkedIn job alert email came in, with this many jobs in it. */
export const markAlertEmail = (jobs: number) => patch({ alertEmailAt: new Date().toISOString(), alertEmailJobs: jobs });

/**
 * Takes the run lock for `seconds` (and stamps last_run_at, unless `stamp` is false: a follow-up doesn't
 * move the schedule): false = another run holds it. One statement, so of two callers at once only one gets
 * it; a crashed run's lock runs out by itself.
 */
export async function lock(seconds: number, stamp = true): Promise<boolean> {
  const got = await db()
    .update(scrapeState)
    .set({
      lockedUntil: sql`now() + make_interval(secs => ${seconds}::int)`,
      ...(stamp && { lastRunAt: sql`now()` }),
    })
    .where(and(eq(scrapeState.id, true), or(isNull(scrapeState.lockedUntil), lt(scrapeState.lockedUntil, sql`now()`))))
    .returning({ id: scrapeState.id });
  return got.length > 0;
}
