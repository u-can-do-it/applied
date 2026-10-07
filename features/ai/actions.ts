'use server';

import { refresh } from 'next/cache';
import { after } from 'next/server';
import { action, formAction } from '@/server/action';
import { continueRun, startRun } from '@/lib/ai/runs';
import { describeRange } from '@/lib/dates';
import { activateProfile, deleteProfile, getProfile, isUsable, listProfiles, saveProfile } from '@/lib/ai/profiles';
import { profileIdSchema, profileSchema, startRunSchema } from '@/lib/shared/schemas/ai';
import { noInput } from '@/lib/shared/schemas/common';
import { appZone } from '@/lib/time-zone';
import { activeRun } from './run-info';

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
  async ({ profileId, name, prompt, file: upload, removeFile, keepVerdicts }) => {
    let file: Parameters<typeof saveProfile>[0]['file'] = removeFile ? 'remove' : 'keep';
    if (upload) {
      let text: string;
      try {
        text = (await fileToText(upload)).replace(/\s+\n/g, '\n').trim();
      } catch (error) {
        // the PDF library can throw things that aren't Errors; "[object Object]" would say nothing
        throw new Error(error instanceof Error ? error.message : 'Could not read the file.');
      }
      if (!text) throw new Error('No text found in that file (a scanned PDF?).');
      file = { name: upload.name, text: text.slice(0, MAX_TEXT) };
    }

    const keepsFile =
      file === 'keep' && profileId ? Boolean((await getProfile(profileId))?.fileName) : typeof file === 'object';
    if (!prompt.trim() && !keepsFile) throw new Error('Describe what to look for, or add a file.');

    const id = await saveProfile({ id: profileId, name, prompt, file, keepVerdicts });
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

/**
 * The active profile's latest run, asked every few seconds while one is open (Settings → AI filter),
 * instead of refreshing the whole Settings page; a paused one is continued after the answer.
 */
export const activeRunAction = action(noInput, async () => {
  const active = (await listProfiles()).at(0);
  return active ? activeRun(active) : null;
});
