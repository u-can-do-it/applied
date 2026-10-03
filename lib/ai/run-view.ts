import type { Run } from '../db/repos/ai-runs';

// An AI run as its card shows it (the AI tab, Activity): the run state machine's steps
// (lib/ai/run-state.ts) as the user sees them. Between slices a run is stored as `running` with its
// phase; it is working while a slice holds its lock, and paused when none does (the slice ran out
// of time or crashed, and nothing has continued it yet: Supabase Cron's next call or the AI tab will).
//
//   Duplicates (dedup) ──→ Assessment (assess) ──→ finished: done | failed | cancelled
//         └──────── paused (no worker) ────────┘

export type RunFields = Pick<
  Run,
  'status' | 'phase' | 'lockUntil' | 'pairsChecked' | 'merged' | 'done' | 'total' | 'error'
>;

/** Open, and no slice is working on it: the lock is free or ran out (its worker died). */
export const isPaused = (run: Pick<Run, 'status' | 'lockUntil'>, now: number) =>
  run.status === 'running' && (!run.lockUntil || Date.parse(run.lockUntil) < now);

export type StepStatus = 'waiting' | 'active' | 'paused' | 'done' | 'stopped';
export type RunStepView = { name: 'Duplicates' | 'Assessment'; status: StepStatus; counts: string };

/** The card's state: the machine's step while it works, `paused` between slices, `finished` after. */
export type RunCardState =
  | { step: 'dedup' | 'assess' }
  | { step: 'paused'; phase: Run['phase'] }
  | { step: 'finished'; status: Exclude<Run['status'], 'running'> };

export type RunBadge = 'Working' | 'Continuing' | 'Paused' | 'Done' | 'Failed' | 'Cancelled';

export type RunCardView = {
  state: RunCardState;
  badge: RunBadge;
  steps: [RunStepView, RunStepView];
  /** 0–100 while assessing (or paused in it), else null */
  percent: number | null;
  /** what went wrong, or the note a finished run left ("2 offer(s) couldn't be assessed.") */
  note: string | null;
};

const BADGE: Record<'dedup' | 'assess' | 'paused', RunBadge> = {
  dedup: 'Working',
  assess: 'Working',
  paused: 'Paused',
};
const FINISHED: Record<Exclude<Run['status'], 'running'>, RunBadge> = {
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * `paused`: isPaused(run, now), worked out where "now" is known (the server, as it renders).
 * `continuesHere`: the page showing it starts the next slice of a paused run (the AI tab, on every
 * load and refresh, and right after Start): there it's "continuing", not paused.
 */
export function runCard(run: RunFields, paused: boolean, continuesHere = false): RunCardView {
  const continuing = paused && continuesHere && run.status === 'running';
  const state: RunCardState =
    run.status !== 'running'
      ? { step: 'finished', status: run.status }
      : paused && !continuing
        ? { step: 'paused', phase: run.phase }
        : { step: run.phase };
  const phase = state.step === 'finished' ? run.phase : state.step === 'paused' ? state.phase : state.step;
  // the step the run is in (or ended in), and how it stands there
  const current: StepStatus =
    state.step === 'paused'
      ? 'paused'
      : state.step === 'finished'
        ? state.status === 'done'
          ? 'done'
          : 'stopped'
        : 'active';
  const dedup: StepStatus = phase === 'dedup' ? current : 'done';
  const assess: StepStatus = phase === 'dedup' ? (current === 'stopped' ? 'stopped' : 'waiting') : current;
  const shown = Math.min(run.done, run.total);
  return {
    state,
    badge: continuing ? 'Continuing' : state.step === 'finished' ? FINISHED[state.status] : BADGE[state.step],
    steps: [
      {
        name: 'Duplicates',
        status: dedup,
        counts: `${plural(run.pairsChecked, 'pair')} checked · ${run.merged} merged`,
      },
      {
        name: 'Assessment',
        status: assess,
        counts:
          phase === 'dedup' ? (assess === 'waiting' ? 'next' : 'not reached') : `${shown} of ${run.total} checked`,
      },
    ],
    percent:
      phase === 'assess' && state.step !== 'finished' ? (run.total ? Math.round((shown / run.total) * 100) : 0) : null,
    note: run.error,
  };
}
