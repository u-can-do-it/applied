import 'server-only';
import { eq, exists, sql } from 'drizzle-orm';
import { db } from '../client';
import { offersUnique, seenJobs } from '../schema';

// The jobs you opened from a list: the check mark after their titles.

/** Marks the job seen; one seen before keeps its first time. */
export async function markSeen(jobId: string) {
  await db().insert(seenJobs).values({ jobId }).onConflictDoNothing({ target: seenJobs.jobId });
}

/** Per job of a list (offers_unique): opened before? */
export const isSeen = () =>
  sql<boolean>`${exists(
    db()
      .select({ one: sql`1` })
      .from(seenJobs)
      .where(eq(seenJobs.jobId, offersUnique.jobId)),
  )}`;
