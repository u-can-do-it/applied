import 'server-only';
import * as pairsRepo from '../db/repos/ai-dup-pairs';
import * as linksRepo from '../db/repos/job-links';
import * as offersRepo from '../db/repos/offers';
import * as queueRepo from '../db/repos/notify-queue';
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

/** The job that stays when two are merged: the earliest (on a tie, the smaller id); the other is merged into it. */
const keepFirst = <T extends { jobId: string; firstSeen: number }>(a: T, b: T): [keep: T, alias: T] =>
  a.firstSeen < b.firstSeen || (a.firstSeen === b.firstSeen && a.jobId < b.jobId) ? [a, b] : [b, a];

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
    const [{ jobId: keep }, { jobId: alias }] = keepFirst(
      { jobId: a, firstSeen: seenA },
      { jobId: b, firstSeen: seenB },
    );
    await linksRepo.mergeJobs(keep, alias);
    mergedInto.set(alias, keep);
    firstSeen.set(keep, Math.min(seenA, seenB));
    merged++;
  }

  return { checked: decided.length, merged, error: decided.length ? null : error };
}

/** in ai_dup_pairs, a pair you merged yourself */
export const BY_HAND = 'by hand';

/**
 * "Same job as…" in the offers: you say two jobs are one, and they're merged as the AI's are (the earliest
 * stays). The pair is recorded as decided, so the AI never asks about it; a queued offer of the merged-away
 * job isn't sent. Throws, in words for you, when they're one job already or one is gone.
 */
export async function mergeByHand(jobId: string, sameAs: string): Promise<{ kept: string; merged: string }> {
  // the ids the list showed: either may have been merged into another job since
  const [idA, idB] = await Promise.all([linksRepo.jobIdOf(jobId), linksRepo.jobIdOf(sameAs)]);
  if (idA === idB) throw new Error('They are one job already.');
  const jobs = await offersRepo.jobsById([idA, idB]);
  const [jobA, jobB] = [idA, idB].map((id) => jobs.find((job) => job.jobId === id));
  if (!jobA || !jobB) throw new Error('One of the two jobs is gone. Refresh the list and try again.');
  const [keep, alias] = keepFirst(
    { jobId: idA, firstSeen: Date.parse(jobA.firstSeen), title: jobA.title },
    { jobId: idB, firstSeen: Date.parse(jobB.firstSeen), title: jobB.title },
  );
  await linksRepo.mergeJobs(keep.jobId, alias.jobId);
  await pairsRepo.recordSame([idA, idB], 'Merged by hand.', BY_HAND);
  await queueRepo.dropMerged();
  return { kept: keep.title, merged: alias.title };
}
