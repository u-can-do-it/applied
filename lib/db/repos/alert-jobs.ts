import 'server-only';
import { and, asc, count, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { AlertOutcome } from '../../listings/alert-email';
import { db } from '../client';
import { alertJobs } from '../schema';

// The jobs LinkedIn's job alert emails named (POST /api/alerts/linkedin); a scrape run reads the waiting
// ones (lib/listings/pipeline/alerts.ts). A month of them, so an email sent again adds nothing.

const KEEP_MS = 30 * 86400_000;
const WEEK_MS = 7 * 86400_000;

/** Adds the jobs not received before, and answers how many those were; forgets what's older than a month. */
export async function add(src: string, ids: string[]): Promise<number> {
  await db()
    .delete(alertJobs)
    .where(lt(alertJobs.receivedAt, new Date(Date.now() - KEEP_MS).toISOString()));
  if (!ids.length) return 0;
  const added = await db()
    .insert(alertJobs)
    .values(ids.map((id) => ({ src, id })))
    .onConflictDoNothing()
    .returning({ id: alertJobs.id });
  return added.length;
}

/** The jobs waiting for a run, the oldest first. */
export async function waiting(src: string, limit: number): Promise<string[]> {
  const rows = await db()
    .select({ id: alertJobs.id })
    .from(alertJobs)
    .where(and(eq(alertJobs.src, src), isNull(alertJobs.outcome)))
    .orderBy(asc(alertJobs.receivedAt), asc(alertJobs.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

/** What a run did with these jobs (by id). */
export async function settle(src: string, outcomes: ReadonlyMap<string, AlertOutcome>) {
  const ids = new Map<AlertOutcome, string[]>();
  for (const [id, outcome] of outcomes) ids.set(outcome, [...(ids.get(outcome) ?? []), id]);
  for (const [outcome, these] of ids)
    await db()
      .update(alertJobs)
      .set({ outcome, doneAt: sql`now()` })
      .where(and(eq(alertJobs.src, src), inArray(alertJobs.id, these)));
}

export type AlertCounts = Record<AlertOutcome | 'waiting', number>;

/** How many jobs wait for a run, and what became of the last week's. */
export async function counts(src: string): Promise<AlertCounts> {
  const rows = await db()
    .select({ outcome: alertJobs.outcome, jobs: count() })
    .from(alertJobs)
    .where(
      and(
        eq(alertJobs.src, src),
        or(isNull(alertJobs.outcome), gte(alertJobs.receivedAt, new Date(Date.now() - WEEK_MS).toISOString())),
      ),
    )
    .groupBy(alertJobs.outcome);
  const total: AlertCounts = { waiting: 0, kept: 0, skipped: 0, known: 0 };
  for (const row of rows) total[row.outcome ?? 'waiting'] = row.jobs;
  return total;
}
