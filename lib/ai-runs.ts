import 'server-only';
import * as detailsRepo from './db/repos/offer-details';
import * as offersRepo from './db/repos/offers';
import * as runsRepo from './db/repos/ai-runs';
import * as verdictsRepo from './db/repos/ai-verdicts';
import { dedupRound } from './dedup';
import { assessOffers, type OfferForAi } from './openai';
import { getProfile, type Profile, type ProfileWithFile } from './profiles';
import { scrapeOffer } from './ads';
import { message } from './shared/errors';

// Manual AI runs: "check every offer in this date range that this profile hasn't judged yet".
// Phase 1 asks the AI about likely duplicates in the range (low effort) and merges them;
// phase 2 assesses each remaining job against the profile (high effort). Verdicts are stored per
// profile version and per job, so a second "today" run only sends what's new.
//
// The work happens in after() on the server, in slices of a few minutes (a platform limit),
// under a lock. While a run is open, the AI tab refreshes and starts the next slice.

export type Run = runsRepo.Run;
export type Range = { gte?: string; lt?: string; label: string };
type Pending = Omit<offersRepo.Job, 'appliedAt'>;

const BATCH = 4; // offers per OpenAI call (each carries a full ad)
const PARALLEL = 3; // calls at once
const SLICE_MS = 150_000; // + one round of up to 120 s calls stays inside a 300 s function
const LOCK_MS = 3 * 60_000;

// ---- reads -----------------------------------------------------------------------------

export const latestRun = (profileId: string) => runsRepo.latest(profileId);

type ProfileVersion = Pick<Profile, 'id' | 'version'>;

/** How many jobs in the range this profile version hasn't judged yet. */
export const countPending = (p: ProfileVersion, r: { gte?: string | null; lt?: string | null }) =>
  verdictsRepo.countUnjudged(p, r);

export const rangeStats = (p: ProfileVersion, r: { gte?: string; lt?: string }) => verdictsRepo.rangeStats(p, r);

export const needsWorker = (run: Run | null) =>
  Boolean(run && run.status === 'running' && (!run.lockUntil || Date.parse(run.lockUntil) < Date.now()));

// ---- start -----------------------------------------------------------------------------

/** One open run per profile; asking again while one runs returns that one. */
export async function startRun(p: Profile, range: Range): Promise<Run> {
  const open = await latestRun(p.id);
  if (open?.status === 'running' && open.version === p.version) return open;

  const total = await countPending(p, range);
  return runsRepo.insert({
    profileId: p.id,
    version: p.version,
    label: range.label,
    rangeGte: range.gte ?? null,
    rangeLt: range.lt ?? null,
    total,
    status: total ? 'running' : 'done',
    finishedAt: total ? null : new Date().toISOString(),
    phase: total ? 'dedup' : 'assess',
  });
}

// ---- worker ----------------------------------------------------------------------------

const patchRun = (id: string, fields: runsRepo.RunPatch) => runsRepo.patch(id, fields);

const finish = (id: string, status: Run['status'], error: string | null = null) =>
  patchRun(id, { status, error, lockUntil: null, finishedAt: new Date().toISOString() });

const takeLock = (runId: string) =>
  runsRepo.takeLock(runId, new Date(Date.now() + LOCK_MS).toISOString(), new Date().toISOString());

const pendingRows = (run: Run, limit: number): Promise<Pending[]> =>
  verdictsRepo.unjudgedJobs({ id: run.profileId, version: run.version }, { gte: run.rangeGte, lt: run.rangeLt }, limit);

/** Ad text for each job: cached in offer_details, else scraped from its copies (earliest first). */
async function descriptions(offers: Pending[]): Promise<Map<string, string | null>> {
  const copies = offers.flatMap((o) => o.copies);
  const cached = new Map<string, detailsRepo.Details>();
  for (const r of await detailsRepo.forCopies(copies)) cached.set(`${r.src}\u0001${r.id}`, r);

  const out = new Map<string, string | null>();
  const toStore: detailsRepo.Details[] = [];
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
    out.set(o.dupKey, text);
  }
  await detailsRepo.save(toStore).catch(() => {});
  return out;
}

async function assessBatch(profile: ProfileWithFile, batch: Pending[]) {
  const desc = await descriptions(batch);
  const file = profile.fileName && profile.fileText ? { name: profile.fileName, text: profile.fileText } : null;
  const input: OfferForAi[] = batch.map((o, i) => ({
    n: i + 1,
    title: o.title,
    company: o.company,
    seniority: o.seniority,
    remote: o.remote,
    description: desc.get(o.dupKey) ?? null,
  }));
  const results = await assessOffers(profile.prompt, file, input);
  const rows = results.map((r) => ({
    profileId: profile.id,
    version: profile.version,
    dupKey: batch[r.n - 1].dupKey,
    match: r.match,
    score: r.score,
    summary: r.summary,
    checks: r.checks,
    hadDescription: Boolean(input[r.n - 1].description),
  }));
  await verdictsRepo.save(rows);
  return { saved: rows.length, answered: new Set(rows.map((r) => r.dupKey)) };
}

// ---- new offers, before Telegram --------------------------------------------------------

export type Verdict = verdictsRepo.Verdict;

/** Verdicts this profile version already has for these jobs. */
const verdictsFor = (p: ProfileVersion, keys: string[]) => verdictsRepo.forJobs(p, keys);

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
    // one row per job, with all its copies (the ad may be on any)
    const jobs = await offersRepo.jobsByKey(missing.slice(0, 120));
    for (let i = 0; i < jobs.length && Date.now() < deadline; i += BATCH * PARALLEL) {
      const round = jobs.slice(i, i + BATCH * PARALLEL);
      const batches = Array.from({ length: Math.ceil(round.length / BATCH) }, (_, b) =>
        round.slice(b * BATCH, b * BATCH + BATCH),
      );
      for (const s of await Promise.allSettled(batches.map((b) => assessBatch(profile, b)))) {
        if (s.status === 'rejected') error = message(s.reason);
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

  const profile = await getProfile(run.profileId);
  if (!profile || profile.version !== run.version) {
    await finish(run.id, 'cancelled', 'The profile changed since this run started. Run it again.');
    return;
  }

  const deadline = Date.now() + SLICE_MS;
  const range = { gte: run.rangeGte, lt: run.rangeLt };

  // ---- phase 1: duplicates ----
  if (run.phase === 'dedup') {
    const asked = new Set<string>();
    let pairs = run.pairsChecked,
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
          const total = run.done + (await countPending({ id: run.profileId, version: run.version }, range));
          await patchRun(run.id, { phase: 'assess', total, pairsChecked: pairs, merged });
          run.phase = 'assess';
          run.total = total;
          run.pairsChecked = pairs;
          run.merged = merged;
          break;
        }
        await patchRun(run.id, {
          pairsChecked: pairs,
          merged,
          lockUntil: new Date(Date.now() + LOCK_MS).toISOString(),
        });
      }
    } catch (e) {
      console.error('[ai-run] duplicate slice crashed:', e);
      await patchRun(run.id, { lockUntil: null, error: message(e) }).catch(() => {});
      return;
    }
    if (run.phase === 'dedup') {
      await patchRun(run.id, { lockUntil: null }); // out of time: the next page refresh continues
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
        (o) => !savedHere.has(o.dupKey) && (tries.get(o.dupKey) ?? 0) < 2,
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
            if (!s.value.answered.has(o.dupKey)) tries.set(o.dupKey, (tries.get(o.dupKey) ?? 0) + 1);
        } else {
          lastError = message(s.reason);
          console.error('[ai-run] batch failed:', lastError);
        }
      }
      done += saved;
      failedRounds = saved ? 0 : failedRounds + 1;
      if (failedRounds >= 3) {
        await finish(run.id, 'failed', lastError ?? 'The AI returned no answers.');
        return;
      }
      await patchRun(run.id, { done, error: lastError, lockUntil: new Date(Date.now() + LOCK_MS).toISOString() });
    }
    // out of time for this slice: free the lock so the next page refresh continues
    await patchRun(run.id, { lockUntil: null });
  } catch (e) {
    console.error('[ai-run] slice crashed:', e);
    await patchRun(run.id, { lockUntil: null, error: message(e) }).catch(() => {});
  }
}
