import 'server-only';
import type { DateFilter } from './dates';
import * as offersRepo from './db/repos/offers';
import * as runsRepo from './db/repos/scrape-runs';
import type { AiVerdictRow } from './db/schema';
import { rank, type Marks } from './shared/search';
import { appZone } from './time-zone';

/**
 * A job as the lists show it: its earliest offer (a board's own over an aggregator's), every board's offer, when you applied, whether it
 * came in with the latest scrape run that brought new jobs (`isNew`), whether you opened it before
 * (`seen`), whether you archived it (`archived`), how many the list has on its day, every page's
 * (`dayCount`, in the app's time zone); the active profile's verdict, if it judged it; where the
 * search matched its title and company (`marks`), when there's a search.
 */
export type ListedJob = offersRepo.Job & {
  isNew: boolean;
  seen: boolean;
  archived: boolean;
  dayCount: number;
  marks?: Marks;
  ai?: Pick<AiVerdictRow, 'match' | 'score' | 'summary' | 'checks' | 'hadDescription' | 'bodyLeasing'>;
};

export const PAGE_SIZE = 50;

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
 * run that brought them ran (`latest`; null: no run in the log added offers), how many jobs
 * these filters find among the archived ones (`archivedCount`), and whether it's a search's, best
 * match first (`byMatch`) rather than newest first.
 */
export type JobPage = {
  byMatch: boolean;
  jobs: ListedJob[];
  total: number;
  newCount: number;
  archivedCount: number;
  latest: offersRepo.RunWindow | null;
};

export async function getJobs(opts: Query): Promise<JobPage> {
  // "today", "last 7 days", the day counts: days there
  const [zone, latest] = await Promise.all([appZone(), runsRepo.latestWithNewJobs()]);
  if (opts.latest && !latest) return { byMatch: false, jobs: [], total: 0, newCount: 0, archivedCount: 0, latest };
  const narrowed = {
    src: opts.src,
    ...zone.resolveRange(opts),
    ...(opts.latest && latest ? { newIn: latest } : {}),
  };
  // a search: the jobs the rest of the filter leaves, ranked here (lib/shared/search.ts), the list
  // then only those, in that order
  const found = opts.q ? rank(await offersRepo.searchable(narrowed), opts.q) : null;
  const filter = { ...narrowed, archived: opts.archived, ...(found && { ranked: found.ids }) };
  const marked = (job: ListedJob): ListedJob => (found ? { ...job, marks: found.marks.get(job.jobId) } : job);
  const byMatch = Boolean(found);
  if (!opts.ai) {
    const { rows, ...numbers } = await offersRepo.pageOfJobs(
      filter,
      opts.page,
      PAGE_SIZE,
      zone.tz,
      latest,
      opts.verdictsOf,
    );
    return { byMatch, jobs: rows.map(withVerdict).map(marked), ...numbers, latest };
  }
  const { profileId, version, rejected } = opts.ai;
  const verdicts = { profileId, version, match: !rejected };
  const { rows, ...numbers } = await offersRepo.pageOfJudgedJobs(
    filter,
    opts.page,
    PAGE_SIZE,
    zone.tz,
    verdicts,
    latest,
  );
  return { byMatch, jobs: rows.map(withVerdict).map(marked), ...numbers, latest };
}

type Verdict = NonNullable<ListedJob['ai']>;
type Nullable<T> = { [K in keyof T]: T[K] | null };
/** A row's verdict fields as `ai`; a job not judged (a left join's nulls, or none asked for) has none. */
function withVerdict<Row extends Omit<ListedJob, 'ai'>>(
  row: Row & Partial<Nullable<Verdict>>,
): Omit<Row, keyof Verdict> & Pick<ListedJob, 'ai'> {
  const { match, score, summary, checks, hadDescription, bodyLeasing, ...job } = row;
  if (match == null || score == null) return job;
  return {
    ...job,
    ai: {
      match,
      score,
      summary: summary ?? null,
      checks: checks ?? [],
      hadDescription: Boolean(hadDescription),
      bodyLeasing: bodyLeasing ?? null,
    },
  };
}

/** Jobs in the database (each once), ignoring every filter. */
export const getTotalCount = () => offersRepo.countJobs();
