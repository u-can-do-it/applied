import 'server-only';
import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, max, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { jobLinks, offers, offersUnique, scrapeRuns, type ScrapeRunRow } from '../schema';
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

/** Which runs the log shows: the ones a trigger started, or the ones where something failed. */
export type RunsOf = { trigger?: string; failed?: boolean };

// something failed: an error that isn't a warning (a warning went through all the same)
const failed = sql<boolean>`exists (select 1 from jsonb_array_elements(${scrapeRuns.errors}) as failure where (failure->>'warning') is distinct from 'true')`;

/** One page of the log's runs (`index` from 0), the newest first. */
export function page(of: RunsOf, index: number, size: number): Promise<ScrapeRun[]> {
  return db()
    .select()
    .from(scrapeRuns)
    .where(and(of.trigger ? eq(scrapeRuns.trigger, of.trigger) : undefined, of.failed ? failed : undefined))
    .orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id))
    .limit(size)
    .offset(index * size);
}

/** How many runs the log has: in all, per trigger, and with errors. */
export async function counts(): Promise<{ all: number; failed: number; byTrigger: Record<string, number> }> {
  const rows = await db()
    .select({
      trigger: scrapeRuns.trigger,
      all: count(),
      failed: sql<number>`(count(*) filter (where ${failed}))::int`,
    })
    .from(scrapeRuns)
    .groupBy(scrapeRuns.trigger);
  return {
    all: rows.reduce((sum, row) => sum + row.all, 0),
    failed: rows.reduce((sum, row) => sum + row.failed, 0),
    byTrigger: Object.fromEntries(rows.map((row) => [row.trigger, row.all])),
  };
}

/**
 * The offers each finished run added, per board, and how many of those were another offer of a job
 * known before the run (`known`: the lists show that job where it already was, not as new). Not
 * stored with the run: an offer's first_seen is when the run that found it saved it, so a run's are
 * the ones first seen while it ran (one run at a time, under the lock).
 */
export async function addedPerBoard(
  runIds: number[],
): Promise<{ runId: number; board: string; added: number; known: number }[]> {
  if (!runIds.length) return [];
  return db()
    .select({
      runId: scrapeRuns.id,
      board: offers.src,
      added: count(),
      known: sql<number>`(count(*) filter (where ${offersUnique.firstSeen} < ${scrapeRuns.startedAt}))::int`,
    })
    .from(scrapeRuns)
    .innerJoin(offers, and(gte(offers.firstSeen, scrapeRuns.startedAt), lte(offers.firstSeen, scrapeRuns.finishedAt)))
    // the offer's job, its earliest offer: first seen before the run, the job was known
    .leftJoin(jobLinks, eq(jobLinks.titleKey, offers.titleKey))
    .innerJoin(offersUnique, eq(offersUnique.jobId, sql`coalesce(${jobLinks.jobId}, ${offers.titleKey})`))
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
