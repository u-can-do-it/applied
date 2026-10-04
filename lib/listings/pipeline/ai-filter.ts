import 'server-only';
import { assessJobs, type Verdict } from '../../ai/runs';
import { env } from '../../env';
import { getProfile, isUsable, listProfiles, type ProfileWithFile } from '../../ai/profiles';
import { message } from '../../shared/errors';
import type { ScrapeSettings } from '../settings';

// Step 6, aiFilter: the new jobs checked against the active AI profile, so the notifications (notify) can
// send only the matches and the AI tab has them judged.

/** The active AI profile, if the AI filter can work: on in Settings, a usable profile, an OpenAI key. */
export async function aiProfile(settings: ScrapeSettings): Promise<ProfileWithFile | null> {
  if (!settings.aiFilter || !env.OPENAI_API_KEY) return null;
  const active = (await listProfiles())[0];
  if (!isUsable(active)) return null;
  return getProfile(active.id);
}

export type AiFiltered = {
  /** a profile was there to check with */
  checked: boolean;
  /** how many of the jobs match (null: not checked) */
  matched: number | null;
  error: string | null;
};

/** Never throws: what went wrong is in `error`. Starts no new AI batch after `deadline`. */
export async function aiFilter(
  settings: ScrapeSettings,
  jobs: readonly string[],
  deadline: number,
): Promise<AiFiltered> {
  if (!jobs.length) return { checked: false, matched: null, error: null };
  let profile: ProfileWithFile | null;
  try {
    profile = await aiProfile(settings);
  } catch (error) {
    return { checked: false, matched: null, error: message(error) };
  }
  if (!profile) return { checked: false, matched: null, error: null };
  const assessed = await assessJobs(profile, [...jobs], deadline).catch((failure: unknown) => ({
    verdicts: new Map<string, Verdict>(),
    error: message(failure),
  }));
  return {
    checked: true,
    matched: jobs.filter((jobId) => assessed.verdicts.get(jobId)?.match).length,
    error: assessed.error,
  };
}
