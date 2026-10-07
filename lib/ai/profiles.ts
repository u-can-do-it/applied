import 'server-only';
import * as profilesRepo from '../db/repos/ai-profiles';
import * as verdictsRepo from '../db/repos/ai-verdicts';

// AI profiles and the rule that versions them: a verdict belongs to the version it was made with.

export type { Profile, ProfileWithFile } from '../db/repos/ai-profiles';
export type { Fit } from '../db/repos/ai-verdicts';

/** Most recently used first: the first one is the active profile. */
export const listProfiles = () => profilesRepo.list();

export const getProfile = (id: string) => profilesRepo.get(id);

/** How well the job fits the active profile, as its current version judged it; null: not judged (or no profile). */
export async function fitOf(jobId: string): Promise<verdictsRepo.Fit | null> {
  const active = (await listProfiles()).at(0);
  return active ? verdictsRepo.ofJob(active, jobId) : null;
}

export const isUsable = <P extends { prompt: string; fileName: string | null }>(
  profile: P | null | undefined,
): profile is P => Boolean(profile && (profile.prompt.trim() || profile.fileName));

type FileChange = { name: string; text: string } | 'keep' | 'remove';

/**
 * Creates or updates a profile and makes it the active one. The version only goes up when the
 * criteria or the file change: earlier verdicts then no longer count, so offers get re-checked.
 * `keepVerdicts` saves a change without that (a small tweak): the verdicts so far stay, and only
 * jobs not judged yet get the new criteria. Renaming or just picking a profile keeps its verdicts.
 */
export async function saveProfile(input: {
  id?: string;
  name: string;
  prompt: string;
  file: FileChange;
  keepVerdicts?: boolean;
}): Promise<string> {
  const now = new Date().toISOString();
  const name = input.name.trim() || 'Profile';

  if (!input.id) {
    const file = typeof input.file === 'object' ? input.file : null;
    return profilesRepo.insert({
      name,
      prompt: input.prompt,
      fileName: file?.name ?? null,
      fileText: file?.text ?? null,
      lastUsedAt: now,
    });
  }

  const current = await profilesRepo.get(input.id);
  if (!current) throw new Error('That profile no longer exists.');
  const fileName = input.file === 'keep' ? current.fileName : input.file === 'remove' ? null : input.file.name;
  const fileText = input.file === 'keep' ? current.fileText : input.file === 'remove' ? null : input.file.text;
  const changed = input.prompt !== current.prompt || fileText !== current.fileText;
  const recheck = changed && !input.keepVerdicts;
  const version = recheck ? current.version + 1 : current.version;

  await profilesRepo.patch(input.id, {
    name,
    prompt: input.prompt,
    fileName,
    fileText,
    version,
    updatedAt: changed ? now : current.updatedAt,
    lastUsedAt: now,
  });

  if (recheck) {
    // verdicts of older versions are never shown again
    await verdictsRepo.removeOlderThan({ id: input.id, version }).catch(() => {});
  }
  return input.id;
}

export const activateProfile = (id: string) => profilesRepo.patch(id, { lastUsedAt: new Date().toISOString() });

/** Removes the profile with its runs and verdicts (cascade). */
export const deleteProfile = (id: string) => profilesRepo.remove(id);
