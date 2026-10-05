'use server';

import { refresh } from 'next/cache';
import { after } from 'next/server';
import { action } from '@/server/action';
import {
  addApplication,
  appliedAtOf,
  findOfferByLink,
  jobIdFor,
  markApplied,
  removeStatusStep,
  saveContent,
  setNote,
  setStatus,
  unmarkApplied,
  updateApplication,
} from '@/lib/applications';
import { boardIdOf, boardOf, cleanLink } from '@/lib/boards';
import { env } from '@/lib/env';
import { extractJob, type ExtractedJob } from '@/lib/ai/openai';
import { readJobPage } from '@/lib/ads';
import { workModeOf, type WorkMode } from '@/lib/ads/details';
import { log } from '@/lib/log';
import { message } from '@/lib/shared/errors';
import {
  addApplicationSchema,
  applySchema,
  DAY_ERROR,
  fillFromLinkSchema,
  jobIdSchema,
  removeStepSchema,
  setNoteSchema,
  setStatusSchema,
  updateApplicationSchema,
} from '@/lib/shared/schemas/applications';
import { appZone } from '@/lib/time-zone';

// ---- applications --------------------------------------------------------------------

/** saveContent() after the answer: what fails there is logged, nobody waits for it */
const saveContentLater = (jobId: string) =>
  after(() =>
    saveContent(jobId).catch((error: unknown) => {
      log.error('Saving the ad text failed', { jobId, error });
    }),
  );

/** Marks the job applied and saves its complete ad text in the background. */
export const applyAction = action(applySchema, async ({ jobId, src, id }) => {
  await markApplied(jobId, { src, id });
  saveContentLater(jobId);
  refresh();
});

/** Removes the mark and the saved ad text. */
export const unapplyAction = action(jobIdSchema, async ({ jobId }) => {
  await unmarkApplied(jobId);
  refresh();
});

/** Tries to fetch the ad text again (e.g. after a network error). */
export const refetchContentAction = action(jobIdSchema, async ({ jobId }) => {
  await saveContent(jobId);
  refresh();
});

/** Sets where an application stands, e.g. technical interview / passed. */
export const setApplicationStatusAction = action(setStatusSchema, async ({ jobId, stage, outcome }) => {
  await setStatus(jobId, stage, outcome);
  refresh();
});

/** Removes one step of an application's status history, e.g. a stage clicked by mistake. */
export const removeStatusStepAction = action(removeStepSchema, async ({ jobId, step }) => {
  const removed = await removeStatusStep(jobId, step);
  if (removed.error) throw new Error(removed.error);
  refresh();
});

/**
 * Saves your note on an application, unless it changed elsewhere since `seenAt` (its
 * note_updated_at as the window had it): then it fails, and the window keeps your text. Answers
 * with the new note_updated_at. No page refresh: the window and the list keep their own copy.
 */
export const setApplicationNoteAction = action(setNoteSchema, async ({ jobId, note, seenAt }) =>
  setNote(jobId, note, seenAt),
);

// ---- applications added by hand ----------------------------------------------------------

export type JobDraft = {
  url: string;
  board: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode | '';
  officeDays: string;
  salary: string;
  contract: string;
  content: string;
  /** the link is an offer the scrapers already have: the application joins it */
  known: string | null;
  /** that offer's job (an application being edited may be it already) */
  knownJobId: string | null;
  warning?: string;
};

/** Reads the link's page (the board's API where there is one) and lets the AI fill in the form. */
export const fillFromLinkAction = action(fillFromLinkSchema, async ({ link }): Promise<JobDraft> => {
  const board = boardOf(link);
  const [offer, page] = await Promise.all([
    findOfferByLink(link).catch(() => null),
    readJobPage({ src: board, id: boardIdOf(board, link) ?? '', url: link.trim() }).catch((failure: unknown) => ({
      error: message(failure),
    })),
  ]);
  const read = 'text' in page ? page : null;
  if (!read?.text && !read?.pageTitle && !offer)
    throw new Error(`Couldn’t read the page: ${'error' in page ? page.error : 'it has no text (a login wall?)'}`);

  let ai: ExtractedJob | null = null;
  let warning: string | undefined;
  if (!env.OPENAI_API_KEY) warning = 'No OPENAI_API_KEY: filled in only what the page says plainly.';
  else if (read) {
    try {
      ai = await extractJob({ url: link, pageTitle: read.pageTitle, text: read.text });
    } catch (error) {
      warning = `The AI couldn’t read it (${message(error)}); filled in what the page says plainly.`;
    }
  }
  const details = read?.details ?? {};
  const knownJobId = offer
    ? await jobIdFor(offer.company, offer.title, offer.titleKey).catch(() => offer.titleKey)
    : null;
  return {
    url: offer?.url ?? cleanLink(link),
    board: offer?.src ?? board,
    title: offer?.title || ai?.title || read?.pageTitle || '',
    company: offer?.company || ai?.company || details.company || '',
    location: ai?.location || details.location || '',
    workMode: (ai && ai.workMode !== 'unknown' ? ai.workMode : workModeOf(details)) ?? '',
    officeDays: ai?.officeDays || details.officeDays || '',
    salary: ai?.salary || details.salary || '',
    contract: ai?.contract || details.contract || '',
    content: read?.text ?? '',
    known: offer ? `${offer.title}${offer.company ? ` · ${offer.company}` : ''} (scraped from ${offer.src})` : null,
    knownJobId,
    warning,
  };
});

/** "+ Add application": answers with the job's id. */
export const addApplicationAction = action(addApplicationSchema, async (form) => {
  const zone = await appZone();
  if (form.day > zone.day()) throw new Error(DAY_ERROR);
  const added = await addApplication(
    {
      url: form.url ? cleanLink(form.url) : '',
      title: form.title,
      company: form.company,
      src: form.board,
      appliedAt: appliedAtOf(form.day, zone),
      stage: form.stage,
      outcome: form.outcome,
      details: form.details,
      content: form.content.trim() || null,
      note: form.note,
    },
    zone,
  );
  if (added.error) throw new Error(added.error);
  // less than a full ad (80 chars) and a link: fetch it after the answer, like "Mark applied" does (what you typed stays)
  const jobId = added.jobId;
  if (added.fetch && jobId) saveContentLater(jobId);
  refresh();
  return { jobId };
});

/** Saves an application's edited details; answers with it as saved (its job may be another: see updateApplication). */
export const updateApplicationAction = action(updateApplicationSchema, async ({ jobId, input: form }) => {
  const zone = await appZone();
  if (form.day > zone.day()) throw new Error(DAY_ERROR);
  const updated = await updateApplication(
    jobId,
    {
      url: form.url,
      title: form.title,
      company: form.company,
      src: form.board,
      day: form.day,
      details: form.details,
      content: form.content,
    },
    zone,
  );
  if (updated.error || !updated.app) throw new Error(updated.error ?? 'This application no longer exists.');
  const saved = updated.app.jobId;
  // what you typed stays over what the board says (details.typed)
  if (updated.fetch) saveContentLater(saved);
  refresh();
  return updated.app;
});
