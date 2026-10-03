import { describe, expect, it } from 'vitest';
import { isPaused, runCard, type RunFields } from '@/lib/ai/run-view';

const base: RunFields = {
  status: 'running',
  phase: 'dedup',
  lockUntil: '2026-10-03T12:03:00Z',
  pairsChecked: 12,
  merged: 2,
  done: 0,
  total: 20,
  error: null,
};
const now = Date.parse('2026-10-03T12:00:00Z');
const steps = (run: RunFields, paused = isPaused(run, now)) =>
  runCard(run, paused).steps.map((step) => `${step.name}: ${step.status} (${step.counts})`);

describe('the AI run card', () => {
  it('is paused when the run is open and no slice holds its lock (free, or run out)', () => {
    expect(isPaused(base, now)).toBe(false);
    expect(isPaused({ ...base, lockUntil: null }, now)).toBe(true);
    expect(isPaused({ ...base, lockUntil: '2026-10-03T11:59:00Z' }, now)).toBe(true);
    expect(isPaused({ ...base, status: 'done', lockUntil: null }, now)).toBe(false);
  });

  it('working on duplicates: Duplicates active, Assessment next', () => {
    const view = runCard(base, false);
    expect(view.state).toEqual({ step: 'dedup' });
    expect(view.badge).toBe('Working');
    expect(view.percent).toBeNull();
    expect(steps(base)).toEqual(['Duplicates: active (12 pairs checked · 2 merged)', 'Assessment: waiting (next)']);
  });

  it('assessing: Duplicates done, Assessment active with its progress', () => {
    const run = { ...base, phase: 'assess' as const, done: 5 };
    expect(runCard(run, false)).toMatchObject({ state: { step: 'assess' }, badge: 'Working', percent: 25 });
    expect(steps(run)).toEqual([
      'Duplicates: done (12 pairs checked · 2 merged)',
      'Assessment: active (5 of 20 checked)',
    ]);
  });

  it('paused: the step it stopped in is paused, with the error a crash left', () => {
    const run = { ...base, phase: 'assess' as const, done: 5, lockUntil: null, error: 'OpenAI timed out' };
    const view = runCard(run, true);
    expect(view).toMatchObject({
      state: { step: 'paused', phase: 'assess' },
      badge: 'Paused',
      note: 'OpenAI timed out',
    });
    expect(steps(run)).toEqual([
      'Duplicates: done (12 pairs checked · 2 merged)',
      'Assessment: paused (5 of 20 checked)',
    ]);
    expect(steps({ ...base, lockUntil: null })[0]).toBe('Duplicates: paused (12 pairs checked · 2 merged)');
  });

  it('on the page that continues it (the AI tab), a paused run is "Continuing", never "Paused"', () => {
    const run = { ...base, phase: 'assess' as const, done: 5, lockUntil: null };
    expect(runCard(run, true, true)).toMatchObject({ state: { step: 'assess' }, badge: 'Continuing', percent: 25 });
    expect(runCard(run, true, true).steps[1].status).toBe('active');
    expect(runCard(run, false, true).badge).toBe('Working');
    expect(runCard({ ...run, status: 'done' }, false, true).badge).toBe('Done');
  });

  it('finished: done, failed in a step, cancelled', () => {
    const done = { ...base, status: 'done' as const, phase: 'assess' as const, done: 20, lockUntil: null };
    expect(runCard(done, false)).toMatchObject({
      state: { step: 'finished', status: 'done' },
      badge: 'Done',
      percent: null,
    });
    expect(steps(done)).toEqual([
      'Duplicates: done (12 pairs checked · 2 merged)',
      'Assessment: done (20 of 20 checked)',
    ]);

    const failed = { ...base, status: 'failed' as const, lockUntil: null, error: 'Duplicate check: 500' };
    expect(runCard(failed, false)).toMatchObject({ badge: 'Failed', note: 'Duplicate check: 500' });
    expect(steps(failed)).toEqual([
      'Duplicates: stopped (12 pairs checked · 2 merged)',
      'Assessment: stopped (not reached)',
    ]);

    const cancelled = { ...done, status: 'cancelled' as const, done: 3 };
    expect(runCard(cancelled, false).badge).toBe('Cancelled');
    expect(steps(cancelled)[1]).toBe('Assessment: stopped (3 of 20 checked)');
  });
});
