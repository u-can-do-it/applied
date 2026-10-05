import 'server-only';
import type { DateFilter } from './dates';
import * as offersRepo from './db/repos/offers';
import * as runsRepo from './db/repos/scrape-runs';
import type { AiVerdictRow } from './db/schema';
import { appZone } from './time-zone';

/**
 * A job as the lists show it: its earliest offer, every board's offer, when you applied, whether it
 * came in with the latest scrape run that brought new jobs (`isNew`), whether you opened it before
 * (`seen`), whether you archived it (`archived`); on the AI tab, the verdict.
 */
export type ListedJob = offersRepo.Job & {
  isNew: boolean;
  seen: boolean;
  archived: boolean;
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
    /** only the jobs the latest scrape run that brought new jobs brought (?new=1) */
    latest?: boolean;
    /** the archived jobs instead of the others (?archived=1) */
    archived?: boolean;
    /** AI tab: results of this profile version */
    ai?: { profileId: string; version: number; rejected: boolean };
  };

/**
 * One page of the list, how many match in all, how many of those are new (`newCount`), when the
 * run that brought them ran (`latest`; null: no run in the log added offers), and how many jobs
 * these filters find among the archived ones (`archivedCount`).
 */
export type JobPage = {
  jobs: ListedJob[];
  total: number;
  newCount: number;
  archivedCount: number;
  latest: offersRepo.RunWindow | null;
};

export async function getJobs(opts: Query): Promise<JobPage> {
  const [zone, latest] = await Promise.all([appZone(), runsRepo.latestWithNewJobs()]); // "today", "last 7 days": days there
  if (opts.latest && !latest) return { jobs: [], total: 0, newCount: 0, archivedCount: 0, latest };
  const filter = {
    words: searchWords(opts.q),
    src: opts.src,
    ...zone.resolveRange(opts),
    ...(opts.latest && latest ? { newIn: latest } : {}),
    archived: opts.archived,
  };
  if (!opts.ai) {
    const { rows, ...numbers } = await offersRepo.pageOfJobs(filter, opts.page, PAGE_SIZE, latest);
    return { jobs: rows, ...numbers, latest };
  }
  const { profileId, version, rejected } = opts.ai;
  const verdicts = { profileId, version, match: !rejected };
  const { rows, ...numbers } = await offersRepo.pageOfJudgedJobs(filter, opts.page, PAGE_SIZE, verdicts, latest);
  return {
    jobs: rows.map(({ match, score, summary, checks, hadDescription, ...job }) => ({
      ...job,
      ai: { match, score, summary, checks, hadDescription },
    })),
    ...numbers,
    latest,
  };
}

/** Jobs in the database (each once), ignoring every filter. */
export const getTotalCount = () => offersRepo.countJobs();
