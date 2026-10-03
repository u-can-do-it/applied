import 'server-only';
import { rest, restUrl } from './supabase';

export type Profile = {
  id: string;
  name: string;
  prompt: string;
  file_name: string | null;
  version: number;
  last_used_at: string;
  updated_at: string;
};
export type ProfileWithFile = Profile & { file_text: string | null };

const COLS = 'id,name,prompt,file_name,version,last_used_at,updated_at';

/** Most recently used first: the first one is the active profile. */
export async function listProfiles(): Promise<Profile[]> {
  const url = restUrl('ai_profiles');
  url.searchParams.set('select', COLS);
  url.searchParams.set('order', 'last_used_at.desc');
  return (await rest(url)).json() as Promise<Profile[]>;
}

export async function getProfile(id: string): Promise<ProfileWithFile | null> {
  const url = restUrl('ai_profiles');
  url.searchParams.set('select', `${COLS},file_text`);
  url.searchParams.set('id', `eq.${id}`);
  const rows = (await (await rest(url)).json()) as ProfileWithFile[];
  return rows[0] ?? null;
}

export const isUsable = <P extends { prompt: string; file_name: string | null }>(p: P | null | undefined): p is P =>
  Boolean(p && (p.prompt.trim() || p.file_name));

type FileChange = { name: string; text: string } | 'keep' | 'remove';

/**
 * Creates or updates a profile and makes it the active one. The version only goes up when the
 * criteria or the file change: earlier verdicts then no longer count, so offers get re-checked.
 * Renaming or just picking a profile keeps its verdicts.
 */
export async function saveProfile(input: {
  id?: string;
  name: string;
  prompt: string;
  file: FileChange;
}): Promise<string> {
  const now = new Date().toISOString();
  const name = input.name.trim() || 'Profile';

  if (!input.id) {
    const file = typeof input.file === 'object' ? input.file : null;
    const url = restUrl('ai_profiles');
    const res = await rest(url, {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify({
        name,
        prompt: input.prompt,
        file_name: file?.name ?? null,
        file_text: file?.text ?? null,
        last_used_at: now,
      }),
    });
    return ((await res.json()) as Profile[])[0].id;
  }

  const current = await getProfile(input.id);
  if (!current) throw new Error('That profile no longer exists.');
  const file_name = input.file === 'keep' ? current.file_name : input.file === 'remove' ? null : input.file.name;
  const file_text = input.file === 'keep' ? current.file_text : input.file === 'remove' ? null : input.file.text;
  const changed = input.prompt !== current.prompt || file_text !== current.file_text;
  const version = changed ? current.version + 1 : current.version;

  const url = restUrl('ai_profiles');
  url.searchParams.set('id', `eq.${input.id}`);
  await rest(url, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({
      name,
      prompt: input.prompt,
      file_name,
      file_text,
      version,
      updated_at: changed ? now : current.updated_at,
      last_used_at: now,
    }),
  });

  if (changed) {
    // verdicts of older versions are never shown again
    const old = restUrl('ai_verdicts');
    old.searchParams.set('profile_id', `eq.${input.id}`);
    old.searchParams.set('version', `lt.${version}`);
    await rest(old, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  }
  return input.id;
}

export async function activateProfile(id: string) {
  const url = restUrl('ai_profiles');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  });
}

/** Removes the profile with its runs and verdicts (cascade). */
export async function deleteProfile(id: string) {
  const url = restUrl('ai_profiles');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, { method: 'DELETE', prefer: 'return=minimal' });
}
