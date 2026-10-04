import 'server-only';
import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, max, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { offers, offersUnique, scrapeRuns, type ScrapeRunRow } from '../schema';
import type { RunWindow } from './offers';

// The run log: what each scrape found, saved and sent. Two weeks of it.

export type ScrapeRun = ScrapeRunRow;
type Counts = Pick<ScrapeRun, 'found' | 'kept' | 'added' | 'fresh' | 'notified' | 'errors'>;

const KEEP_MS = 14 * 86400_000;

export async function start(trigger: string): Promise<number> {
  const [{ id }] = await db().insert(scrapeRuns).values({ trigger }).returning({ id: scrapeRuns.id });
  return id;
}

/** The run's counts, and the log trimmed to two weeks. */
export async function finish(id: number, counts: Counts) {
  await db()
    .update(scrapeRuns)
    // the database's clock, as the offers' first_seen (addedPerBoard compares them)
    .set({ ...counts, finishedAt: sql`now()` })
    .where(eq(scrapeRuns.id, id));
  await db()
    .delete(scrapeRuns)
    .where(lt(scrapeRuns.startedAt, new Date(Date.now() - KEEP_MS).toISOString()));
}

/** What the AI check and the notifications did, after the run itself (they can finish later). */
export async function update(id: number, fields: Partial<Pick<ScrapeRun, 'notified' | 'matched' | 'errors'>>) {
  await db().update(scrapeRuns).set(fields).where(eq(scrapeRuns.id, id));
}

/** The newest first. */
export function list(limit = 12): Promise<ScrapeRun[]> {
  return db().select().from(scrapeRuns).orderBy(desc(scrapeRuns.startedAt)).limit(limit);
}

/**
 * The offers each finished run added, per board. Not stored with the run: an offer's first_seen is
 * when the run that found it saved it, so a run's are the ones first seen while it ran (one run at
 * a time, under the lock).
 */
export async function addedPerBoard(runIds: number[]): Promise<{ runId: number; board: string; added: number }[]> {
  if (!runIds.length) return [];
  return db()
    .select({ runId: scrapeRuns.id, board: offers.src, added: count() })
    .from(scrapeRuns)
    .innerJoin(offers, and(gte(offers.firstSeen, scrapeRuns.startedAt), lte(offers.firstSeen, scrapeRuns.finishedAt)))
    .where(inArray(scrapeRuns.id, runIds))
    .groupBy(scrapeRuns.id, offers.src)
    .orderBy(desc(count()));
}

/**
 * The newest finished run that brought a new job: one whose earliest offer (offers_unique) was first
 * seen while it ran, the window Activity counts a run's offers in (addedPerBoard above). The lists
 * mark those jobs "new". Not just `added > 0`: a run that only found another board's offer of a known
 * job added an offer but no job. Null: no run in the log brought one.
 */
export async function latestWithNewJobs(): Promise<RunWindow | null> {
  const finished = isNotNull(scrapeRuns.finishedAt);
  // the newest job first seen during a finished run (runs don't overlap: one at a time, under the lock)
  const newest = db()
    .select({ at: max(offersUnique.firstSeen) })
    .from(offersUnique)
    .innerJoin(
      scrapeRuns,
      and(
        finished,
        gte(offersUnique.firstSeen, scrapeRuns.startedAt),
        lte(offersUnique.firstSeen, scrapeRuns.finishedAt),
      ),
    );
  const run = first(
    await db()
      .select({ startedAt: scrapeRuns.startedAt, finishedAt: scrapeRuns.finishedAt })
      .from(scrapeRuns)
      .where(and(finished, sql`(${newest}) between ${scrapeRuns.startedAt} and ${scrapeRuns.finishedAt}`))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(1),
  );
  return run?.finishedAt ? { startedAt: run.startedAt, finishedAt: run.finishedAt } : null;
}
