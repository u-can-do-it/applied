import 'server-only';
import type { DateFilter } from './dates';
import * as offersRepo from './db/repos/offers';
import * as runsRepo from './db/repos/scrape-runs';
import type { AiVerdictRow } from './db/schema';
import { appZone } from './time-zone';

/**
 * A job as the lists show it: its earliest offer, every board's offer, when you applied, whether it
 * came in with the latest scrape run that brought new jobs (`isNew`), whether you opened it before
 * (`seen`), whether you archived it (`archived`); the active profile's verdict, if it judged it.
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
    /** ?fit=: the jobs this profile version judged, its matches or the rejected ones */
    ai?: { profileId: string; version: number; rejected: boolean };
    /** every job, each with this profile version's verdict when it has one */
    verdictsOf?: { profileId: string; version: number };
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
    const { rows, ...numbers } = await offersRepo.pageOfJobs(filter, opts.page, PAGE_SIZE, latest, opts.verdictsOf);
    return { jobs: rows.map(withVerdict), ...numbers, latest };
  }
  const { profileId, version, rejected } = opts.ai;
  const verdicts = { profileId, version, match: !rejected };
  const { rows, ...numbers } = await offersRepo.pageOfJudgedJobs(filter, opts.page, PAGE_SIZE, verdicts, latest);
  return { jobs: rows.map(withVerdict), ...numbers, latest };
}

type Verdict = NonNullable<ListedJob['ai']>;
type Nullable<T> = { [K in keyof T]: T[K] | null };
/** A row's verdict fields as `ai`; a job not judged (a left join's nulls, or none asked for) has none. */
function withVerdict<Row extends Omit<ListedJob, 'ai'>>(
  row: Row & Partial<Nullable<Verdict>>,
): Omit<Row, keyof Verdict> & Pick<ListedJob, 'ai'> {
  const { match, score, summary, checks, hadDescription, ...job } = row;
  if (match == null || score == null) return job;
  return {
    ...job,
    ai: { match, score, summary: summary ?? null, checks: checks ?? [], hadDescription: Boolean(hadDescription) },
  };
}

/** Jobs in the database (each once), ignoring every filter. */
export const getTotalCount = () => offersRepo.countJobs();
