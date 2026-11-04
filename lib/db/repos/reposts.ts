import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '../client';
import { jobsById, type Job } from './offers';

// A repost's earlier job: the one a job was posted as before, 30+ days earlier (0029_repost_own_job.sql). An
// exact repost shares a title key with it; a reworded one, the AI called the same as it (ai_dup_pairs) but
// didn't merge them, being that far apart (lib/ai/merge-duplicates.ts, 0034_repost_links.sql). Of several, the
// latest begun before the job.

/** The earlier job as a repost's badge shows it and opens its window. */
export type RepostOf = Pick<Job, 'jobId' | 'src' | 'id' | 'title' | 'company' | 'url' | 'firstSeen' | 'appliedAt'>;

/** Of these jobs, each repost's earlier job, by the repost's id. */
export async function previousJobs(jobIds: string[]): Promise<Map<string, RepostOf>> {
  if (!jobIds.length) return new Map();
  const rows = await db().execute<{ job_id: string; previous: string }>(sql`
    with ids as (select jsonb_array_elements_text(${JSON.stringify(jobIds)}::jsonb) as job_id),
    offer_jobs as (
      select o.dup_key as title_key, o.first_seen, coalesce(l.job_key, o.job_key) as job_id
      from public.offers o
      left join public.job_links l on l.dup_key = o.job_key
    ),
    began as (select j.job_id, min(j.first_seen) as began from offer_jobs j group by j.job_id),
    -- the AI's "same" pairs that are still two jobs, each way round
    same as (
      select coalesce(la.job_key, d.key_a) as ja, coalesce(lb.job_key, d.key_b) as jb
      from public.ai_dup_pairs d
      left join public.job_links la on la.dup_key = d.key_a
      left join public.job_links lb on lb.dup_key = d.key_b
      where d.same
    ),
    linked as (
      select a.job_id, b.job_id as previous
      from offer_jobs a
      join offer_jobs b on b.title_key = a.title_key and b.job_id <> a.job_id
      where a.job_id in (select i.job_id from ids i)
      union
      select s.ja, s.jb from same s where s.ja in (select i.job_id from ids i) and s.ja <> s.jb
      union
      select s.jb, s.ja from same s where s.jb in (select i.job_id from ids i) and s.ja <> s.jb
    )
    select distinct on (k.job_id) k.job_id, k.previous
    from linked k
    join began j on j.job_id = k.job_id
    join began p on p.job_id = k.previous
    where p.began < j.began
    order by k.job_id, p.began desc, k.previous
  `);
  const previous = Array.from(rows);
  if (!previous.length) return new Map();
  const jobs = new Map(
    (await jobsById([...new Set(previous.map((row) => row.previous))])).map((job) => [job.jobId, job]),
  );
  const found = new Map<string, RepostOf>();
  for (const row of previous) {
    const job = jobs.get(row.previous);
    if (!job) continue;
    const { jobId, src, id, title, company, url, firstSeen, appliedAt } = job;
    found.set(row.job_id, { jobId, src, id, title, company, url, firstSeen, appliedAt });
  }
  return found;
}

/** These rows (jobs, applications), each a repost with its earlier job (`repostOf`). */
export async function withReposts<Row extends { jobId: string }>(
  rows: Row[],
): Promise<(Row & { repostOf?: RepostOf })[]> {
  const reposts = await previousJobs(rows.map((row) => row.jobId));
  return rows.map((row) => {
    const repostOf = reposts.get(row.jobId);
    return repostOf ? { ...row, repostOf } : row;
  });
}
