'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { continueRun, startRun } from '@/lib/ai-runs';
import { markApplied, saveContent, unmarkApplied } from '@/lib/applications';
import { AUTH_COOKIE, AUTH_MAX_AGE, authToken, isValidPassword, isValidToken } from '@/lib/auth';
import { describeRange, resolveRange } from '@/lib/dates';
import { activateProfile, deleteProfile, getProfile, isUsable, saveProfile } from '@/lib/profiles';
import { DAY_PRESETS } from '@/lib/sources';

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

async function requireLogin() {
  // proxy.ts already checks every request; server actions are public endpoints, so check again
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) throw new Error('Not logged in');
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
  const { gte, lt } = resolveRange(filter);
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
