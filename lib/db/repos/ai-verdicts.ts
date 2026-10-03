import 'server-only';
import { and, count, desc, eq, inArray, lt, notExists, sql } from 'drizzle-orm';
import { db } from '../client';
import { aiVerdicts, offersUnique, type AiVerdictRow } from '../schema';
import { inRange, type Job } from './offers';

// The AI's verdict on a job, per profile version: does it match, how well, and why.

type ProfileVersion = { id: string; version: number };
type Range = { gte?: string | null; lt?: string | null };

export type Verdict = Pick<AiVerdictRow, 'match' | 'score' | 'summary'>;

/** The verdicts this profile version has for these jobs, by job key. */
export async function forJobs(profile: ProfileVersion, keys: string[]): Promise<Map<string, Verdict>> {
  if (!keys.length) return new Map();
  const rows = await db()
    .select({
      dupKey: aiVerdicts.dupKey,
      match: aiVerdicts.match,
      score: aiVerdicts.score,
      summary: aiVerdicts.summary,
    })
    .from(aiVerdicts)
    .where(
      and(
        eq(aiVerdicts.profileId, profile.id),
        eq(aiVerdicts.version, profile.version),
        inArray(aiVerdicts.dupKey, keys),
      ),
    );
  return new Map(rows.map(({ dupKey, ...verdict }) => [dupKey, verdict]));
}

/** Saves them; a job judged again by the same profile version gets the new verdict. */
export async function save(rows: Omit<AiVerdictRow, 'createdAt'>[]) {
  if (!rows.length) return;
  await db()
    .insert(aiVerdicts)
    .values(rows)
    .onConflictDoUpdate({
      target: [aiVerdicts.profileId, aiVerdicts.version, aiVerdicts.dupKey],
      set: {
        match: sql`excluded.match`,
        score: sql`excluded.score`,
        summary: sql`excluded.summary`,
        checks: sql`excluded.checks`,
        hadDescription: sql`excluded.had_description`,
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

const unjudged = (profile: ProfileVersion) =>
  notExists(
    db()
      .select({ one: sql`1` })
      .from(aiVerdicts)
      .where(
        and(
          eq(aiVerdicts.profileId, profile.id),
          eq(aiVerdicts.version, profile.version),
          eq(aiVerdicts.dupKey, offersUnique.dupKey),
        ),
      ),
  );

/** Jobs in the range this profile version hasn't judged yet, newest first. */
export function unjudgedJobs(profile: ProfileVersion, range: Range, limit: number): Promise<Omit<Job, 'appliedAt'>[]> {
  return db()
    .select({
      src: offersUnique.src,
      id: offersUnique.id,
      title: offersUnique.title,
      company: offersUnique.company,
      seniority: offersUnique.seniority,
      remote: offersUnique.remote,
      url: offersUnique.url,
      firstSeen: offersUnique.firstSeen,
      dupKey: offersUnique.dupKey,
      copies: offersUnique.copies,
    })
    .from(offersUnique)
    .where(and(inRange(range), unjudged(profile)))
    .orderBy(desc(offersUnique.firstSeen))
    .limit(limit);
}

/** How many jobs in the range this profile version hasn't judged yet. */
export async function countUnjudged(profile: ProfileVersion, range: Range): Promise<number> {
  const [{ jobs }] = await db()
    .select({ jobs: count() })
    .from(offersUnique)
    .where(and(inRange(range), unjudged(profile)));
  return jobs;
}

/** Jobs in the range: all, judged by this profile version, and matching it. */
export async function rangeStats(profile: ProfileVersion, range: Range) {
  const [stats] = await db()
    .select({
      total: count(),
      checked: count(aiVerdicts.dupKey),
      matched: sql<number>`count(*) filter (where ${aiVerdicts.match})`.mapWith(Number),
    })
    .from(offersUnique)
    .leftJoin(
      aiVerdicts,
      and(
        eq(aiVerdicts.dupKey, offersUnique.dupKey),
        eq(aiVerdicts.profileId, profile.id),
        eq(aiVerdicts.version, profile.version),
      ),
    )
    .where(inRange(range));
  return stats;
}
