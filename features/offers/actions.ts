'use server';

import { action } from '@/server/action';
import { markSeen } from '@/lib/db/repos/seen-jobs';
import { jobIdSchema } from '@/lib/shared/schemas/applications';

/** An offer opened from a list (its title or a board's link): the job is seen. No refresh: the row shows it at once. */
export const markSeenAction = action(jobIdSchema, async ({ jobId }) => {
  await markSeen(jobId);
});
