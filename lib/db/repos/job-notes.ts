import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { jobNotes, type JobNoteRow } from '../schema';

// Your note on a job you haven't applied to (its window). Marking the job applied moves it to the
// application (take), so a job has one note at a time.

export type JobNote = Pick<JobNoteRow, 'note' | 'noteUpdatedAt'>;

export async function get(jobId: string): Promise<JobNote | null> {
  const rows = await db()
    .select({ note: jobNotes.note, noteUpdatedAt: jobNotes.noteUpdatedAt })
    .from(jobNotes)
    .where(eq(jobNotes.jobId, jobId));
  return first(rows) ?? null;
}

/**
 * Saves the note if it's still the version you saw (`seenAt`: its note_updated_at, null: none yet);
 * the new note_updated_at, or null when it changed elsewhere since.
 */
export async function setIfUnchanged(jobId: string, note: string | null, seenAt: string | null) {
  const saved =
    seenAt === null
      ? await db()
          .insert(jobNotes)
          .values({ jobId, note })
          .onConflictDoNothing({ target: jobNotes.jobId })
          .returning({ noteUpdatedAt: jobNotes.noteUpdatedAt })
      : await db()
          .update(jobNotes)
          .set({ note, noteUpdatedAt: sql`now()` })
          .where(and(eq(jobNotes.jobId, jobId), eq(jobNotes.noteUpdatedAt, seenAt)))
          .returning({ noteUpdatedAt: jobNotes.noteUpdatedAt });
  return first(saved)?.noteUpdatedAt ?? null;
}

/** The note, deleted here (it goes to the job's application); null if there was none. */
export async function take(jobId: string): Promise<JobNote | null> {
  const rows = await db()
    .delete(jobNotes)
    .where(eq(jobNotes.jobId, jobId))
    .returning({ note: jobNotes.note, noteUpdatedAt: jobNotes.noteUpdatedAt });
  return first(rows) ?? null;
}
