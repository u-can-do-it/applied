import 'server-only';
import {
  and,
  arrayContains,
  asc,
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
import { isSeen } from './seen-jobs';
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
// earliest offer with every board's link; a view, defined in drizzle/0002_functions.sql).

/** A scrape run's time: the offers first seen in it are the ones it added (lib/db/repos/scrape-runs.ts). */
export type RunWindow = { startedAt: string; finishedAt: string };

/**
 * What narrows a list of jobs: a board, first_seen in [gte, lt), only the jobs first seen in a run
 * (`newIn`), the archived jobs instead of the others (`archived`), and only the jobs a search found
 * (`ranked`: their ids, best match first, the order the list then has).
 */
export type JobFilter = {
  ranked?: string[];
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
const sameDay = (tz: string) =>
  sql<number>`(count(*) over (partition by (${offersUnique.firstSeen} at time zone ${tz})::date))::int`;

/** a search's jobs as {job id: its place}, one parameter however many there are */
const placeIn = (ranked: string[]) =>
  sql`(${JSON.stringify(Object.fromEntries(ranked.map((jobId, place) => [jobId, place])))}::jsonb ->> ${offersUnique.jobId})::int`;

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
 * latest run that brought new jobs (`latest`) brought, and how many jobs are archived.
 */
const counts = (filter: JobFilter, latest: RunWindow | null) => ({
  total: countWhere(shown(filter)),
  newCount: latest ? countWhere(and(shown(filter), firstSeenIn(latest))) : sql<number>`0`,
  archivedCount: countWhere(isArchived()),
});

// newest first; the board and id make the order total, so pages don't overlap
const newestFirst = [desc(offersUnique.firstSeen), asc(offersUnique.src), asc(offersUnique.id)];
/** a search's best match first, the others newest first */
const order = (filter: JobFilter) => (filter.ranked ? [asc(placeIn(filter.ranked)), ...newestFirst] : newestFirst);

/** A profile version: whose verdicts the list shows. */
type JudgedBy = { profileId: string; version: number };
const judgedBy = (by: JudgedBy) =>
  and(
    eq(aiVerdicts.jobId, offersUnique.jobId),
    eq(aiVerdicts.profileId, by.profileId),
    eq(aiVerdicts.version, by.version),
  );
const verdictColumns = {
  match: aiVerdicts.match,
  score: aiVerdicts.score,
  summary: aiVerdicts.summary,
  checks: aiVerdicts.checks,
  hadDescription: aiVerdicts.hadDescription,
};

/**
 * One page of jobs, and how many match in all (the pager needs the exact number), each marked new if
 * first seen in `latest`, the latest run that brought a new job, and with how many match on its day
 * in time zone `tz` (`dayCount`); `newCount`: how many of all were;
 * `archivedCount`: how many jobs these filters find among the archived ones. With `verdictsOf`, each
 * with that profile version's verdict, when it has one (its fields null when not).
 */
export async function pageOfJobs(
  filter: JobFilter,
  page: number,
  size: number,
  tz: string,
  latest: RunWindow | null = null,
  verdictsOf?: JudgedBy,
) {
  const where = matching(filter);
  const columns = {
    ...jobColumns,
    isNew: newness(latest),
    seen: isSeen(),
    archived: isArchived(),
    dayCount: sameDay(tz),
  };
  const rows = verdictsOf
    ? db()
        .select({ ...columns, ...verdictColumns })
        .from(offersUnique)
        .leftJoin(aiVerdicts, judgedBy(verdictsOf))
        .where(and(where, shown(filter)))
        .orderBy(...order(filter))
        .limit(size)
        .offset(page * size)
    : db()
        .select(columns)
        .from(offersUnique)
        .where(and(where, shown(filter)))
        .orderBy(...order(filter))
        .limit(size)
        .offset(page * size);
  const [found, [numbers]] = await Promise.all([
    rows,
    db().select(counts(filter, latest)).from(offersUnique).where(where),
  ]);
  return { rows: found, ...numbers };
}

/** The same, for the jobs a profile version judged (matches, or the rejected ones), with the verdict. */
export async function pageOfJudgedJobs(
  filter: JobFilter,
  page: number,
  size: number,
  tz: string,
  verdicts: JudgedBy & { match: boolean },
  latest: RunWindow | null = null,
) {
  const judged = judgedBy(verdicts);
  const where = and(matching(filter), eq(aiVerdicts.match, verdicts.match));
  const [rows, [numbers]] = await Promise.all([
    db()
      .select({
        ...jobColumns,
        isNew: newness(latest),
        seen: isSeen(),
        archived: isArchived(),
        dayCount: sameDay(tz),
        ...verdictColumns,
      })
      .from(offersUnique)
      .innerJoin(aiVerdicts, judged)
      .where(and(where, shown(filter)))
      .orderBy(...order(filter))
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
export function searchable(filter: Omit<JobFilter, 'ranked' | 'archived'>) {
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
  const jobId = sql`coalesce(${jobLinks.jobId}, ${offers.titleKey})`;
  const [{ jobs }] = await db()
    .select({ jobs: sql<number>`count(distinct ${jobId})::int` })
    .from(offers)
    .leftJoin(jobLinks, eq(jobLinks.titleKey, offers.titleKey))
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
      titleKey: offers.titleKey,
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

/** An offer that was new to the database, with its title key and whether that title key was known already. */
export type AddedOffer = { src: string; id: string; titleKey: string; seenBefore: boolean };

/**
 * Saves offers (public.jw_ingest_offers: one statement, so "seen before" means before this run).
 * Returns only the rows that were new, each with whether the same job was already known.
 */
export async function ingest(rows: NewOffer[]): Promise<AddedOffer[]> {
  if (!rows.length) return [];
  const added = await db().execute<{ src: string; id: string; dup_key: string; seen_before: boolean }>(
    sql`select src, id, dup_key, seen_before from public.jw_ingest_offers(${JSON.stringify(rows)}::jsonb)`,
  );
  return added.map((row) => ({ src: row.src, id: row.id, titleKey: row.dup_key, seenBefore: row.seen_before }));
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

/** The title key the database gives this company and title (offers.dup_key is made the same way). */
export async function titleKeyOf(company: string | null, title: string): Promise<string> {
  const [{ titleKey }] = await db().execute<{ titleKey: string }>(
    sql`select public.jw_dup_key(${company}::text, ${title}::text) as "titleKey"`,
  );
  return titleKey;
}
