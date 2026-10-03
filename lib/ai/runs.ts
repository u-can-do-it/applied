import 'server-only';
import {
  isOver,
  started,
  stillToAssess,
  transition,
  type BatchResult,
  type SliceEvent,
  type SliceState,
} from './run-state';
import { isPaused } from './run-view';
import { AI_RUN_LOCK_MS, SLICE_MS } from '../budgets';
import * as detailsRepo from '../db/repos/offer-details';
import * as offersRepo from '../db/repos/offers';
import * as runsRepo from '../db/repos/ai-runs';
import * as verdictsRepo from '../db/repos/ai-verdicts';
import { mergeDuplicatesRound } from './merge-duplicates';
import { assessOffers, type OfferForAi } from './openai';
import { getProfile, type Profile, type ProfileWithFile } from './profiles';
import { scrapeOffer } from '../ads';
import { message } from '../shared/errors';

// Manual AI runs: "check every offer in this date range that this profile hasn't judged yet".
// Phase 1 asks the AI about likely duplicates in the range (low effort) and merges them;
// phase 2 assesses each remaining job against the profile (high effort). Verdicts are stored per
// profile version and per job, so a second "today" run only sends what's new.
//
// The work happens in after() on the server, in slices of a few minutes (a platform limit),
// under a lock. While a run is open, the AI tab refreshes and starts the next slice. What a slice
// does next is decided by the state machine in lib/ai/run-state.ts.

export type AiRun = runsRepo.Run;
export type Range = { gte?: string; lt?: string; label: string };
type Pending = Omit<offersRepo.Job, 'appliedAt'>;

const BATCH = 4; // offers per OpenAI call (each carries a full ad)
const PARALLEL = 3; // calls at once

// ---- reads -----------------------------------------------------------------------------

export const latestRun = (profileId: string) => runsRepo.latest(profileId);

type ProfileVersion = Pick<Profile, 'id' | 'version'>;

/** How many jobs in the range this profile version hasn't judged yet. */
export const countPending = (profile: ProfileVersion, range: { gte?: string | null; lt?: string | null }) =>
  verdictsRepo.countUnjudged(profile, range);

export const rangeStats = (profile: ProfileVersion, range: { gte?: string; lt?: string }) =>
  verdictsRepo.rangeStats(profile, range);

/** Open and paused (no slice working on it): the next slice is due. */
export const needsWorker = (run: AiRun | null) => Boolean(run && isPaused(run, Date.now()));

// ---- start -----------------------------------------------------------------------------

/** One open run per profile; asking again while one runs returns that one. */
export async function startRun(profile: Profile, range: Range): Promise<AiRun> {
  const open = await latestRun(profile.id);
  if (open?.status === 'running' && open.version === profile.version) return open;

  const total = await countPending(profile, range);
  return runsRepo.insert({
    profileId: profile.id,
    version: profile.version,
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

const pendingRows = (run: AiRun, limit: number): Promise<Pending[]> =>
  verdictsRepo.unjudgedJobs({ id: run.profileId, version: run.version }, { gte: run.rangeGte, lt: run.rangeLt }, limit);

/** Ad text for each job, by job id: cached in offer_details, else scraped from its offers (earliest first). */
async function descriptions(jobs: Pending[]): Promise<Map<string, string | null>> {
  const offers = jobs.flatMap((job) => job.offers);
  const cached = new Map<string, detailsRepo.Details>();
  for (const details of await detailsRepo.forOffers(offers)) cached.set(`${details.src}\u0001${details.id}`, details);

  const out = new Map<string, string | null>();
  const toStore: detailsRepo.Details[] = [];
  for (const job of jobs) {
    let text: string | null = null;
    for (const offer of job.offers) {
      const hit = cached.get(`${offer.src}\u0001${offer.id}`);
      if (hit) {
        if (hit.status === 'ok' && hit.description) {
          text = hit.description;
          break;
        }
        continue; // known to have no ad text
      }
      try {
        const scraped = await scrapeOffer(offer);
        toStore.push({
          src: offer.src,
          id: offer.id,
          description: scraped.status === 'ok' ? scraped.text : null,
          status: scraped.status,
        });
        if (scraped.status === 'ok') {
          text = scraped.text;
          break;
        }
      } catch {
        // network / HTTP error: not stored, so a later run tries again
      }
    }
    out.set(job.jobId, text);
  }
  await detailsRepo.save(toStore).catch(() => {});
  return out;
}

async function assessBatch(profile: ProfileWithFile, batch: Pending[]) {
  const texts = await descriptions(batch);
  const file = profile.fileName && profile.fileText ? { name: profile.fileName, text: profile.fileText } : null;
  const input: OfferForAi[] = batch.map((job, i) => ({
    n: i + 1,
    title: job.title,
    company: job.company,
    seniority: job.seniority,
    remote: job.remote,
    description: texts.get(job.jobId) ?? null,
  }));
  const assessments = await assessOffers(profile.prompt, file, input);
  const rows = assessments.map((assessment) => ({
    profileId: profile.id,
    version: profile.version,
    jobId: batch[assessment.n - 1].jobId,
    match: assessment.match,
    score: assessment.score,
    summary: assessment.summary,
    checks: assessment.checks,
    hadDescription: Boolean(input[assessment.n - 1].description),
  }));
  await verdictsRepo.save(rows);
  return { saved: rows.length, answered: new Set(rows.map((row) => row.jobId)) };
}

// ---- new offers, before Telegram --------------------------------------------------------

export type Verdict = verdictsRepo.Verdict;

/** Verdicts this profile version already has for these jobs. */
const verdictsFor = (profile: ProfileVersion, jobIds: string[]) => verdictsRepo.forJobs(profile, jobIds);

/**
 * The verdicts for these jobs, assessing the ones this profile hasn't judged yet. No run and no
 * browser tab needed; stops starting new batches at the deadline (a batch can take up to two
 * minutes), so whatever is left gets its turn next time.
 */
export async function assessJobs(profile: ProfileWithFile, jobIds: string[], deadline: number) {
  const verdicts = await verdictsFor(profile, jobIds);
  const missing = jobIds.filter((jobId) => !verdicts.has(jobId));
  let error: string | null = null;
  if (missing.length) {
    // one row per job, with all its offers (the ad may be on any)
    const jobs = await offersRepo.jobsById(missing.slice(0, 120));
    for (let i = 0; i < jobs.length && Date.now() < deadline; i += BATCH * PARALLEL) {
      const round = jobs.slice(i, i + BATCH * PARALLEL);
      const batches = Array.from({ length: Math.ceil(round.length / BATCH) }, (_, index) =>
        round.slice(index * BATCH, index * BATCH + BATCH),
      );
      for (const result of await Promise.allSettled(batches.map((batch) => assessBatch(profile, batch)))) {
        if (result.status === 'rejected') error = message(result.reason);
      }
    }
    for (const [jobId, verdict] of await verdictsFor(profile, missing)) verdicts.set(jobId, verdict);
  }
  return { verdicts, error };
}

/** What one slice works with, besides its state. */
type Slice = {
  run: AiRun;
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
      const round = await mergeDuplicatesRound(range, slice.asked);
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
        const jobs = batches[i].map((job) => job.jobId);
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
  } catch (error) {
    // `state` is the last one saved: the crash frees the lock from there, and the next page refresh continues
    console.error(state.step === 'assess' ? '[ai-run] slice crashed:' : '[ai-run] duplicate slice crashed:', error);
    await save(run.id, transition(state, { type: 'crashed', error: message(error) })).catch(() => {});
  }
}
