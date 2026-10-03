import 'server-only';
import { dedupRound } from './dedup';
import { assessOffers, type OfferForAi } from './openai';
import { getProfile, type Profile, type ProfileWithFile } from './profiles';
import { scrapeOffer } from './scrape';
import { rangeTotal, rest, restUrl, rpcUrl } from './supabase';

// Manual AI runs: "check every offer in this date range that this profile hasn't judged yet".
// Phase 1 asks the AI about likely duplicates in the range (low effort) and merges them;
// phase 2 assesses each remaining job against the profile (high effort). Verdicts are stored per
// profile version and per job, so a second "today" run only sends what's new.
//
// The work happens in after() on the server, in slices of a few minutes (a platform limit),
// under a lock. While a run is open, the AI tab refreshes and starts the next slice.

export type Run = {
  id: string;
  profile_id: string;
  version: number;
  label: string;
  range_gte: string | null;
  range_lt: string | null;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  phase: 'dedup' | 'assess';
  pairs_checked: number;
  merged: number;
  total: number;
  done: number;
  error: string | null;
  lock_until: string | null;
  created_at: string;
  finished_at: string | null;
};
export type Range = { gte?: string; lt?: string; label: string };
type Copy = { src: string; id: string; url: string };
type Pending = {
  src: string;
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean | null;
  url: string;
  first_seen: string;
  dup_key: string;
  copies: Copy[];
};

const BATCH = 4; // offers per OpenAI call (each carries a full ad)
const PARALLEL = 3; // calls at once
const SLICE_MS = 150_000; // + one round of up to 120 s calls stays inside a 300 s function
const LOCK_MS = 3 * 60_000;

// ---- reads -----------------------------------------------------------------------------

export async function latestRun(profileId: string): Promise<Run | null> {
  const url = restUrl('ai_runs');
  url.searchParams.set('select', '*');
  url.searchParams.set('profile_id', `eq.${profileId}`);
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '1');
  return ((await (await rest(url)).json()) as Run[])[0] ?? null;
}

const rangeArgs = (p: Pick<Profile, 'id' | 'version'>, r: { gte?: string | null; lt?: string | null }) => ({
  p_profile: p.id,
  p_version: p.version,
  p_gte: r.gte ?? null,
  p_lt: r.lt ?? null,
});

/** How many jobs in the range this profile version hasn't judged yet. */
export async function countPending(p: Pick<Profile, 'id' | 'version'>, r: { gte?: string; lt?: string }) {
  const url = rpcUrl('ai_pending', rangeArgs(p, r));
  url.searchParams.set('select', 'dup_key');
  return rangeTotal(await rest(url, { method: 'HEAD', prefer: 'count=exact' }));
}

export async function rangeStats(p: Pick<Profile, 'id' | 'version'>, r: { gte?: string; lt?: string }) {
  const rows = (await (await rest(rpcUrl('ai_range_stats', rangeArgs(p, r)))).json()) as {
    total: number;
    checked: number;
    matched: number;
  }[];
  return rows[0] ?? { total: 0, checked: 0, matched: 0 };
}

export const needsWorker = (run: Run | null) =>
  Boolean(run && run.status === 'running' && (!run.lock_until || Date.parse(run.lock_until) < Date.now()));

// ---- start -----------------------------------------------------------------------------

/** One open run per profile; asking again while one runs returns that one. */
export async function startRun(p: Profile, range: Range): Promise<Run> {
  const open = await latestRun(p.id);
  if (open?.status === 'running' && open.version === p.version) return open;

  const total = await countPending(p, range);
  const now = new Date().toISOString();
  const res = await rest(restUrl('ai_runs'), {
    method: 'POST',
    prefer: 'return=representation',
    body: JSON.stringify({
      profile_id: p.id,
      version: p.version,
      label: range.label,
      range_gte: range.gte ?? null,
      range_lt: range.lt ?? null,
      total,
      status: total ? 'running' : 'done',
      finished_at: total ? null : now,
      phase: total ? 'dedup' : 'assess',
    }),
  });
  return ((await res.json()) as Run[])[0];
}

// ---- worker ----------------------------------------------------------------------------

async function patchRun(id: string, fields: Partial<Run>, extra?: (u: URL) => void) {
  const url = restUrl('ai_runs');
  url.searchParams.set('id', `eq.${id}`);
  extra?.(url);
  const res = await rest(url, { method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(fields) });
  return (await res.json()) as Run[];
}

const finish = (id: string, status: Run['status'], error: string | null = null) =>
  patchRun(id, { status, error, lock_until: null, finished_at: new Date().toISOString() });

async function takeLock(runId: string) {
  const rows = await patchRun(runId, { lock_until: new Date(Date.now() + LOCK_MS).toISOString() }, (u) => {
    u.searchParams.set('status', 'eq.running');
    u.searchParams.set('or', `(lock_until.is.null,lock_until.lt."${new Date().toISOString()}")`);
  });
  return rows.at(0) ?? null;
}

async function pendingRows(run: Run, limit: number): Promise<Pending[]> {
  const url = rpcUrl(
    'ai_pending',
    rangeArgs({ id: run.profile_id, version: run.version }, { gte: run.range_gte, lt: run.range_lt }),
  );
  url.searchParams.set('select', 'src,id,title,company,seniority,remote,url,first_seen,dup_key,copies');
  url.searchParams.set('order', 'first_seen.desc');
  url.searchParams.set('limit', String(limit));
  return (await rest(url)).json() as Promise<Pending[]>;
}

const pgQuote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Ad text for each job: cached in offer_details, else scraped from its copies (earliest first). */
async function descriptions(offers: Pending[]): Promise<Map<string, string | null>> {
  const copies = offers.flatMap((o) => o.copies);
  const cached = new Map<string, { status: string; description: string | null }>();
  if (copies.length) {
    const url = restUrl('offer_details');
    url.searchParams.set('select', 'src,id,status,description');
    url.searchParams.set(
      'or',
      `(${copies.map((c) => `and(src.eq.${pgQuote(c.src)},id.eq.${pgQuote(c.id)})`).join(',')})`,
    );
    for (const r of (await (await rest(url)).json()) as {
      src: string;
      id: string;
      status: string;
      description: string | null;
    }[]) {
      cached.set(`${r.src}\u0001${r.id}`, r);
    }
  }

  const out = new Map<string, string | null>();
  const toStore: { src: string; id: string; description: string | null; status: 'ok' | 'empty' }[] = [];
  for (const o of offers) {
    let text: string | null = null;
    for (const c of o.copies) {
      const hit = cached.get(`${c.src}\u0001${c.id}`);
      if (hit) {
        if (hit.status === 'ok' && hit.description) {
          text = hit.description;
          break;
        }
        continue; // known to have no ad text
      }
      try {
        const s = await scrapeOffer(c);
        toStore.push({ src: c.src, id: c.id, description: s.status === 'ok' ? s.text : null, status: s.status });
        if (s.status === 'ok') {
          text = s.text;
          break;
        }
      } catch {
        // network / HTTP error: not stored, so a later run tries again
      }
    }
    out.set(o.dup_key, text);
  }
  if (toStore.length) {
    const url = restUrl('offer_details');
    url.searchParams.set('on_conflict', 'src,id');
    await rest(url, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(toStore),
    }).catch(() => {});
  }
  return out;
}

async function assessBatch(profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>, batch: Pending[]) {
  const desc = await descriptions(batch);
  const file = profile.file_name && profile.file_text ? { name: profile.file_name, text: profile.file_text } : null;
  const input: OfferForAi[] = batch.map((o, i) => ({
    n: i + 1,
    title: o.title,
    company: o.company,
    seniority: o.seniority,
    remote: o.remote,
    description: desc.get(o.dup_key) ?? null,
  }));
  const results = await assessOffers(profile.prompt, file, input);
  const rows = results.map((r) => ({
    profile_id: profile.id,
    version: profile.version,
    dup_key: batch[r.n - 1].dup_key,
    match: r.match,
    score: r.score,
    summary: r.summary,
    checks: r.checks,
    had_description: Boolean(input[r.n - 1].description),
  }));
  if (rows.length) {
    const url = restUrl('ai_verdicts');
    url.searchParams.set('on_conflict', 'profile_id,version,dup_key');
    await rest(url, {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(rows),
    });
  }
  return { saved: rows.length, answered: new Set(rows.map((r) => r.dup_key)) };
}

// ---- new offers, before Telegram --------------------------------------------------------

export type Verdict = { match: boolean; score: number; summary: string | null };

/** Verdicts this profile version already has for these jobs. */
async function verdictsFor(p: Pick<Profile, 'id' | 'version'>, keys: string[]) {
  const out = new Map<string, Verdict>();
  for (let i = 0; i < keys.length; i += 40) {
    const url = restUrl('ai_verdicts');
    url.searchParams.set('select', 'dup_key,match,score,summary');
    url.searchParams.set('profile_id', `eq.${p.id}`);
    url.searchParams.set('version', `eq.${p.version}`);
    url.searchParams.set(
      'dup_key',
      `in.(${keys
        .slice(i, i + 40)
        .map(pgQuote)
        .join(',')})`,
    );
    for (const r of (await (await rest(url)).json()) as (Verdict & { dup_key: string })[]) {
      out.set(r.dup_key, { match: r.match, score: r.score, summary: r.summary });
    }
  }
  return out;
}

/**
 * The verdicts for these jobs, assessing the ones this profile hasn't judged yet. No run and no
 * browser tab needed; stops starting new batches at the deadline (a batch can take up to two
 * minutes), so whatever is left gets its turn next time.
 */
export async function assessJobs(profile: ProfileWithFile, keys: string[], deadline: number) {
  const verdicts = await verdictsFor(profile, keys);
  const missing = keys.filter((k) => !verdicts.has(k));
  let error: string | null = null;
  if (missing.length) {
    const url = restUrl('offers_unique'); // one row per job, with all its copies (the ad may be on any)
    url.searchParams.set('select', 'src,id,title,company,seniority,remote,url,first_seen,dup_key,copies');
    url.searchParams.set('dup_key', `in.(${missing.slice(0, 120).map(pgQuote).join(',')})`);
    const jobs = (await (await rest(url)).json()) as Pending[];
    for (let i = 0; i < jobs.length && Date.now() < deadline; i += BATCH * PARALLEL) {
      const round = jobs.slice(i, i + BATCH * PARALLEL);
      const batches = Array.from({ length: Math.ceil(round.length / BATCH) }, (_, b) =>
        round.slice(b * BATCH, b * BATCH + BATCH),
      );
      for (const s of await Promise.allSettled(batches.map((b) => assessBatch(profile, b)))) {
        if (s.status === 'rejected') error = s.reason instanceof Error ? s.reason.message : String(s.reason);
      }
    }
    for (const [k, v] of await verdictsFor(profile, missing)) verdicts.set(k, v);
  }
  return { verdicts, error };
}

/** Processes one slice of a run. Safe to call often: only one caller gets the lock. */
export async function continueRun(runId: string): Promise<void> {
  const run = await takeLock(runId);
  if (!run) return;

  const profile = await getProfile(run.profile_id);
  if (!profile || profile.version !== run.version) {
    await finish(run.id, 'cancelled', 'The profile changed since this run started. Run it again.');
    return;
  }

  const deadline = Date.now() + SLICE_MS;
  const range = { gte: run.range_gte, lt: run.range_lt };

  // ---- phase 1: duplicates ----
  if (run.phase === 'dedup') {
    const asked = new Set<string>();
    let pairs = run.pairs_checked,
      merged = run.merged,
      failed = 0;
    try {
      while (Date.now() < deadline) {
        const r = await dedupRound(range, asked);
        pairs += r.checked;
        merged += r.merged;
        if (r.error) {
          console.error('[ai-run] duplicate check failed:', r.error);
          if (++failed >= 3) {
            await finish(run.id, 'failed', `Duplicate check: ${r.error}`);
            return;
          }
        } else if (r.checked === 0) {
          // no candidates left: merges may have removed jobs from the to-do list, so recount
          const total =
            run.done +
            (await countPending(
              { id: run.profile_id, version: run.version },
              { gte: run.range_gte ?? undefined, lt: run.range_lt ?? undefined },
            ));
          await patchRun(run.id, { phase: 'assess', total, pairs_checked: pairs, merged });
          run.phase = 'assess';
          run.total = total;
          run.pairs_checked = pairs;
          run.merged = merged;
          break;
        }
        await patchRun(run.id, {
          pairs_checked: pairs,
          merged,
          lock_until: new Date(Date.now() + LOCK_MS).toISOString(),
        });
      }
    } catch (e) {
      console.error('[ai-run] duplicate slice crashed:', e);
      await patchRun(run.id, { lock_until: null, error: e instanceof Error ? e.message : String(e) }).catch(() => {});
      return;
    }
    if (run.phase === 'dedup') {
      await patchRun(run.id, { lock_until: null }); // out of time: the next page refresh continues
      return;
    }
  }

  // ---- phase 2: assessment ----
  const tries = new Map<string, number>(); // jobs the model keeps skipping
  const savedHere = new Set<string>(); // never send a job twice in one slice, whatever a read says
  let done = run.done;
  let failedRounds = 0;
  try {
    while (Date.now() < deadline) {
      const pending = (await pendingRows(run, BATCH * PARALLEL + 20)).filter(
        (o) => !savedHere.has(o.dup_key) && (tries.get(o.dup_key) ?? 0) < 2,
      );
      if (!pending.length) {
        const skipped = [...tries.values()].filter((n) => n >= 2).length;
        await finish(run.id, 'done', skipped ? `${skipped} offer(s) couldn't be assessed.` : null);
        return;
      }
      const batches: Pending[][] = [];
      for (let i = 0; i < Math.min(pending.length, BATCH * PARALLEL); i += BATCH)
        batches.push(pending.slice(i, i + BATCH));

      const settled = await Promise.allSettled(batches.map((b) => assessBatch(profile, b)));
      let saved = 0;
      let lastError: string | null = null;
      for (const [i, s] of settled.entries()) {
        if (s.status === 'fulfilled') {
          saved += s.value.saved;
          for (const k of s.value.answered) savedHere.add(k);
          for (const o of batches[i])
            if (!s.value.answered.has(o.dup_key)) tries.set(o.dup_key, (tries.get(o.dup_key) ?? 0) + 1);
        } else {
          lastError = s.reason instanceof Error ? s.reason.message : String(s.reason);
          console.error('[ai-run] batch failed:', lastError);
        }
      }
      done += saved;
      failedRounds = saved ? 0 : failedRounds + 1;
      if (failedRounds >= 3) {
        await finish(run.id, 'failed', lastError ?? 'The AI returned no answers.');
        return;
      }
      await patchRun(run.id, { done, error: lastError, lock_until: new Date(Date.now() + LOCK_MS).toISOString() });
    }
    // out of time for this slice: free the lock so the next page refresh continues
    await patchRun(run.id, { lock_until: null });
  } catch (e) {
    console.error('[ai-run] slice crashed:', e);
    await patchRun(run.id, { lock_until: null, error: e instanceof Error ? e.message : String(e) }).catch(() => {});
  }
}
