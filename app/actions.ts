'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { continueRun, startRun } from '@/lib/ai-runs';
import {
  addApplication, appliedAtOf, findOfferByLink, jobKeyFor, markApplied, NOTE_MAX, removeStatusStep, saveContent, setNote, setStatus,
  unmarkApplied, updateApplication, type ApplicationWithContent,
} from '@/lib/applications';
import { BOARD_RE, boardIdOf, boardOf, cleanLink, isLink } from '@/lib/boards';
import { AUTH_COOKIE, AUTH_MAX_AGE, authToken, isValidPassword } from '@/lib/auth';
import { describeRange, isTimeZone, validDay, type Zone } from '@/lib/dates';
import { extractJob, type ExtractedJob } from '@/lib/openai';
import { activateProfile, deleteProfile, getProfile, isUsable, saveProfile } from '@/lib/profiles';
import { readJobPage, type JobDetails } from '@/lib/scrape';
import { syncCron } from '@/lib/scraping/schedule';
import * as store from '@/lib/scraping/store';
import { requireLogin } from '@/lib/session';
import { DAY_PRESETS } from '@/lib/sources';
import { isStage, isState } from '@/lib/stages';
import { appZone } from '@/lib/time-zone';

export type FormState = { error?: string; ok?: boolean; id?: string; message?: string };

// ---- login ---------------------------------------------------------------------------

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '');
  if (!(await isValidPassword(password))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing a little
    return { error: 'Wrong password.' };
  }
  (await cookies()).set(AUTH_COOKIE, await authToken(), {
    httpOnly: true, // not readable from page scripts
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_MAX_AGE,
  });
  const next = String(form.get('next') ?? '/');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

// ---- profiles ------------------------------------------------------------------------

const MAX_FILE = 5 * 1024 * 1024;
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

export async function saveProfileAction(_: FormState, form: FormData): Promise<FormState> {
  await requireLogin();
  const id = String(form.get('profileId') ?? '') || undefined;
  const name = String(form.get('name') ?? '').slice(0, 80);
  const prompt = String(form.get('prompt') ?? '').slice(0, 4000);
  const upload = form.get('file');

  let file: Parameters<typeof saveProfile>[0]['file'] = form.get('removeFile') === 'on' ? 'remove' : 'keep';
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > MAX_FILE) return { error: 'The file is larger than 5 MB.' };
    try {
      const text = (await fileToText(upload)).replace(/\s+\n/g, '\n').trim();
      if (!text) return { error: 'No text found in that file (a scanned PDF?).' };
      file = { name: upload.name, text: text.slice(0, MAX_TEXT) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not read the file.' };
    }
  }

  const keepsFile = file === 'keep' && id ? Boolean((await getProfile(id))?.file_name) : typeof file === 'object';
  if (!prompt.trim() && !keepsFile) return { error: 'Describe what to look for, or add a file.' };

  const savedId = await saveProfile({ id, name, prompt, file });
  refresh();
  return { ok: true, id: savedId };
}

export async function selectProfileAction(id: string) {
  await requireLogin();
  await activateProfile(id);
  refresh();
}

export async function deleteProfileAction(id: string) {
  await requireLogin();
  await deleteProfile(id);
  refresh();
}

// ---- runs ----------------------------------------------------------------------------

/** Checks the offers in a date range that the profile hasn't judged yet (today if no range). */
export async function startRunAction(input: { profileId: string; days?: string; from?: string; to?: string }): Promise<FormState> {
  await requireLogin();
  const profile = await getProfile(input.profileId);
  if (!isUsable(profile)) return { error: 'Set up the profile first.' };

  const days = DAY_PRESETS.some((p) => p.days && p.days === input.days) ? input.days : undefined;
  const filter = days ? { days } : { from: input.from, to: input.to };
  const { gte, lt } = (await appZone()).resolveRange(filter);
  const label = describeRange(filter) || 'all offers';

  const run = await startRun(profile!, { gte, lt, label });
  if (run.status === 'running') after(() => continueRun(run.id));
  refresh();
  return run.status === 'running'
    ? { ok: true, message: `Checking ${run.total - run.done} offer(s) from ${label}…` }
    : { ok: true, message: `Nothing new to check in ${label}.` };
}

// ---- applications --------------------------------------------------------------------

/** Marks the job applied and saves its complete ad text in the background. */
export async function applyAction(input: { key: string; src: string; id: string }): Promise<FormState> {
  await requireLogin();
  try {
    await markApplied(input.key, { src: input.src, id: input.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  after(() => saveContent(input.key));
  refresh();
  return { ok: true };
}

/** Removes the mark and the saved ad text. */
export async function unapplyAction(key: string): Promise<FormState> {
  await requireLogin();
  await unmarkApplied(key);
  refresh();
  return { ok: true };
}

/** Tries to fetch the ad text again (e.g. after a network error). */
export async function refetchContentAction(key: string): Promise<FormState> {
  await requireLogin();
  await saveContent(key);
  refresh();
  return { ok: true };
}

/** Sets where an application stands, e.g. technical interview / passed. */
export async function setApplicationStatusAction(key: string, stage: string, state: string): Promise<FormState> {
  await requireLogin();
  if (!isStage(stage) || !isState(state)) return { error: 'Unknown status.' };
  await setStatus(key, stage, state);
  refresh();
  return { ok: true };
}

/** Removes one step of an application's status history, e.g. a stage clicked by mistake. */
export async function removeStatusStepAction(key: string, step: { stage: string; state: string; at: string }): Promise<FormState> {
  await requireLogin();
  if (typeof key !== 'string' || !isStage(step?.stage) || !isState(step?.state) || typeof step.at !== 'string') return { error: 'Bad request.' };
  const r = await removeStatusStep(key, { stage: step.stage, state: step.state, at: step.at });
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true };
}

/** Saves your note on an application. No page refresh: the window and the list keep their own copy. */
export async function setApplicationNoteAction(key: string, note: string): Promise<FormState> {
  await requireLogin();
  if (typeof key !== 'string' || typeof note !== 'string') return { error: 'Bad request.' };
  await setNote(key, note);
  return { ok: true };
}

// ---- applications added by hand ----------------------------------------------------------

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
export async function fillFromLinkAction(link: string): Promise<{ draft?: JobDraft; error?: string }> {
  await requireLogin();
  if (typeof link !== 'string' || !isLink(link)) return { error: 'Paste a link that starts with https://' };
  const board = boardOf(link);
  const [offer, page] = await Promise.all([
    findOfferByLink(link).catch(() => null),
    readJobPage({ src: board, id: boardIdOf(board, link) ?? '', url: link.trim() }).catch((e) => ({ error: message(e) })),
  ]);
  const read = 'text' in page ? page : null;
  if (!read?.text && !read?.pageTitle && !offer) return { error: `Couldn’t read the page: ${'error' in page ? page.error : 'it has no text (a login wall?)'}` };

  let ai: ExtractedJob | null = null;
  let warning: string | undefined;
  if (!process.env.OPENAI_API_KEY) warning = 'No OPENAI_API_KEY: filled in only what the page says plainly.';
  else if (read) {
    try {
      ai = await extractJob({ url: link, pageTitle: read.pageTitle, text: read.text });
    } catch (e) {
      warning = `The AI couldn’t read it (${message(e)}); filled in what the page says plainly.`;
    }
  }
  const d = read?.details ?? {};
  const knownKey = offer ? await jobKeyFor(offer.company, offer.title, offer.dup_key).catch(() => offer.dup_key) : null;
  return {
    draft: {
      url: offer?.url ?? cleanLink(link),
      board: offer?.src ?? board,
      title: offer?.title || ai?.title || read?.pageTitle || '',
      company: offer?.company || ai?.company || d.company || '',
      location: ai?.location || d.location || '',
      remote: ai ? ai.remote === 'yes' : Boolean(d.remote),
      salary: ai?.salary || d.salary || '',
      contract: ai?.contract || d.contract || '',
      content: read?.text ?? '',
      known: offer ? `${offer.title}${offer.company ? ` · ${offer.company}` : ''} (scraped from ${offer.src})` : null,
      knownKey,
      warning,
    },
  };
}

export type ApplicationInput = {
  url: string;
  title: string;
  company: string;
  board: string;
  day: string; // YYYY-MM-DD in the app's time zone
  stage: string;
  state: string;
  salary: string;
  contract: string;
  location: string;
  remote: boolean;
  content: string;
  note: string;
};

/** What "✎ Edit" sends: the form of "Add application" without the status and the note. */
export type ApplicationEditInput = Omit<ApplicationInput, 'stage' | 'state' | 'note'>;

type FormFields = { title: string; url: string; board: string; day: string; company: string | null; details: JobDetails | null; content: string };

/** The form's fields checked, the same for adding and editing. */
function readForm(input: Partial<ApplicationEditInput> | undefined, z: Zone): FormFields | { error: string } {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const title = str(input?.title, 200);
  if (!title) return { error: 'The title is needed.' };
  const url = str(input?.url, 2000);
  if (url && !isLink(url)) return { error: 'The link must start with https://' };
  const board = str(input?.board, 30).toLowerCase() || (url ? boardOf(url) : 'unknown');
  if (!BOARD_RE.test(board)) return { error: 'Board: lowercase letters, digits, - or _ (e.g. "linkedin").' };
  const day = validDay(str(input?.day, 10));
  if (!day || day > z.day()) return { error: 'Pick the day you applied (not in the future).' };
  const details: JobDetails = {};
  for (const [k, max] of [['salary', 200], ['contract', 100], ['location', 200]] as const) {
    const v = str(input?.[k], max);
    if (v) details[k] = v;
  }
  if (input?.remote) details.remote = true;
  return {
    title,
    url,
    board,
    day,
    company: str(input?.company, 200) || null,
    details: Object.keys(details).length ? details : null,
    content: typeof input?.content === 'string' ? input.content.slice(0, 200_000) : '',
  };
}

export async function addApplicationAction(input: ApplicationInput): Promise<FormState> {
  await requireLogin();
  const z = await appZone();
  const f = readForm(input, z);
  if ('error' in f) return f;
  if (!isStage(input.stage) || !isState(input.state)) return { error: 'Unknown status.' };
  try {
    const r = await addApplication({
      url: f.url ? cleanLink(f.url) : '',
      title: f.title,
      company: f.company,
      src: f.board,
      appliedAt: appliedAtOf(f.day, z),
      stage: input.stage,
      state: input.state,
      details: f.details,
      content: f.content.trim() || null,
      note: (typeof input.note === 'string' ? input.note.trim().slice(0, NOTE_MAX) : '') || null,
    }, z);
    if (r.error) return { error: r.error };
    // no ad text but a link: fetch it after the answer, like "Mark applied" does
    if (!f.content.trim() && f.url) after(() => saveContent(r.key!));
    refresh();
    return { ok: true, id: r.key };
  } catch (e) {
    return { error: message(e) };
  }
}

/** Saves an application's edited details; answers with it as saved (its key may be new: see updateApplication). */
export async function updateApplicationAction(key: string, input: ApplicationEditInput): Promise<{ error?: string; app?: ApplicationWithContent }> {
  await requireLogin();
  if (typeof key !== 'string' || !key) return { error: 'Bad request.' };
  const z = await appZone();
  const f = readForm(input, z);
  if ('error' in f) return f;
  try {
    const r = await updateApplication(key, { url: f.url, title: f.title, company: f.company, src: f.board, day: f.day, details: f.details, content: f.content }, z);
    if (r.error || !r.app) return { error: r.error ?? 'This application no longer exists.' };
    const saved = r.app.dup_key;
    // what you typed stays over what the board says
    if (r.fetch) after(() => saveContent(saved, { typed: f.details }));
    refresh();
    return { app: r.app };
  } catch (e) {
    return { error: message(e) };
  }
}

// ---- time zone ---------------------------------------------------------------------------

/**
 * The browser says which zone it's in. Kept as the zone that "the browser's" (the default) means,
 * so the cron and Telegram use it too; the page shows it at once if that's what the app follows.
 */
export async function reportBrowserTimeZoneAction(tz: string): Promise<void> {
  await requireLogin();
  if (!isTimeZone(tz)) return;
  // not appSettings(): the page refreshed below is rendered in this same request, and it must
  // read the settings as saved here, not as cached from before
  const s = await store.getSettings().catch(() => null);
  if (!s || s.browserTimeZone === tz) return;
  const next = { ...s, browserTimeZone: tz };
  await store.saveSettings(next);
  if (s.timeZone) return; // a zone of its own is picked: nothing that shows or runs changes
  await syncCron(next); // the hours are this zone's now (if that fails, Settings shows it)
  refresh();
}
