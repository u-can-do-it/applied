import 'server-only';
import { and, arrayContains, asc, count, desc, eq, gte, inArray, lt, lte, max, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { isSeen } from './seen-jobs';
import { aiVerdicts, offers, offersUnique, jobLinks, type OfferRow, type OfferUniqueRow } from '../schema';

// The scraped offers: `offers` (every board's offer) and `offers_unique` (each job once, its
// earliest offer with every board's link; a view, defined in drizzle/0002_functions.sql).

/** A scrape run's time: the offers first seen in it are the ones it added (lib/db/repos/scrape-runs.ts). */
export type RunWindow = { startedAt: string; finishedAt: string };

/**
 * What narrows a list of jobs: every word in the title or the company, a board, first_seen in
 * [gte, lt), and only the jobs first seen in a run (`newIn`).
 */
export type JobFilter = { words: string[]; src: string; gte?: string; lt?: string; newIn?: RunWindow };

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

/** Per job: was it first seen in the latest run that brought new jobs (`latest`)? And how many of the list were. */
const newness = (latest: RunWindow | null) => ({
  isNew: latest ? sql<boolean>`(${firstSeenIn(latest)})` : sql<boolean>`false`,
  newCount: latest ? sql<number>`(count(*) filter (where ${firstSeenIn(latest)}))::int` : sql<number>`0`,
});

/** case-insensitively, `word` anywhere in it; `%` and `_` in the word are just characters */
const contains = (column: typeof offersUnique.title | typeof offersUnique.company, word: string) =>
  sql`${column} ilike ${`%${word.replace(/[\\%_]/g, '\\$&')}%`} escape '\\'`;

function matching(filter: JobFilter): SQL | undefined {
  return and(
    filter.src ? arrayContains(offersUnique.boards, [filter.src]) : undefined,
    ...filter.words.map((word) => or(contains(offersUnique.title, word), contains(offersUnique.company, word))),
    inRange(filter),
    filter.newIn ? firstSeenIn(filter.newIn) : undefined,
  );
}

// newest first; the board and id make the order total, so pages don't overlap
const newestFirst = [desc(offersUnique.firstSeen), asc(offersUnique.src), asc(offersUnique.id)];

/**
 * One page of jobs, and how many match in all (the pager needs the exact number), each marked new if
 * first seen in `latest`, the latest run that brought a new job; `newCount`: how many of all were.
 */
export async function pageOfJobs(filter: JobFilter, page: number, size: number, latest: RunWindow | null = null) {
  const where = matching(filter);
  const { isNew, newCount } = newness(latest);
  const [rows, [counts]] = await Promise.all([
    db()
      .select({ ...jobColumns, isNew, seen: isSeen() })
      .from(offersUnique)
      .where(where)
      .orderBy(...newestFirst)
      .limit(size)
      .offset(page * size),
    db().select({ total: count(), newCount }).from(offersUnique).where(where),
  ]);
  return { rows, ...counts };
}

/** The same, for the jobs a profile version judged (matches, or the rejected ones), with the verdict. */
export async function pageOfJudgedJobs(
  filter: JobFilter,
  page: number,
  size: number,
  verdicts: { profileId: string; version: number; match: boolean },
  latest: RunWindow | null = null,
) {
  const judged = and(
    eq(aiVerdicts.jobId, offersUnique.jobId),
    eq(aiVerdicts.profileId, verdicts.profileId),
    eq(aiVerdicts.version, verdicts.version),
  );
  const where = and(matching(filter), eq(aiVerdicts.match, verdicts.match));
  const { isNew, newCount } = newness(latest);
  const [rows, [counts]] = await Promise.all([
    db()
      .select({
        ...jobColumns,
        isNew,
        seen: isSeen(),
        match: aiVerdicts.match,
        score: aiVerdicts.score,
        summary: aiVerdicts.summary,
        checks: aiVerdicts.checks,
        hadDescription: aiVerdicts.hadDescription,
      })
      .from(offersUnique)
      .innerJoin(aiVerdicts, judged)
      .where(where)
      .orderBy(...newestFirst)
      .limit(size)
      .offset(page * size),
    db().select({ total: count(), newCount }).from(offersUnique).innerJoin(aiVerdicts, judged).where(where),
  ]);
  return { rows, ...counts };
}

/**
 * How many jobs there are, each once, ignoring every filter: the same number as rows in
 * offers_unique, counted on the tables instead (one id per job), without the view's window
 * function and its per-job lists.
 */
export async function countJobs(): Promise<number> {
  const [{ jobs }] = await db()
    .select({ jobs: sql<number>`count(distinct coalesce(${jobLinks.jobId}, ${offers.titleKey}))::int` })
    .from(offers)
    .leftJoin(jobLinks, eq(jobLinks.titleKey, offers.titleKey));
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
