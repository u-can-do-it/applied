import { describe, expect, it } from 'vitest';
import {
  isOver,
  PROFILE_CHANGED,
  started,
  stillToAssess,
  transition,
  type Progress,
  type SliceEvent,
  type SliceState,
} from '@/lib/ai/run-state';
import { AI_RUN_LOCK_MS } from '@/lib/budgets';

const AT = Date.parse('2026-10-03T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const LOCK = iso(AT + AI_RUN_LOCK_MS);

const progress: Progress = { pairsChecked: 10, merged: 2, done: 5, total: 20 };
const run = (phase: 'dedup' | 'assess') => ({ phase, ...progress });

const dedup = (failures = 0): SliceState => ({ step: 'dedup', progress, failures, save: null });
const assess = (extra: Partial<Extract<SliceState, { step: 'assess' }>> = {}): SliceState => ({
  step: 'assess',
  progress,
  failedRounds: 0,
  tries: new Map(),
  savedHere: new Set(),
  save: null,
  ...extra,
});
const finishedSave = (status: string, error: string | null) => ({
  status,
  error,
  lockUntil: null,
  finishedAt: iso(AT),
});

describe('AI run slice: start', () => {
  it('a profile changed since the run started cancels it', () => {
    const next = transition(started(run('dedup')), { type: 'profileLoaded', current: false, at: AT });
    expect(next).toEqual({
      step: 'finished',
      status: 'cancelled',
      error: PROFILE_CHANGED,
      save: finishedSave('cancelled', PROFILE_CHANGED),
    });
    expect(isOver(next)).toBe(true);
  });

  it('else it goes on with the phase the run is in, writing nothing yet', () => {
    expect(transition(started(run('dedup')), { type: 'profileLoaded', current: true, at: AT })).toEqual(dedup());
    expect(transition(started(run('assess')), { type: 'profileLoaded', current: true, at: AT })).toEqual(assess());
    expect(isOver(dedup())).toBe(false);
  });
});

describe('AI run slice: duplicates', () => {
  const round = (checked: number, merged: number, error: string | null = null): SliceEvent => ({
    type: 'dedupRound',
    checked,
    merged,
    error,
    at: AT,
  });

  it('a round adds up the pairs and merges and renews the lock', () => {
    expect(transition(dedup(), round(30, 3))).toEqual({
      step: 'dedup',
      progress: { ...progress, pairsChecked: 40, merged: 5 },
      failures: 0,
      save: { pairsChecked: 40, merged: 5, lockUntil: LOCK },
    });
  });

  it('a failed round counts; the third in a slice fails the run', () => {
    const first = transition(dedup(), round(0, 0, 'OpenAI 500'));
    expect(first).toMatchObject({ step: 'dedup', failures: 1, save: { pairsChecked: 10, merged: 2, lockUntil: LOCK } });
    // a good round in between doesn't reset the count
    const second = transition(transition(first, round(5, 0)), round(0, 0, 'OpenAI 500'));
    expect(second).toMatchObject({ step: 'dedup', failures: 2 });
    expect(transition(second, round(0, 0, 'OpenAI 502'))).toEqual({
      step: 'finished',
      status: 'failed',
      error: 'Duplicate check: OpenAI 502',
      save: finishedSave('failed', 'Duplicate check: OpenAI 502'),
    });
  });

  it('no pairs left: recount the jobs, then assess with the new total', () => {
    const recount = transition(dedup(), round(0, 0));
    expect(recount).toEqual({ step: 'recount', progress, save: null });
    expect(transition(recount, { type: 'recounted', pending: 7 })).toEqual(
      assess({
        progress: { ...progress, total: 12 },
        save: { phase: 'assess', total: 12, pairsChecked: 10, merged: 2 },
      }),
    );
  });
});

describe('AI run slice: assessment', () => {
  it('a round saves what was answered, counts the jobs the model skipped, renews the lock', () => {
    const next = transition(assess({ tries: new Map([['c', 1]]) }), {
      type: 'assessRound',
      at: AT,
      batches: [
        { jobs: ['a', 'b', 'c'], answered: ['a'], saved: 1 },
        { jobs: ['d'], error: 'OpenAI 429' },
        { jobs: ['e'], answered: ['e'], saved: 1 },
      ],
    });
    expect(next).toEqual(
      assess({
        progress: { ...progress, done: 7 },
        tries: new Map([
          ['c', 2],
          ['b', 1],
        ]),
        savedHere: new Set(['a', 'e']),
        save: { done: 7, error: 'OpenAI 429', lockUntil: LOCK },
      }),
    );
  });

  it('three rounds in a row without an answer fail the run, with the last error', () => {
    const empty: SliceEvent = { type: 'assessRound', at: AT, batches: [{ jobs: ['a'], error: 'OpenAI 500' }] };
    const two = transition(transition(assess(), empty), empty);
    expect(two).toMatchObject({ step: 'assess', failedRounds: 2, save: { done: 5, error: 'OpenAI 500' } });
    expect(transition(two, empty)).toEqual({
      step: 'finished',
      status: 'failed',
      error: 'OpenAI 500',
      save: finishedSave('failed', 'OpenAI 500'),
    });
    // answers without a single saved verdict, and no error
    const silent: SliceEvent = { type: 'assessRound', at: AT, batches: [{ jobs: ['a'], answered: [], saved: 0 }] };
    expect(transition(assess({ failedRounds: 2 }), silent)).toMatchObject({
      status: 'failed',
      error: 'The AI returned no answers.',
    });
    // one saved verdict resets the count
    const saved: SliceEvent = { type: 'assessRound', at: AT, batches: [{ jobs: ['a'], answered: ['a'], saved: 1 }] };
    expect(transition(assess({ failedRounds: 2 }), saved)).toMatchObject({ step: 'assess', failedRounds: 0 });
  });

  it('nothing left: done, saying how many the model kept skipping', () => {
    expect(transition(assess(), { type: 'nothingLeft', at: AT })).toEqual({
      step: 'finished',
      status: 'done',
      error: null,
      save: finishedSave('done', null),
    });
    const skipped = assess({
      tries: new Map([
        ['a', 2],
        ['b', 1],
        ['c', 2],
      ]),
    });
    expect(transition(skipped, { type: 'nothingLeft', at: AT })).toMatchObject({
      status: 'done',
      error: "2 offer(s) couldn't be assessed.",
    });
  });

  it('sends neither a job saved in this slice nor one skipped twice', () => {
    const state = assess({
      savedHere: new Set(['a']),
      tries: new Map([
        ['b', 2],
        ['c', 1],
      ]),
    });
    const rows = ['a', 'b', 'c', 'd'].map((jobId) => ({ jobId }));
    expect(stillToAssess(state, rows).map((row) => row.jobId)).toEqual(['c', 'd']);
    expect(stillToAssess(dedup(), rows)).toEqual([]);
  });
});

describe('AI run slice: the end of a slice', () => {
  it('out of time: paused, the lock freed for the next refresh', () => {
    for (const state of [dedup(), assess()])
      expect(transition(state, { type: 'outOfTime' })).toEqual({ step: 'paused', save: { lockUntil: null } });
  });

  it('a crash: paused with the error', () => {
    const recount: SliceState = { step: 'recount', progress, save: null };
    for (const state of [dedup(), recount, assess()])
      expect(transition(state, { type: 'crashed', error: 'connection reset' })).toEqual({
        step: 'paused',
        save: { lockUntil: null, error: 'connection reset' },
      });
  });

  it("refuses events that can't happen in a state", () => {
    const over = transition(assess(), { type: 'outOfTime' });
    expect(isOver(over)).toBe(true);
    expect(() => transition(over, { type: 'outOfTime' })).toThrow(/"outOfTime" can't happen in step "paused"/);
    expect(() => transition(dedup(), { type: 'nothingLeft', at: AT })).toThrow();
    expect(() => transition(assess(), { type: 'dedupRound', checked: 0, merged: 0, error: null, at: AT })).toThrow();
    expect(() => transition(assess(), { type: 'recounted', pending: 1 })).toThrow();
    expect(() => transition(dedup(), { type: 'profileLoaded', current: true, at: AT })).toThrow();
    expect(() => transition(started(run('dedup')), { type: 'crashed', error: 'x' })).toThrow();
    expect(() => transition({ step: 'recount', progress, save: null }, { type: 'outOfTime' })).toThrow();
  });
});
