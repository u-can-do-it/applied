import 'server-only';
import type { DateFilter } from './dates';
import * as offersRepo from './db/repos/offers';
import type { AiVerdictRow } from './db/schema';
import { appZone } from './time-zone';

/** A job as the lists show it: its earliest offer, every board's offer, when you applied; on the AI tab, the verdict. */
export type ListedJob = offersRepo.Job & {
  ai?: Pick<AiVerdictRow, 'match' | 'score' | 'summary' | 'checks' | 'hadDescription'>;
};

export const PAGE_SIZE = 50;

/**
 * The search, as words that must each appear in the title or the company: at most six, of at most
 * 40 characters. Quotes and `*` separate words, as they always did; `%` and `_` are matched as
 * themselves (lib/db/repos/offers.ts escapes them).
 */
export const searchWords = (search: string) =>
  search
    .replace(/["*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => word.slice(0, 40));

type Query = { q: string; src: string; page: number } & DateFilter & {
    /** AI tab: results of this profile version */
    ai?: { profileId: string; version: number; rejected: boolean };
  };

export async function getJobs(opts: Query): Promise<{ jobs: ListedJob[]; total: number }> {
  const zone = await appZone(); // "today", "last 7 days": days there
  const filter = { words: searchWords(opts.q), src: opts.src, ...zone.resolveRange(opts) };
  if (!opts.ai) {
    const { rows, total } = await offersRepo.pageOfJobs(filter, opts.page, PAGE_SIZE);
    return { jobs: rows, total };
  }
  const { profileId, version, rejected } = opts.ai;
  const { rows, total } = await offersRepo.pageOfJudgedJobs(filter, opts.page, PAGE_SIZE, {
    profileId,
    version,
    match: !rejected,
  });
  return {
    jobs: rows.map(({ match, score, summary, checks, hadDescription, ...job }) => ({
      ...job,
      ai: { match, score, summary, checks, hadDescription },
    })),
    total,
  };
}

/** Jobs in the database (each once), ignoring every filter. */
export const getTotalCount = () => offersRepo.countJobs();
