import 'server-only';
import { and, count, desc, eq, exists, gte, inArray, lt, notExists, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { aiVerdicts, offerDetails, offersUnique, type AiVerdictRow } from '../schema';
import { inRange, type Job } from './offers';

// The AI's verdict on a job, per profile version: does it match, how well, and why.

type ProfileVersion = { id: string; version: number };
type Range = { gte?: string | null; lt?: string | null };

export type Verdict = Pick<AiVerdictRow, 'match' | 'score' | 'summary'>;
/**
 * A verdict with its reasons: the requirement checklist, and whether the ad text was there; and
 * whether it's a software house's / body leasing firm's job.
 */
export type Fit = Pick<AiVerdictRow, 'match' | 'score' | 'summary' | 'checks' | 'hadDescription' | 'bodyLeasing'>;

/** The verdicts this profile version has for these jobs, by job id. */
export async function forJobs(profile: ProfileVersion, jobIds: string[]): Promise<Map<string, Verdict>> {
  if (!jobIds.length) return new Map();
  const rows = await db()
    .select({
      jobId: aiVerdicts.jobId,
      match: aiVerdicts.match,
      score: aiVerdicts.score,
      summary: aiVerdicts.summary,
    })
    .from(aiVerdicts)
    .where(
      and(
        eq(aiVerdicts.profileId, profile.id),
        eq(aiVerdicts.version, profile.version),
        inArray(aiVerdicts.jobId, jobIds),
      ),
    );
  return new Map(rows.map(({ jobId, ...verdict }) => [jobId, verdict]));
}

/** This profile version's verdict on one job, with its checklist; null if it hasn't judged it. */
export async function ofJob(profile: ProfileVersion, jobId: string): Promise<Fit | null> {
  const rows = await db()
    .select({
      match: aiVerdicts.match,
      score: aiVerdicts.score,
      summary: aiVerdicts.summary,
      checks: aiVerdicts.checks,
      hadDescription: aiVerdicts.hadDescription,
      bodyLeasing: aiVerdicts.bodyLeasing,
    })
    .from(aiVerdicts)
    .where(
      and(eq(aiVerdicts.profileId, profile.id), eq(aiVerdicts.version, profile.version), eq(aiVerdicts.jobId, jobId)),
    );
  return first(rows);
}

/** Saves them; a job judged again by the same profile version gets the new verdict. */
export async function save(rows: Omit<AiVerdictRow, 'createdAt'>[]) {
  if (!rows.length) return;
  await db()
    .insert(aiVerdicts)
    .values(rows)
    .onConflictDoUpdate({
      target: [aiVerdicts.profileId, aiVerdicts.version, aiVerdicts.jobId],
      set: {
        match: sql`excluded.match`,
        score: sql`excluded.score`,
        summary: sql`excluded.summary`,
        checks: sql`excluded.checks`,
        hadDescription: sql`excluded.had_description`,
        bodyLeasing: sql`excluded.body_leasing`,
      },
    });
}

/** The verdicts of a profile's versions before this one. */
export async function removeOlderThan(profile: ProfileVersion) {
  await db()
    .delete(aiVerdicts)
    .where(and(eq(aiVerdicts.profileId, profile.id), lt(aiVerdicts.version, profile.version)));
}

// ---- jobs and their verdicts (offers_unique) --------------------------------------------------

/** This profile version's verdict on the job, as a subquery; `also`: what else it must be. */
const verdictOn = (profile: ProfileVersion, also?: SQL) =>
  db()
    .select({ one: sql`1` })
    .from(aiVerdicts)
    .where(
      and(
        eq(aiVerdicts.profileId, profile.id),
        eq(aiVerdicts.version, profile.version),
        eq(aiVerdicts.jobId, offersUnique.jobId),
        also,
      ),
    );

const unjudged = (profile: ProfileVersion) => notExists(verdictOn(profile));

/**
 * The job's ad may yet be read: one of its offers isn't known to have no ad text (offer_details 'empty').
 * A job whose ads all came back empty is never judged: the AI gets no job without its ad.
 */
const adMayBeRead = sql<boolean>`exists (
  select 1 from jsonb_array_elements(${offersUnique.offers}) copy
  left join ${offerDetails} on ${offerDetails.src} = copy ->> 'src' and ${offerDetails.id} = copy ->> 'id'
  where ${offerDetails.status} is distinct from 'empty'
)`;

const pendingColumns = {
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
};

/** Jobs in the range this profile version hasn't judged yet and that may get their ad, newest first. */
export function unjudgedJobs(profile: ProfileVersion, range: Range, limit: number): Promise<Omit<Job, 'appliedAt'>[]> {
  return db()
    .select(pendingColumns)
    .from(offersUnique)
    .where(and(inRange(range), unjudged(profile), adMayBeRead))
    .orderBy(desc(offersUnique.firstSeen))
    .limit(limit);
}

/** How many jobs in the range this profile version hasn't judged yet and that may get their ad. */
export async function countUnjudged(profile: ProfileVersion, range: Range): Promise<number> {
  const [{ jobs }] = await db()
    .select({ jobs: count() })
    .from(offersUnique)
    .where(and(inRange(range), unjudged(profile), adMayBeRead));
  return jobs;
}

/**
 * Jobs first seen since `since` that wait for their ad to be judged, newest first: not judged by this
 * profile version (their ad couldn't be read yet), or judged on the title alone (before every
 * judgment needed the ad). Not the ones whose ads are known to have no text.
 */
export function waitingForAd(profile: ProfileVersion, since: string, limit: number): Promise<Omit<Job, 'appliedAt'>[]> {
  return db()
    .select(pendingColumns)
    .from(offersUnique)
    .where(
      and(
        gte(offersUnique.firstSeen, since),
        or(unjudged(profile), exists(verdictOn(profile, eq(aiVerdicts.hadDescription, false)))),
        adMayBeRead,
      ),
    )
    .orderBy(desc(offersUnique.firstSeen))
    .limit(limit);
}

/** Jobs in the range: all, judged by this profile version, and matching it. */
export async function rangeStats(profile: ProfileVersion, range: Range) {
  const [stats] = await db()
    .select({
      total: count(),
      checked: count(aiVerdicts.jobId),
      matched: sql<number>`count(*) filter (where ${aiVerdicts.match})`.mapWith(Number),
    })
    .from(offersUnique)
    .leftJoin(
      aiVerdicts,
      and(
        eq(aiVerdicts.jobId, offersUnique.jobId),
        eq(aiVerdicts.profileId, profile.id),
        eq(aiVerdicts.version, profile.version),
      ),
    )
    .where(inRange(range));
  return stats;
}
