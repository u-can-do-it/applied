import 'server-only';
import {
  isOver,
  started,
  stillToAssess,
  transition,
  type BatchResult,
  type SliceEvent,
  type SliceState,
} from './ai-run-state';
import { AI_RUN_LOCK_MS, SLICE_MS } from './budgets';
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
// under a lock. While a run is open, the AI tab refreshes and starts the next slice. What a slice
// does next is decided by the state machine in lib/ai-run-state.ts.

export type Run = runsRepo.Run;
export type Range = { gte?: string; lt?: string; label: string };
type Pending = Omit<offersRepo.Job, 'appliedAt'>;

const BATCH = 4; // offers per OpenAI call (each carries a full ad)
const PARALLEL = 3; // calls at once

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

const takeLock = (runId: string) =>
  runsRepo.takeLock(runId, new Date(Date.now() + AI_RUN_LOCK_MS).toISOString(), new Date().toISOString());

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

/** What one slice works with, besides its state. */
type Slice = {
  run: Run;
  profile: ProfileWithFile;
  range: { gte: string | null; lt: string | null };
  deadline: number;
  /** duplicate pairs already sent in this slice, so a stale read can't loop */
  asked: Set<string>;
};

/** Writes what the state says to write on entering it. */
const save = async (runId: string, state: SliceState) => {
  if (state.save) await runsRepo.patch(runId, state.save);
};

/** Does the step the state names; answers with what happened. */
async function perform(state: SliceState, slice: Slice): Promise<SliceEvent> {
  const { run, range } = slice;
  switch (state.step) {
    case 'dedup': {
      if (Date.now() >= slice.deadline) return { type: 'outOfTime' };
      const round = await dedupRound(range, slice.asked);
      if (round.error) console.error('[ai-run] duplicate check failed:', round.error);
      return { type: 'dedupRound', ...round, at: Date.now() };
    }
    case 'recount':
      return { type: 'recounted', pending: await countPending({ id: run.profileId, version: run.version }, range) };
    case 'assess': {
      if (Date.now() >= slice.deadline) return { type: 'outOfTime' };
      const pending = stillToAssess(state, await pendingRows(run, BATCH * PARALLEL + 20));
      if (!pending.length) return { type: 'nothingLeft', at: Date.now() };
      const batches: Pending[][] = [];
      for (let i = 0; i < Math.min(pending.length, BATCH * PARALLEL); i += BATCH)
        batches.push(pending.slice(i, i + BATCH));

      const settled = await Promise.allSettled(batches.map((batch) => assessBatch(slice.profile, batch)));
      const results = settled.map((outcome, i): BatchResult => {
        const jobs = batches[i].map((job) => job.dupKey);
        if (outcome.status === 'fulfilled')
          return { jobs, answered: [...outcome.value.answered], saved: outcome.value.saved };
        const error = message(outcome.reason);
        console.error('[ai-run] batch failed:', error);
        return { jobs, error };
      });
      return { type: 'assessRound', batches: results, at: Date.now() };
    }
    case 'checkProfile':
    case 'paused':
    case 'finished':
      throw new Error(`AI run: no step to perform in "${state.step}".`);
  }
}

/**
 * Processes one slice of a run. Safe to call often: only one caller gets the lock. Takes the lock
 * (that loads the run), then: the next step from the state machine, do it, save, until the slice
 * is over.
 */
export async function continueRun(runId: string): Promise<void> {
  const run = await takeLock(runId);
  if (!run) return;

  const profile = await getProfile(run.profileId);
  let state = transition(started(run), {
    type: 'profileLoaded',
    current: profile?.version === run.version,
    at: Date.now(),
  });
  if (!profile || isOver(state)) {
    await save(run.id, state);
    return;
  }

  const slice: Slice = {
    run,
    profile,
    range: { gte: run.rangeGte, lt: run.rangeLt },
    deadline: Date.now() + SLICE_MS,
    asked: new Set(),
  };
  try {
    while (!isOver(state)) {
      const next = transition(state, await perform(state, slice));
      await save(run.id, next);
      state = next;
    }
  } catch (e) {
    // `state` is the last one saved: the crash frees the lock from there, and the next page refresh continues
    console.error(state.step === 'assess' ? '[ai-run] slice crashed:' : '[ai-run] duplicate slice crashed:', e);
    await save(run.id, transition(state, { type: 'crashed', error: message(e) })).catch(() => {});
  }
}
