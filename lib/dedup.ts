import 'server-only';
import * as pairsRepo from './db/repos/ai-dup-pairs';
import * as linksRepo from './db/repos/job-links';
import { aiConfig, decideDuplicates, type JobForAi } from './openai';
import { message } from './shared/errors';

type Candidate = pairsRepo.Candidate;

// AI duplicate check for one run's date range. The database proposes pairs whose keys differ
// but look alike (same / prefix company, similar title, <= 45 days apart, never asked before);
// the model says same or not; same pairs are merged into one job (job_links), verdicts follow.

const PAIRS_PER_CALL = 15;
const PARALLEL = 2;

const job = (c: Candidate, side: 'a' | 'b'): JobForAi => ({
  title: c[`${side}_title`],
  company: c[`${side}_company`],
  seniority: c[`${side}_seniority`],
  remote: c[`${side}_remote`],
  board: c[`${side}_src`],
  first_seen: c[`${side}_first_seen`],
  excerpt: c[`${side}_excerpt`],
});

/**
 * One round: up to PAIRS_PER_CALL x PARALLEL pairs. checked = 0 (and no error) means nothing is left.
 * `asked` holds pairs already sent in this slice, so a stale read can't loop.
 */
export async function dedupRound(range: { gte: string | null; lt: string | null }, asked: Set<string>) {
  const pending = (await pairsRepo.candidates(range, 80)).filter((c) => !asked.has(`${c.key_a}\u0001${c.key_b}`));
  if (!pending.length) return { checked: 0, merged: 0, error: null as string | null };

  const take = pending.slice(0, PAIRS_PER_CALL * PARALLEL);
  take.forEach((c) => asked.add(`${c.key_a}\u0001${c.key_b}`));
  const batches: Candidate[][] = [];
  for (let i = 0; i < take.length; i += PAIRS_PER_CALL) batches.push(take.slice(i, i + PAIRS_PER_CALL));

  const settled = await Promise.allSettled(
    batches.map((b) => decideDuplicates(b.map((c, i) => ({ p: i + 1, a: job(c, 'a'), b: job(c, 'b') })))),
  );

  const { model } = aiConfig().dedup;
  const decided: { c: Candidate; same: boolean; reason: string }[] = [];
  let error: string | null = null;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled')
      for (const d of s.value) decided.push({ c: batches[i][d.p - 1], same: d.same, reason: d.reason });
    else error = message(s.reason);
  });

  await pairsRepo.record(decided.map(({ c, same, reason }) => ({ keyA: c.key_a, keyB: c.key_b, same, reason, model })));

  // merge the "same" pairs; within this round, follow earlier merges so A=B, B=C ends up as one group
  const mergedInto = new Map<string, string>();
  const firstSeen = new Map<string, number>();
  for (const { c } of decided) {
    firstSeen.set(c.key_a, Math.min(firstSeen.get(c.key_a) ?? Infinity, Date.parse(c.a_first_seen)));
    firstSeen.set(c.key_b, Math.min(firstSeen.get(c.key_b) ?? Infinity, Date.parse(c.b_first_seen)));
  }
  const root = (k: string) => {
    for (let next = mergedInto.get(k); next !== undefined; next = mergedInto.get(k)) k = next;
    return k;
  };
  let merged = 0;
  for (const { c, same } of decided) {
    if (!same) continue;
    const a = root(c.key_a),
      b = root(c.key_b);
    if (a === b) continue;
    // every key of a decided pair is in firstSeen
    const fa = firstSeen.get(a) ?? Infinity,
      fb = firstSeen.get(b) ?? Infinity;
    const [keep, alias] = fa < fb || (fa === fb && a < b) ? [a, b] : [b, a]; // the earliest job stays the group
    await linksRepo.mergeJobs(keep, alias);
    mergedInto.set(alias, keep);
    firstSeen.set(keep, Math.min(fa, fb));
    merged++;
  }

  return { checked: decided.length, merged, error: decided.length ? null : error };
}
