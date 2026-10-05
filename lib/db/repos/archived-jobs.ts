import 'server-only';
import { eq, exists, sql } from 'drizzle-orm';
import { db } from '../client';
import { archivedJobs, offersUnique } from '../schema';

// The jobs you archived from a list: left out of the lists, shown only by ?archived=1.

/** Archives the job; one archived before keeps its first time. */
export async function archive(jobId: string) {
  await db().insert(archivedJobs).values({ jobId }).onConflictDoNothing({ target: archivedJobs.jobId });
}

/** Back in the lists. */
export async function restore(jobId: string) {
  await db().delete(archivedJobs).where(eq(archivedJobs.jobId, jobId));
}

/** Per job of a list (offers_unique): archived? */
export const isArchived = () =>
  sql<boolean>`${exists(
    db()
      .select({ one: sql`1` })
      .from(archivedJobs)
      .where(eq(archivedJobs.jobId, offersUnique.jobId)),
  )}`;
