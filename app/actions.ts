'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { action, formAction } from '@/lib/action';
import { continueRun, startRun } from '@/lib/ai-runs';
import {
  addApplication,
  appliedAtOf,
  findOfferByLink,
  jobKeyFor,
  markApplied,
  removeStatusStep,
  saveContent,
  setNote,
  setStatus,
  unmarkApplied,
  updateApplication,
} from '@/lib/applications';
import { AUTH_COOKIE, AUTH_MAX_AGE, authToken, isValidPassword } from '@/lib/auth';
import { boardIdOf, boardOf, cleanLink } from '@/lib/boards';
import { describeRange, isTimeZone } from '@/lib/dates';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { env } from '@/lib/env';
import { extractJob, type ExtractedJob } from '@/lib/openai';
import { activateProfile, deleteProfile, getProfile, isUsable, saveProfile } from '@/lib/profiles';
import { readJobPage } from '@/lib/ads';
import { syncCron } from '@/lib/listings/schedule';
import { message } from '@/lib/shared/errors';
import { profileIdSchema, profileSchema, startRunSchema } from '@/lib/shared/schemas/ai';
import {
  addApplicationSchema,
  applySchema,
  DAY_ERROR,
  fillFromLinkSchema,
  keySchema,
  removeStepSchema,
  setNoteSchema,
  setStatusSchema,
  updateApplicationSchema,
} from '@/lib/shared/schemas/applications';
import { loginSchema } from '@/lib/shared/schemas/auth';
import { browserTimeZoneSchema } from '@/lib/shared/schemas/settings';
import { appZone } from '@/lib/time-zone';

// ---- login ---------------------------------------------------------------------------

export const login = formAction(
  loginSchema,
  async ({ password, next }) => {
    if (!(await isValidPassword(password))) {
      await new Promise((resolve) => setTimeout(resolve, 600)); // slow down guessing a little
      throw new Error('Wrong password.');
    }
    (await cookies()).set(AUTH_COOKIE, await authToken(), {
      httpOnly: true, // not readable from page scripts
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_MAX_AGE,
    });
    redirect(next);
  },
  { public: true },
);

// ---- profiles ------------------------------------------------------------------------

const MAX_TEXT = 60_000; // characters kept from a file

async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith('text/')) return file.text();
  throw new Error('Only PDF, TXT and MD files are supported.');
}

/** Saves the profile and makes it the active one; answers with its id. */
export const saveProfileAction = formAction(
  profileSchema,
  async ({ profileId, name, prompt, file: upload, removeFile }) => {
    let file: Parameters<typeof saveProfile>[0]['file'] = removeFile ? 'remove' : 'keep';
    if (upload) {
      let text: string;
      try {
        text = (await fileToText(upload)).replace(/\s+\n/g, '\n').trim();
      } catch (e) {
        // the PDF library can throw things that aren't Errors; "[object Object]" would say nothing
        throw new Error(e instanceof Error ? e.message : 'Could not read the file.');
      }
      if (!text) throw new Error('No text found in that file (a scanned PDF?).');
      file = { name: upload.name, text: text.slice(0, MAX_TEXT) };
    }

    const keepsFile =
      file === 'keep' && profileId ? Boolean((await getProfile(profileId))?.fileName) : typeof file === 'object';
    if (!prompt.trim() && !keepsFile) throw new Error('Describe what to look for, or add a file.');

    const id = await saveProfile({ id: profileId, name, prompt, file });
    refresh();
    return { id };
  },
);

export const selectProfileAction = action(profileIdSchema, async ({ id }) => {
  await activateProfile(id);
  refresh();
});

export const deleteProfileAction = action(profileIdSchema, async ({ id }) => {
  await deleteProfile(id);
  refresh();
});

// ---- runs ----------------------------------------------------------------------------

/** Checks the offers in a date range that the profile hasn't judged yet (today if no range). */
export const startRunAction = action(startRunSchema, async ({ profileId, days, from, to }) => {
  const profile = await getProfile(profileId);
  if (!isUsable(profile)) throw new Error('Set up the profile first.');

  const filter = days ? { days } : { from, to };
  const { gte, lt } = (await appZone()).resolveRange(filter);
  const label = describeRange(filter) || 'all offers';

  const run = await startRun(profile, { gte, lt, label });
  if (run.status === 'running') after(() => continueRun(run.id));
  refresh();
  return run.status === 'running'
    ? { started: true, message: `Checking ${run.total - run.done} offer(s) from ${label}…` }
    : { started: false, message: `Nothing new to check in ${label}.` };
});

// ---- applications --------------------------------------------------------------------

/** Marks the job applied and saves its complete ad text in the background. */
export const applyAction = action(applySchema, async ({ key, src, id }) => {
  await markApplied(key, { src, id });
  after(() => saveContent(key));
  refresh();
});

/** Removes the mark and the saved ad text. */
export const unapplyAction = action(keySchema, async ({ key }) => {
  await unmarkApplied(key);
  refresh();
});

/** Tries to fetch the ad text again (e.g. after a network error). */
export const refetchContentAction = action(keySchema, async ({ key }) => {
  await saveContent(key);
  refresh();
});

/** Sets where an application stands, e.g. technical interview / passed. */
export const setApplicationStatusAction = action(setStatusSchema, async ({ key, stage, state }) => {
  await setStatus(key, stage, state);
  refresh();
});

/** Removes one step of an application's status history, e.g. a stage clicked by mistake. */
export const removeStatusStepAction = action(removeStepSchema, async ({ key, step }) => {
  const removed = await removeStatusStep(key, step);
  if (removed.error) throw new Error(removed.error);
  refresh();
});

/**
 * Saves your note on an application, unless it changed elsewhere since `seenAt` (its
 * note_updated_at as the window had it): then it fails, and the window keeps your text. Answers
 * with the new note_updated_at. No page refresh: the window and the list keep their own copy.
 */
export const setApplicationNoteAction = action(setNoteSchema, async ({ key, note, seenAt }) =>
  setNote(key, note, seenAt),
);

// ---- applications added by hand ----------------------------------------------------------

export type JobDraft = {
  url: string;
  board: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salary: string;
  contract: string;
  content: string;
  /** the link is an offer the scrapers already have: the application joins it */
  known: string | null;
  /** that offer's job (an application being edited may be it already) */
  knownKey: string | null;
  warning?: string;
};

/** Reads the link's page (the board's API where there is one) and lets the AI fill in the form. */
export const fillFromLinkAction = action(fillFromLinkSchema, async ({ link }): Promise<JobDraft> => {
  const board = boardOf(link);
  const [offer, page] = await Promise.all([
    findOfferByLink(link).catch(() => null),
    readJobPage({ src: board, id: boardIdOf(board, link) ?? '', url: link.trim() }).catch((e: unknown) => ({
      error: message(e),
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
    } catch (e) {
      warning = `The AI couldn’t read it (${message(e)}); filled in what the page says plainly.`;
    }
  }
  const details = read?.details ?? {};
  const knownKey = offer ? await jobKeyFor(offer.company, offer.title, offer.dupKey).catch(() => offer.dupKey) : null;
  return {
    url: offer?.url ?? cleanLink(link),
    board: offer?.src ?? board,
    title: offer?.title || ai?.title || read?.pageTitle || '',
    company: offer?.company || ai?.company || details.company || '',
    location: ai?.location || details.location || '',
    remote: ai ? ai.remote === 'yes' : Boolean(details.remote),
    salary: ai?.salary || details.salary || '',
    contract: ai?.contract || details.contract || '',
    content: read?.text ?? '',
    known: offer ? `${offer.title}${offer.company ? ` · ${offer.company}` : ''} (scraped from ${offer.src})` : null,
    knownKey,
    warning,
  };
});

/** "+ Add application": answers with the job's key. */
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
      state: form.state,
      details: form.details,
      content: form.content.trim() || null,
      note: form.note,
    },
    zone,
  );
  if (added.error) throw new Error(added.error);
  // less than a full ad (80 chars) and a link: fetch it after the answer, like "Mark applied" does (what you typed stays)
  const key = added.key;
  if (added.fetch && key) after(() => saveContent(key));
  refresh();
  return { key };
});

/** Saves an application's edited details; answers with it as saved (its key may be new: see updateApplication). */
export const updateApplicationAction = action(updateApplicationSchema, async ({ key, input: form }) => {
  const zone = await appZone();
  if (form.day > zone.day()) throw new Error(DAY_ERROR);
  const updated = await updateApplication(
    key,
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
  const saved = updated.app.dupKey;
  // what you typed stays over what the board says (details.typed)
  if (updated.fetch) after(() => saveContent(saved));
  refresh();
  return updated.app;
});

// ---- time zone ---------------------------------------------------------------------------

/**
 * The browser says which zone it's in. Kept as the zone that "the browser's" (the default) means,
 * so the cron and Telegram use it too; the page shows it at once if that's what the app follows.
 */
export const reportBrowserTimeZoneAction = action(browserTimeZoneSchema, async ({ tz }) => {
  if (!isTimeZone(tz)) return;
  // not appSettings(): the page refreshed below is rendered in this same request, and it must
  // read the settings as saved here, not as cached from before
  const settings = await settingsRepo.get().catch(() => null);
  if (!settings || settings.browserTimeZone === tz) return;
  const next = { ...settings, browserTimeZone: tz };
  await settingsRepo.save(next);
  if (settings.timeZone) return; // a zone of its own is picked: nothing that shows or runs changes
  await syncCron(next); // the hours are this zone's now (if that fails, Settings shows it)
  refresh();
});
