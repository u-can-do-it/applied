'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { archive, restore } from '@/lib/db/repos/archived-jobs';
import { markSeen } from '@/lib/db/repos/seen-jobs';
import { jobIdSchema } from '@/lib/shared/schemas/applications';

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
