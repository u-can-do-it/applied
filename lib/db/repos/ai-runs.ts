import 'server-only';
import { and, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { aiRuns, type AiRunRow } from '../schema';

// AI runs: "check the jobs in this date range with this profile version", worked off in slices.

export type Run = AiRunRow;
type NewRun = Pick<
  Run,
  'profileId' | 'version' | 'label' | 'rangeGte' | 'rangeLt' | 'total' | 'status' | 'finishedAt' | 'phase'
>;
export type RunPatch = Partial<Omit<Run, 'id' | 'profileId' | 'createdAt'>>;

/** The profile's newest run. */
export async function latest(profileId: string): Promise<Run | null> {
  return first(
    await db().select().from(aiRuns).where(eq(aiRuns.profileId, profileId)).orderBy(desc(aiRuns.createdAt)).limit(1),
  );
}

export async function insert(run: NewRun): Promise<Run> {
  const [row] = await db().insert(aiRuns).values(run).returning();
  return row;
}

/** Changes the run (if `where` holds too); answers with it as changed, or nothing if it didn't match. */
export async function patch(id: string, fields: RunPatch, where?: SQL): Promise<Run[]> {
  return db()
    .update(aiRuns)
    .set(fields)
    .where(and(eq(aiRuns.id, id), where))
    .returning();
}

/**
 * The run's lock until `until`, if it's still running and nobody holds the lock (or theirs ran out
 * by `now`). One statement: of two callers at once, one gets the run, the other nothing.
 */
export async function takeLock(id: string, until: string, now: string): Promise<Run | null> {
  return first(
    await patch(
      id,
      { lockUntil: until },
      and(eq(aiRuns.status, 'running'), or(isNull(aiRuns.lockUntil), lt(aiRuns.lockUntil, now))),
    ),
  );
}
