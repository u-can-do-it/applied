'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { mergeByHand } from '@/lib/ai/merge-duplicates';
import { archive, restore } from '@/lib/db/repos/archived-jobs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { markSeen } from '@/lib/db/repos/seen-jobs';
import { assessJobFit, setJobAd, setJobAdFromLink, setJobNote } from '@/lib/offer-window';
import {
  jobIdSchema,
  mergeJobsSchema,
  setAdFromLinkSchema,
  setAdSchema,
  setNoteSchema,
} from '@/lib/shared/schemas/applications';
import { minFitSchema } from '@/lib/shared/schemas/settings';

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
 * The list's minimum AI fit (lib/listings/settings.ts): the offers rejected or scored under it stay out
 * until it's cleared (0) here.
 */
export const setMinFitAction = action(minFitSchema, async ({ minFit }) => {
  await settingsRepo.save({ ...(await settingsRepo.get()), minFit });
  refresh();
});

/** "Same job as…": the two jobs become one (the earliest stays, the other's marks follow); answers with both titles. */
export const mergeJobsAction = action(mergeJobsSchema, async ({ jobId, sameAs }) => {
  const merged = await mergeByHand(jobId, sameAs);
  refresh();
  return merged;
});

/**
 * Saves your note on a job you haven't applied to (its window), unless it changed elsewhere since
 * `seenAt`: then it fails, and the window keeps your text. Answers with the new note_updated_at.
 */
export const setJobNoteAction = action(setNoteSchema, async ({ jobId, note, seenAt }) =>
  setJobNote(jobId, note, seenAt),
);

/** Saves your text as the job's ad; answers with the ad as its window shows it. */
export const setJobAdAction = action(setAdSchema, async ({ jobId, content }) => setJobAd(jobId, content));

/** Reads the ad from the link you pasted (the AI fills in what the board didn't say) and saves it as the job's ad. */
export const setJobAdFromLinkAction = action(setAdFromLinkSchema, async ({ jobId, link }) =>
  setJobAdFromLink(jobId, link),
);

/** Asks the AI how well the job fits the active profile, from its ad; answers with the verdict (the list shows it too). */
export const assessJobFitAction = action(jobIdSchema, async ({ jobId }) => {
  const fit = await assessJobFit(jobId);
  refresh();
  return fit;
});
