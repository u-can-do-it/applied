import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '../client';
import { aiDupPairs, type AiDupPairRow } from '../schema';

// Pairs of jobs that look alike, and what the AI said about each pair (so none is asked twice).

/** A row of public.ai_dup_candidates, as the function names its columns. */
type CandidateRow = {
  key_a: string;
  key_b: string;
  sim: number;
  a_title: string;
  a_company: string | null;
  a_seniority: string | null;
  a_remote: boolean | null;
  a_src: string;
  a_first_seen: string;
  a_excerpt: string | null;
  b_title: string;
  b_company: string | null;
  b_seniority: string | null;
  b_remote: boolean | null;
  b_src: string;
  b_first_seen: string;
  b_excerpt: string | null;
};

/** One job of a pair: its earliest offer, and the start of an ad text. */
export type CandidateJob = {
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean | null;
  src: string;
  firstSeen: string;
  excerpt: string | null;
};

/** Two jobs that may be the same: their ids (jobIdA < jobIdB), title similarity, and both jobs. */
export type Candidate = { jobIdA: string; jobIdB: string; similarity: number; a: CandidateJob; b: CandidateJob };

const side = (row: CandidateRow, prefix: 'a' | 'b'): CandidateJob => ({
  title: row[`${prefix}_title`],
  company: row[`${prefix}_company`],
  seniority: row[`${prefix}_seniority`],
  remote: row[`${prefix}_remote`],
  src: row[`${prefix}_src`],
  firstSeen: row[`${prefix}_first_seen`],
  excerpt: row[`${prefix}_excerpt`],
});

/**
 * Pairs worth asking about, most alike first: jobs in the range against any job up to 45 days
 * apart, same or prefix company, similar title, never decided (pg_trgm; see the function).
 */
export async function candidates(
  range: { gte: string | null; lt: string | null },
  limit: number,
): Promise<Candidate[]> {
  const rows = await db().execute<CandidateRow>(
    sql`select * from public.ai_dup_candidates(${range.gte}::timestamptz, ${range.lt}::timestamptz, ${limit}::int)`,
  );
  return Array.from(rows, (row) => ({
    jobIdA: row.key_a,
    jobIdB: row.key_b,
    similarity: row.sim,
    a: side(row, 'a'),
    b: side(row, 'b'),
  }));
}

/** Records the AI's decisions; a pair decided again gets the new answer. */
export async function record(rows: Pick<AiDupPairRow, 'jobIdA' | 'jobIdB' | 'same' | 'reason' | 'model'>[]) {
  if (!rows.length) return;
  await db()
    .insert(aiDupPairs)
    .values(rows)
    .onConflictDoUpdate({
      target: [aiDupPairs.jobIdA, aiDupPairs.jobIdB],
      set: { same: sql`excluded.same`, reason: sql`excluded.reason`, model: sql`excluded.model` },
    });
}
