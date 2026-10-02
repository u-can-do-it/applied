import 'server-only';
import { aiConfig, decideDuplicates, type JobForAi } from './openai';
import { rest, restUrl, rpcUrl } from './supabase';

// AI duplicate check for one run's date range. The database proposes pairs whose keys differ
// but look alike (same / prefix company, similar title, <= 45 days apart, never asked before);
// the model says same or not; same pairs are merged into one job (job_links), verdicts follow.

type Candidate = {
  key_a: string; key_b: string; sim: number;
  a_title: string; a_company: string | null; a_seniority: string | null; a_remote: boolean | null; a_src: string; a_first_seen: string; a_excerpt: string | null;
  b_title: string; b_company: string | null; b_seniority: string | null; b_remote: boolean | null; b_src: string; b_first_seen: string; b_excerpt: string | null;
};

const PAIRS_PER_CALL = 15;
const PARALLEL = 2;

const job = (c: Candidate, side: 'a' | 'b'): JobForAi => ({
  title: c[`${side}_title`], company: c[`${side}_company`], seniority: c[`${side}_seniority`], remote: c[`${side}_remote`],
  board: c[`${side}_src`], first_seen: c[`${side}_first_seen`], excerpt: c[`${side}_excerpt`],
});

async function candidates(range: { gte: string | null; lt: string | null }, limit: number): Promise<Candidate[]> {
  const url = rpcUrl('ai_dup_candidates', { p_gte: range.gte, p_lt: range.lt, p_limit: limit });
  return (await rest(url)).json();
}

/**
 * One round: up to PAIRS_PER_CALL x PARALLEL pairs. checked = 0 (and no error) means nothing is left.
 * `asked` holds pairs already sent in this slice, so a stale read can't loop.
 */
export async function dedupRound(range: { gte: string | null; lt: string | null }, asked: Set<string>) {
  const pending = (await candidates(range, 80)).filter((c) => !asked.has(`${c.key_a}\u0001${c.key_b}`));
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
    if (s.status === 'fulfilled') for (const d of s.value) decided.push({ c: batches[i][d.p - 1], same: d.same, reason: d.reason });
    else error = s.reason instanceof Error ? s.reason.message : String(s.reason);
  });

  if (decided.length) {
    const url = restUrl('ai_dup_pairs');
    url.searchParams.set('on_conflict', 'key_a,key_b');
    await rest(url, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(decided.map(({ c, same, reason }) => ({ key_a: c.key_a, key_b: c.key_b, same, reason, model }))),
    });
  }

  // merge the "same" pairs; within this round, follow earlier merges so A=B, B=C ends up as one group
  const mergedInto = new Map<string, string>();
  const firstSeen = new Map<string, number>();
  for (const { c } of decided) {
    firstSeen.set(c.key_a, Math.min(firstSeen.get(c.key_a) ?? Infinity, Date.parse(c.a_first_seen)));
    firstSeen.set(c.key_b, Math.min(firstSeen.get(c.key_b) ?? Infinity, Date.parse(c.b_first_seen)));
  }
  const root = (k: string) => {
    while (mergedInto.has(k)) k = mergedInto.get(k)!;
    return k;
  };
  let merged = 0;
  for (const { c, same } of decided) {
    if (!same) continue;
    const a = root(c.key_a), b = root(c.key_b);
    if (a === b) continue;
    const fa = firstSeen.get(a)!, fb = firstSeen.get(b)!;
    const [keep, alias] = fa < fb || (fa === fb && a < b) ? [a, b] : [b, a]; // the earliest job stays the group
    await rest(restUrl('rpc/jw_merge_jobs'), { method: 'POST', body: JSON.stringify({ p_keep: keep, p_alias: alias }) });
    mergedInto.set(alias, keep);
    firstSeen.set(keep, Math.min(fa, fb));
    merged++;
  }

  return { checked: decided.length, merged, error: decided.length ? null : error };
}
