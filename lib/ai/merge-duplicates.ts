import 'server-only';
import * as pairsRepo from '../db/repos/ai-dup-pairs';
import * as linksRepo from '../db/repos/job-links';
import { aiConfig, decideDuplicates, type JobForAi } from './openai';
import { message } from '../shared/errors';

type Candidate = pairsRepo.Candidate;

// AI duplicate check for one run's date range. The database proposes pairs of jobs whose ids
// differ but look alike (same / prefix company, similar title, <= 45 days apart, never asked
// before); the model says same or not; same pairs are merged into one job (job_links), verdicts follow.

const PAIRS_PER_CALL = 15;
const PARALLEL = 2;

// the field names are what the prompt shows the model
const forAi = (job: pairsRepo.CandidateJob): JobForAi => ({
  title: job.title,
  company: job.company,
  seniority: job.seniority,
  remote: job.remote,
  board: job.src,
  first_seen: job.firstSeen,
  excerpt: job.excerpt,
});

const pairId = (pair: Candidate) => `${pair.jobIdA}\u0001${pair.jobIdB}`;

/**
 * One round: up to PAIRS_PER_CALL x PARALLEL pairs. checked = 0 (and no error) means nothing is left.
 * `asked` holds pairs already sent in this slice, so a stale read can't loop.
 */
export async function mergeDuplicatesRound(range: { gte: string | null; lt: string | null }, asked: Set<string>) {
  const pending = (await pairsRepo.candidates(range, 80)).filter((pair) => !asked.has(pairId(pair)));
  if (!pending.length) return { checked: 0, merged: 0, error: null as string | null };

  const take = pending.slice(0, PAIRS_PER_CALL * PARALLEL);
  take.forEach((pair) => asked.add(pairId(pair)));
  const batches: Candidate[][] = [];
  for (let i = 0; i < take.length; i += PAIRS_PER_CALL) batches.push(take.slice(i, i + PAIRS_PER_CALL));

  const settled = await Promise.allSettled(
    batches.map((batch) =>
      decideDuplicates(batch.map((pair, i) => ({ p: i + 1, a: forAi(pair.a), b: forAi(pair.b) }))),
    ),
  );

  const { model } = aiConfig().dedup;
  const decided: { pair: Candidate; same: boolean; reason: string }[] = [];
  let error: string | null = null;
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled')
      for (const decision of result.value)
        decided.push({ pair: batches[i][decision.p - 1], same: decision.same, reason: decision.reason });
    else error = message(result.reason);
  });

  await pairsRepo.record(
    decided.map(({ pair, same, reason }) => ({ jobIdA: pair.jobIdA, jobIdB: pair.jobIdB, same, reason, model })),
  );

  // merge the "same" pairs; within this round, follow earlier merges so A=B, B=C ends up as one job
  const mergedInto = new Map<string, string>();
  const firstSeen = new Map<string, number>();
  for (const { pair } of decided) {
    firstSeen.set(pair.jobIdA, Math.min(firstSeen.get(pair.jobIdA) ?? Infinity, Date.parse(pair.a.firstSeen)));
    firstSeen.set(pair.jobIdB, Math.min(firstSeen.get(pair.jobIdB) ?? Infinity, Date.parse(pair.b.firstSeen)));
  }
  const root = (jobId: string) => {
    for (let next = mergedInto.get(jobId); next !== undefined; next = mergedInto.get(jobId)) jobId = next;
    return jobId;
  };
  let merged = 0;
  for (const { pair, same } of decided) {
    if (!same) continue;
    const a = root(pair.jobIdA),
      b = root(pair.jobIdB);
    if (a === b) continue;
    // every job of a decided pair is in firstSeen
    const seenA = firstSeen.get(a) ?? Infinity,
      seenB = firstSeen.get(b) ?? Infinity;
    const [keep, alias] = seenA < seenB || (seenA === seenB && a < b) ? [a, b] : [b, a]; // the earliest job stays
    await linksRepo.mergeJobs(keep, alias);
    mergedInto.set(alias, keep);
    firstSeen.set(keep, Math.min(seenA, seenB));
    merged++;
  }

  return { checked: decided.length, merged, error: decided.length ? null : error };
}
