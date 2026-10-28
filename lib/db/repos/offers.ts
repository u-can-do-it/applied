import 'server-only';
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  max,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { isArchived } from './archived-jobs';
import { dayOf, newestFirst, order, placeIn } from './offer-order';
import { isSeen } from './seen-jobs';
import { FAIR_FIT, GOOD_FIT, type ScoredTier } from '../../shared/fit';
import {
  aiVerdicts,
  archivedJobs,
  offers,
  offersUnique,
  jobLinks,
  type OfferRow,
  type OfferUniqueRow,
} from '../schema';

// The scraped offers: `offers` (every board's offer) and `offers_unique` (each job once, its
// earliest offer, a board's own over an aggregator's, with every board's link; a view, defined in
// drizzle/0014_offers_unique_own_board_first.sql).

/** A scrape run's time: the offers first seen in it are the ones it added (lib/db/repos/scrape-runs.ts). */
export type RunWindow = { startedAt: string; finishedAt: string };

/**
 * What narrows a list of jobs: a board, first_seen in [gte, lt), only the jobs first seen in a run
 * (`newIn`), the archived jobs instead of the others (`archived`), and only the jobs a search found
 * (`ranked`: their ids, best match first, the order the list then has, unless `byDate`: newest first);
 * `byFit`: by day, each day's best fit first, when the list has the verdicts.
 */
export type JobFilter = {
  ranked?: string[];
  byDate?: boolean;
  byFit?: boolean;
  src: string;
  gte?: string;
  lt?: string;
  newIn?: RunWindow;
  archived?: boolean;
};

/** One job as the lists show it. */
export type Job = Pick<
  OfferUniqueRow,
  'src' | 'id' | 'title' | 'company' | 'seniority' | 'remote' | 'url' | 'firstSeen' | 'jobId' | 'offers' | 'appliedAt'
>;
const jobColumns = {
  src: offersUnique.src,
  id: offersUnique.id,
  title: offersUnique.title,
  company: offersUnique.company,
  seniority: offersUnique.seniority,
  remote: offersUnique.remote,
  url: offersUnique.url,
  firstSeen: offersUnique.firstSeen,
  jobId: offersUnique.jobId,
  offers: offersUnique.offers,
  appliedAt: offersUnique.appliedAt,
} satisfies Record<keyof Job, unknown>;

/** first_seen in [gte, lt); either end may be open */
export const inRange = (range: { gte?: string | null; lt?: string | null }) =>
  and(
    range.gte ? gte(offersUnique.firstSeen, range.gte) : undefined,
    range.lt ? lt(offersUnique.firstSeen, range.lt) : undefined,
  );

/** first seen while that run ran (as Activity counts a run's offers) */
const firstSeenIn = (window: RunWindow) =>
  and(gte(offersUnique.firstSeen, window.startedAt), lte(offersUnique.firstSeen, window.finishedAt));

/** Per job: was it first seen in the latest run that brought new jobs (`latest`)? */
const newness = (latest: RunWindow | null) => (latest ? sql<boolean>`(${firstSeenIn(latest)})` : sql<boolean>`false`);

/**
 * Per job: how many of the jobs the list shows were first seen on its day, in time zone `tz`, on
 * every page (a window counts before the limit), for the list's day headings.
 */
const sameDay = (tz: string, where?: SQL) =>
  sql<number>`(count(*) ${where ? sql`filter (where ${where}) ` : sql``}over (partition by ${dayOf(tz)}))::int`;

/**
 * Per job: how many good and fair fits (lib/shared/fit.ts) the list has on its day, the same way, for
 * the day headings; none when it shows no verdicts (`judged` false).
 */
const fitsOfDay = (tz: string, judged: boolean) => {
  if (!judged) return { dayGood: sql<number>`0`, dayFair: sql<number>`0` };
  const allowed = eq(aiVerdicts.match, true);
  return { dayGood: sameDay(tz, and(allowed, scoredIn('good'))), dayFair: sameDay(tz, and(allowed, scoredIn('fair'))) };
};

/** a verdict's score in that tier's range (the match aside) */
const scoredIn = (tier: ScoredTier) =>
  tier === 'good'
    ? gte(aiVerdicts.score, GOOD_FIT)
    : and(gte(aiVerdicts.score, FAIR_FIT), lt(aiVerdicts.score, GOOD_FIT));

/** One of your applications at a job's company: its title, when, and whether it's that job's own (`self`). */
export type AppliedThere = { title: string; appliedAt: string; self: boolean };

/**
 * Per job: your applications at its company (an application's job id has the company's part before the
 * "|", as the job's company_key), the latest first; none for a job without a company. The application's
 * job id goes by another name in there, so the job's own (unqualified "dup_key") isn't taken for it.
 */
const appliedAtCompany = {
  companyApplied: sql<AppliedThere[]>`(select coalesce(json_agg(json_build_object(
         'title', a.title, 'appliedAt', a.applied_at, 'self', a.app_id = ${offersUnique.jobId}
       ) order by a.applied_at desc), '[]')
       from (select dup_key as app_id, title, applied_at from public.applications) a
       where ${offersUnique.companyKey} <> '' and split_part(a.app_id, '|', 1) = ${offersUnique.companyKey})`,
};

/** What the filter asks for, archived or not. */
function matching(filter: JobFilter): SQL | undefined {
  return and(
    filter.src ? arrayContains(offersUnique.boards, [filter.src]) : undefined,
    filter.ranked ? sql`${placeIn(filter.ranked)} is not null` : undefined,
    inRange(filter),
    filter.newIn ? firstSeenIn(filter.newIn) : undefined,
  );
}

/** The archived jobs with `archived`, the others without. */
const shown = (filter: JobFilter) => (filter.archived ? isArchived() : not(isArchived()));

/** count(*) of the rows where `condition` holds */
const countWhere = (condition: SQL | undefined) =>
  sql<number>`(count(*) filter (where ${condition ?? sql`true`}))::int`;

/**
 * The numbers under a list's filters (`matching`): how many it shows (`total`), how many of those the
 * latest run that brought new jobs (`latest`) brought, how many jobs are archived, and how many it
 * leaves out for their fit (`hidden`: underFit).
 */
const counts = (filter: JobFilter, latest: RunWindow | null, hidden?: SQL) => {
  const kept = hidden && not(hidden);
  return {
    total: countWhere(and(shown(filter), kept)),
    newCount: latest ? countWhere(and(shown(filter), kept, firstSeenIn(latest))) : sql<number>`0`,
    archivedCount: countWhere(and(isArchived(), kept)),
    hiddenCount: hidden ? countWhere(and(shown(filter), hidden)) : sql<number>`0`,
  };
};

/** A profile version: whose verdicts the list shows. */
type JudgedBy = { profileId: string; version: number };
const judgedBy = (by: JudgedBy) =>
  and(
    eq(aiVerdicts.jobId, offersUnique.jobId),
    eq(aiVerdicts.profileId, by.profileId),
    eq(aiVerdicts.version, by.version),
  );
/**
 * A job the list leaves out for its verdict: rejected, or scored under `minFit` (lib/listings/settings.ts);
 * one not judged stays. None at 0.
 */
const underFit = (minFit = 0) =>
  minFit > 0
    ? sql`(${aiVerdicts.jobId} is not null and (not ${aiVerdicts.match} or ${aiVerdicts.score} < ${minFit}))`
    : undefined;
const verdictColumns = {
  match: aiVerdicts.match,
  score: aiVerdicts.score,
  summary: aiVerdicts.summary,
  checks: aiVerdicts.checks,
  hadDescription: aiVerdicts.hadDescription,
  bodyLeasing: aiVerdicts.bodyLeasing,
};

/**
 * One page of jobs, and how many match in all (the pager needs the exact number), each marked new if
 * first seen in `latest`, the latest run that brought a new job, and with how many match on its day
 * in time zone `tz` (`dayCount`), and how many good and fair fits (`dayGood`, `dayFair`), and your applications at its
 * company (`companyApplied`, the latest first); `newCount`: how many of all were;
 * `archivedCount`: how many jobs these filters find among the archived ones. With `verdictsOf`, each
 * with that profile version's verdict, when it has one (its fields null when not), and with its `minFit`
 * the ones it rejected or scored lower left out, counted in `hiddenCount`.
 */
export async function pageOfJobs(
  filter: JobFilter,
  page: number,
  size: number,
  tz: string,
  latest: RunWindow | null = null,
  verdictsOf?: JudgedBy & { minFit?: number },
) {
  const where = matching(filter);
  const hidden = verdictsOf && underFit(verdictsOf.minFit);
  const columns = {
    ...jobColumns,
    isNew: newness(latest),
    seen: isSeen(),
    archived: isArchived(),
    dayCount: sameDay(tz),
    ...fitsOfDay(tz, Boolean(verdictsOf)),
    ...appliedAtCompany,
  };
  const rows = verdictsOf
    ? db()
        .select({ ...columns, ...verdictColumns })
        .from(offersUnique)
        .leftJoin(aiVerdicts, judgedBy(verdictsOf))
        .where(and(where, shown(filter), hidden && not(hidden)))
        .orderBy(...order(filter, tz, true))
        .limit(size)
        .offset(page * size)
    : db()
        .select(columns)
        .from(offersUnique)
        .where(and(where, shown(filter)))
        .orderBy(...order(filter, tz, false))
        .limit(size)
        .offset(page * size);
  // the counts need the verdicts only to leave some out
  const counted =
    verdictsOf && hidden
      ? db()
          .select(counts(filter, latest, hidden))
          .from(offersUnique)
          .leftJoin(aiVerdicts, judgedBy(verdictsOf))
          .where(where)
      : db().select(counts(filter, latest)).from(offersUnique).where(where);
  const [found, [numbers]] = await Promise.all([rows, counted]);
  return { rows: found, ...numbers };
}

/**
 * The same, for the jobs a profile version judged (matches, with `tier` only its good or fair ones, or the
 * rejected ones), with the verdict.
 */
export async function pageOfJudgedJobs(
  filter: JobFilter,
  page: number,
  size: number,
  tz: string,
  verdicts: JudgedBy & { match: boolean; tier?: ScoredTier },
  latest: RunWindow | null = null,
) {
  const judged = judgedBy(verdicts);
  const where = and(
    matching(filter),
    eq(aiVerdicts.match, verdicts.match),
    verdicts.tier ? scoredIn(verdicts.tier) : undefined,
  );
  const [rows, [numbers]] = await Promise.all([
    db()
      .select({
        ...jobColumns,
        isNew: newness(latest),
        seen: isSeen(),
        archived: isArchived(),
        dayCount: sameDay(tz),
        ...fitsOfDay(tz, true),
        ...appliedAtCompany,
        ...verdictColumns,
      })
      .from(offersUnique)
      .innerJoin(aiVerdicts, judged)
      .where(and(where, shown(filter)))
      .orderBy(...order(filter, tz, true))
      .limit(size)
      .offset(page * size),
    db().select(counts(filter, latest)).from(offersUnique).innerJoin(aiVerdicts, judged).where(where),
  ]);
  return { rows, ...numbers };
}

/**
 * What a search looks through: every job the rest of the filter leaves (archived or not: the list
 * counts the archived ones it finds too), its title and company, newest first.
 */
export function searchable(filter: Omit<JobFilter, 'ranked' | 'byDate' | 'byFit' | 'archived'>) {
  return db()
    .select({ jobId: offersUnique.jobId, title: offersUnique.title, company: offersUnique.company })
    .from(offersUnique)
    .where(matching(filter))
    .orderBy(...newestFirst);
}

/**
 * How many jobs there are, each once, ignoring every filter, the archived ones left out: the same
 * number as rows in offers_unique, counted on the tables instead (one id per job), without the view's
 * window function and its per-job lists.
 */
export async function countJobs(): Promise<number> {
  const jobId = sql`coalesce(${jobLinks.jobId}, ${offers.jobKey})`;
  const [{ jobs }] = await db()
    .select({ jobs: sql<number>`count(distinct ${jobId})::int` })
    .from(offers)
    .leftJoin(jobLinks, eq(jobLinks.jobKey, offers.jobKey))
    .leftJoin(archivedJobs, eq(archivedJobs.jobId, jobId))
    .where(sql`${archivedJobs.jobId} is null`);
  return jobs;
}

/** These jobs, each once with all its offers. */
export function jobsById(jobIds: string[]): Promise<Job[]> {
  if (!jobIds.length) return Promise.resolve([]);
  return db().select(jobColumns).from(offersUnique).where(inArray(offersUnique.jobId, jobIds));
}

/** One job by its id. */
export async function jobById(jobId: string): Promise<Job | null> {
  return (await jobsById([jobId]))[0] ?? null;
}

/** The scraped offer with this board's id, or with one of these links (none asked for: none). */
export async function findOffer(by: { src?: string; id?: string; urls: string[] }) {
  if (!(by.src && by.id) && !by.urls.length) return null;
  const found = await db()
    .select({
      src: offers.src,
      id: offers.id,
      title: offers.title,
      company: offers.company,
      url: offers.url,
      jobKey: offers.jobKey,
    })
    .from(offers)
    .where(
      or(
        by.src && by.id ? and(eq(offers.src, by.src), eq(offers.id, by.id)) : undefined,
        ...by.urls.map((url) => eq(offers.url, url)),
      ),
    )
    .limit(1);
  return first(found);
}

/** Which of these ids one board's offers already have. */
export async function knownIds(src: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db()
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.src, src), inArray(offers.id, ids)));
  return new Set(rows.map((row) => row.id));
}

export type NewOffer = Pick<OfferRow, 'src' | 'id' | 'title' | 'company' | 'seniority' | 'url'> & { remote: boolean };

/** An offer that was new to the database, with its job key (offers.job_key) and whether that job was known already. */
export type AddedOffer = { src: string; id: string; jobKey: string; seenBefore: boolean };

/**
 * Saves offers (public.jw_ingest_offers: one statement, so "seen before" means before this run).
 * Returns only the rows that were new, each with whether the same job was already known.
 */
export async function ingest(rows: NewOffer[]): Promise<AddedOffer[]> {
  if (!rows.length) return [];
  const added = await db().execute<{ src: string; id: string; dup_key: string; seen_before: boolean }>(
    sql`select src, id, dup_key, seen_before from public.jw_ingest_offers(${JSON.stringify(rows)}::jsonb)`,
  );
  // dup_key: the job key (the function's column kept its name)
  return added.map((row) => ({ src: row.src, id: row.id, jobKey: row.dup_key, seenBefore: row.seen_before }));
}

/** Offers per board and the newest one's first_seen, by board. */
export async function countPerBoard(): Promise<Record<string, { offers: number; newest: string | null }>> {
  const rows = await db()
    .select({ src: offers.src, offers: count(), newest: max(offers.firstSeen) })
    .from(offers)
    .groupBy(offers.src);
  return Object.fromEntries(rows.map(({ src, ...board }) => [src, board]));
}

/** When the newest offer was first seen (null: none yet). */
export async function newestFirstSeen(): Promise<string | null> {
  const newest = first(
    await db().select({ firstSeen: offers.firstSeen }).from(offers).orderBy(desc(offers.firstSeen)).limit(1),
  );
  return newest?.firstSeen ?? null;
}

/**
 * The job key of this company and title: the latest job of the title key the database gives them
 * (offers.dup_key is made the same way), the one begun last; the title key itself if no offer has it.
 */
export async function jobKeyOf(company: string | null, title: string): Promise<string> {
  const [{ jobKey }] = await db().execute<{ jobKey: string }>(
    sql`select coalesce(
          (select o.job_key from public.offers o where o.dup_key = k.title_key
            group by o.job_key order by min(o.first_seen) desc limit 1),
          k.title_key) as "jobKey"
        from (select public.jw_dup_key(${company}::text, ${title}::text) as title_key) k`,
  );
  return jobKey;
}
