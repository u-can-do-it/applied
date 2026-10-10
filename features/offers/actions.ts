'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { archive, restore } from '@/lib/db/repos/archived-jobs';
import { markSeen } from '@/lib/db/repos/seen-jobs';
import { assessJobFit, setJobNote } from '@/lib/offer-window';
import { jobIdSchema, setNoteSchema } from '@/lib/shared/schemas/applications';

/** An offer opened from a list (its title or a board's link): the job is seen. No refresh: the row shows it at once. */
export const markSeenAction = action(jobIdSchema, async ({ jobId }) => {
  await markSeen(jobId);
});

/** Leaves the job out of the lists (?archived=1 still shows it); the list refreshes without it. */
export const archiveAction = action(jobIdSchema, async ({ jobId }) => {
  await archive(jobId);
  refresh();
});

/** Puts an archived job back in the lists. */
export const restoreAction = action(jobIdSchema, async ({ jobId }) => {
  await restore(jobId);
  refresh();
});

/**
 * Saves your note on a job you haven't applied to (its window), unless it changed elsewhere since
 * `seenAt`: then it fails, and the window keeps your text. Answers with the new note_updated_at.
 */
export const setJobNoteAction = action(setNoteSchema, async ({ jobId, note, seenAt }) =>
  setJobNote(jobId, note, seenAt),
);

/** Asks the AI how well the job fits the active profile, from its ad; answers with the verdict (the list shows it too). */
export const assessJobFitAction = action(jobIdSchema, async ({ jobId }) => {
  const fit = await assessJobFit(jobId);
  refresh();
  return fit;
});
