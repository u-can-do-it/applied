import { AI_RUN_LOCK_MS } from '../budgets';
import type { Run, RunPatch } from '../db/repos/ai-runs';

// One slice of an AI run (lib/ai/runs.ts continueRun) as a state machine. The worker holds the
// run's lock, does the step its state names, turns what happened into an event, asks `transition`
// for the next state and writes that state's `save` to the run. A slice ends paused (out of time,
// or crashed: the lock is freed and the next page refresh continues) or finished.
//
//   checkProfile ─profileLoaded (changed)──→ finished: cancelled
//        │ (current, by the run's phase)
//        ├──→ dedup ─dedupRound──→ dedup               (3rd failed round → finished: failed)
//        │      └─dedupRound (no pairs left)─→ recount ─recounted─→ assess
//        └──────────────────────────────────────────────────────────→ assess ─assessRound──→ assess
//                                                                 (3rd round without an answer → finished: failed)
//                                                                   └─nothingLeft─→ finished: done
//   dedup / assess ─outOfTime─→ paused        dedup / recount / assess ─crashed─→ paused (with the error)

export type Progress = Pick<Run, 'pairsChecked' | 'merged' | 'done' | 'total'>;

/** Each state's `save`: what to write to the run on entering it (null: nothing). */
export type SliceState =
  | { step: 'checkProfile'; phase: Run['phase']; progress: Progress; save: null }
  | { step: 'dedup'; progress: Progress; failures: number; save: RunPatch | null }
  | { step: 'recount'; progress: Progress; save: null }
  | {
      step: 'assess';
      progress: Progress;
      /** rounds in a row that saved nothing */
      failedRounds: number;
      /** how often the model skipped each job in this slice */
      tries: ReadonlyMap<string, number>;
      /** jobs saved in this slice: never sent twice in one slice, whatever a read says */
      savedHere: ReadonlySet<string>;
      save: RunPatch | null;
    }
  | { step: 'paused'; save: RunPatch }
  | { step: 'finished'; status: Exclude<Run['status'], 'running'>; error: string | null; save: RunPatch };

/** One OpenAI call's worth of jobs, and what came of it. */
export type BatchResult = { jobs: string[]; answered: string[]; saved: number } | { jobs: string[]; error: string };

export type SliceEvent =
  /** `current`: the profile is still there, at the run's version */
  | { type: 'profileLoaded'; current: boolean; at: number }
  | { type: 'outOfTime' }
  | { type: 'dedupRound'; checked: number; merged: number; error: string | null; at: number }
  /** the jobs left to judge, counted again after the merges */
  | { type: 'recounted'; pending: number }
  | { type: 'assessRound'; batches: BatchResult[]; at: number }
  | { type: 'nothingLeft'; at: number }
  | { type: 'crashed'; error: string };

/** A job the model skipped this often in one slice is left out (it's counted in the final message). */
export const MAX_TRIES = 2;
/** Rounds that fail before the run does: one bad answer shouldn't end it, a dead API should. */
export const MAX_FAILED_ROUNDS = 3;
export const PROFILE_CHANGED = 'The profile changed since this run started. Run it again.';

/** A slice's first state, from the run as its lock was taken. */
export const started = (run: Pick<Run, 'phase' | 'pairsChecked' | 'merged' | 'done' | 'total'>): SliceState => ({
  step: 'checkProfile',
  phase: run.phase,
  progress: { pairsChecked: run.pairsChecked, merged: run.merged, done: run.done, total: run.total },
  save: null,
});

export const isOver = (state: SliceState) => state.step === 'paused' || state.step === 'finished';

const iso = (ms: number) => new Date(ms).toISOString();
const lockFrom = (at: number) => iso(at + AI_RUN_LOCK_MS);

const finished = (
  status: Exclude<Run['status'], 'running'>,
  error: string | null,
  at: number,
): Extract<SliceState, { step: 'finished' }> => ({
  step: 'finished',
  status,
  error,
  save: { status, error, lockUntil: null, finishedAt: iso(at) },
});

const assessing = (progress: Progress, save: RunPatch | null = null): SliceState => ({
  step: 'assess',
  progress,
  failedRounds: 0,
  tries: new Map(),
  savedHere: new Set(),
  save,
});

export function transition(state: SliceState, event: SliceEvent): SliceState {
  switch (event.type) {
    case 'profileLoaded':
      if (state.step !== 'checkProfile') throw invalid(state, event);
      if (!event.current) return finished('cancelled', PROFILE_CHANGED, event.at);
      return state.phase === 'dedup'
        ? { step: 'dedup', progress: state.progress, failures: 0, save: null }
        : assessing(state.progress);

    case 'outOfTime':
      if (state.step !== 'dedup' && state.step !== 'assess') throw invalid(state, event);
      return { step: 'paused', save: { lockUntil: null } };

    case 'dedupRound': {
      if (state.step !== 'dedup') throw invalid(state, event);
      const progress = {
        ...state.progress,
        pairsChecked: state.progress.pairsChecked + event.checked,
        merged: state.progress.merged + event.merged,
      };
      const save = { pairsChecked: progress.pairsChecked, merged: progress.merged, lockUntil: lockFrom(event.at) };
      if (event.error) {
        // failures in the slice, not in a row
        const failures = state.failures + 1;
        if (failures >= MAX_FAILED_ROUNDS) return finished('failed', `Duplicate check: ${event.error}`, event.at);
        return { step: 'dedup', progress, failures, save };
      }
      // no candidates left: merges may have removed jobs from the to-do list, so recount
      if (event.checked === 0) return { step: 'recount', progress, save: null };
      return { step: 'dedup', progress, failures: state.failures, save };
    }

    case 'recounted': {
      if (state.step !== 'recount') throw invalid(state, event);
      const progress = { ...state.progress, total: state.progress.done + event.pending };
      return assessing(progress, {
        phase: 'assess',
        total: progress.total,
        pairsChecked: progress.pairsChecked,
        merged: progress.merged,
      });
    }

    case 'assessRound': {
      if (state.step !== 'assess') throw invalid(state, event);
      const tries = new Map(state.tries);
      const savedHere = new Set(state.savedHere);
      let saved = 0;
      let lastError: string | null = null;
      for (const batch of event.batches) {
        if ('error' in batch) {
          lastError = batch.error;
          continue;
        }
        saved += batch.saved;
        const answered = new Set(batch.answered);
        for (const job of answered) savedHere.add(job);
        for (const job of batch.jobs) if (!answered.has(job)) tries.set(job, (tries.get(job) ?? 0) + 1);
      }
      const done = state.progress.done + saved;
      const failedRounds = saved ? 0 : state.failedRounds + 1;
      if (failedRounds >= MAX_FAILED_ROUNDS)
        return finished('failed', lastError ?? 'The AI returned no answers.', event.at);
      return {
        step: 'assess',
        progress: { ...state.progress, done },
        failedRounds,
        tries,
        savedHere,
        save: { done, error: lastError, lockUntil: lockFrom(event.at) },
      };
    }

    case 'nothingLeft': {
      if (state.step !== 'assess') throw invalid(state, event);
      const skipped = [...state.tries.values()].filter((count) => count >= MAX_TRIES).length;
      return finished('done', skipped ? `${skipped} offer(s) couldn't be assessed.` : null, event.at);
    }

    case 'crashed':
      if (state.step !== 'dedup' && state.step !== 'recount' && state.step !== 'assess') throw invalid(state, event);
      return { step: 'paused', save: { lockUntil: null, error: event.error } };

    default:
      return unreachable(event);
  }
}

/** The pending jobs this slice still sends: not saved in it already, not skipped by the model too often. */
export function stillToAssess<T extends { jobId: string }>(state: SliceState, rows: readonly T[]): T[] {
  if (state.step !== 'assess') return [];
  return rows.filter((row) => !state.savedHere.has(row.jobId) && (state.tries.get(row.jobId) ?? 0) < MAX_TRIES);
}

const invalid = (state: SliceState, event: SliceEvent) =>
  new Error(`AI run: "${event.type}" can't happen in step "${state.step}".`);

const unreachable = (event: never): never => {
  throw new Error(`AI run: unknown event ${JSON.stringify(event)}`);
};
