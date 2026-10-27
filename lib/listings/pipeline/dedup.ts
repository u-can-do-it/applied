import 'server-only';
import { mergeDuplicatesRound } from '../../ai/merge-duplicates';
import * as queueRepo from '../../db/repos/notify-queue';
import { env } from '../../env';
import { message } from '../../shared/errors';
import type { ScrapeSettings } from '../settings';

// Step 6's first part, mergeNew: the AI's duplicate check (lib/ai/merge-duplicates.ts) on the last days'
// jobs, before they're judged and sent. A new job that is a known one under a title its key misses (another
// board's "… (Remote)", say) is merged into it, so it isn't judged again or announced as new. Before, only
// an AI run from Settings checked for duplicates, and nothing did between those runs.

/** how far back the jobs it pairs go (a pair is asked once, so a failed run's pairs are in the next one's) */
const DAYS = 3;
/** rounds of up to 30 pairs a run: a backlog is worked off over a few runs */
const ROUNDS = 2;

export type MergedNew = { merged: number; error: string | null };

/** Never throws: what went wrong is in `error`. Only with the AI filter on and an OpenAI key; none after `deadline`. */
export async function mergeNew(settings: Pick<ScrapeSettings, 'aiFilter'>, deadline: number): Promise<MergedNew> {
  if (!settings.aiFilter || !env.OPENAI_API_KEY) return { merged: 0, error: null };
  const range = { gte: new Date(Date.now() - DAYS * 86_400_000).toISOString(), lt: null };
  const asked = new Set<string>();
  let merged = 0;
  try {
    for (let round = 0; round < ROUNDS && Date.now() < deadline; round++) {
      const done = await mergeDuplicatesRound(range, asked);
      merged += done.merged;
      if (done.error) return { merged, error: done.error };
      if (!done.checked) break;
    }
    // a queued offer of a job merged into another isn't news: that job was listed (or is queued) already
    if (merged) await queueRepo.dropMerged();
    return { merged, error: null };
  } catch (error) {
    return { merged, error: message(error) };
  }
}
