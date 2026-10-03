import { describe, expect, it } from 'vitest';
import {
  isActive,
  isRejected,
  isStage,
  isState,
  reached,
  STAGES,
  STATES,
  stateHeading,
  stateLabel,
  statesFor,
  stats,
  type HistoryEntry,
  type StageId,
  type StateId,
  type WithStatus,
} from '@/lib/stages';

const app = (stage: StageId, stage_state: StateId, history: HistoryEntry[] = []): WithStatus => ({
  stage,
  stage_state,
  history,
});
const step = (stage: StageId, state: StateId = 'passed'): HistoryEntry => ({
  stage,
  state,
  at: '2026-10-01T10:00:00Z',
});

describe('stage and state names', () => {
  it('an offer has its own outcomes, and no ghosted or talent pool', () => {
    expect(statesFor('offer')).toEqual([
      { id: 'pending', label: 'Received' },
      { id: 'passed', label: 'Accepted' },
      { id: 'failed', label: 'Rejected' },
    ]);
  });

  it('other stages have every outcome, with hints where there are any', () => {
    const states = statesFor('technical');
    expect(states.map((s) => s.id)).toEqual(STATES.map((s) => s.id));
    expect(states.find((s) => s.id === 'pool')?.hint).toMatch(/Talent pool/);
    expect(states.find((s) => s.id === 'pending')?.hint).toBeUndefined();
  });

  it('stateLabel names the outcome at that stage; stateHeading prefers the short name', () => {
    expect(stateLabel('offer', 'passed')).toBe('Accepted');
    expect(stateLabel('offer', 'pending')).toBe('Received');
    expect(stateLabel('offer', 'ghosted')).toBe('Ghosted'); // not an offer outcome: the general name
    expect(stateLabel('hr', 'passed')).toBe('Passed');
    expect(stateLabel('hr', 'failed')).toBe('Rejected');
    expect(stateHeading('pool')).toBe('Talent pool');
    expect(stateHeading('pending')).toBe('In progress');
  });

  it('isStage / isState guard the stored values', () => {
    for (const s of STAGES) expect(isStage(s.id)).toBe(true);
    for (const s of STATES) expect(isState(s.id)).toBe(true);
    expect(isStage('interview')).toBe(false);
    expect(isStage(undefined)).toBe(false);
    expect(isState('accepted')).toBe(false);
    expect(isState('passed ')).toBe(false);
  });
});

describe('isActive / isRejected', () => {
  it('in progress, or passed and waiting for the next step', () => {
    expect(isActive(app('submitted', 'pending'))).toBe(true);
    expect(isActive(app('technical', 'passed'))).toBe(true);
    expect(isActive(app('technical', 'failed'))).toBe(false);
    expect(isActive(app('hr', 'ghosted'))).toBe(false);
    expect(isActive(app('screening', 'pool'))).toBe(false);
  });

  it('an offer is active only while undecided', () => {
    expect(isActive(app('offer', 'pending'))).toBe(true);
    expect(isActive(app('offer', 'passed'))).toBe(false);
    expect(isActive(app('offer', 'failed'))).toBe(false);
  });

  it('rejected = they said no; an offer you turned down is not that', () => {
    expect(isRejected(app('hr', 'failed'))).toBe(true);
    expect(isRejected(app('submitted', 'failed'))).toBe(true);
    expect(isRejected(app('offer', 'failed'))).toBe(false);
    expect(isRejected(app('hr', 'ghosted'))).toBe(false);
  });
});

describe('reached', () => {
  it('always includes Submitted and the current stage', () => {
    expect(reached(app('submitted', 'pending'))).toEqual(new Set(['submitted']));
    expect(reached(app('invited', 'pending'))).toEqual(new Set(['submitted', 'invited']));
  });

  it('a later stage implies an initial contact, even if it was skipped', () => {
    expect(reached(app('technical', 'pending'))).toEqual(new Set(['submitted', 'technical', 'invited']));
    expect(reached(app('offer', 'passed'))).toEqual(new Set(['submitted', 'offer', 'invited']));
  });

  it('includes every stage from the history, in any order', () => {
    const a = app('technical', 'pending', [step('submitted'), step('hr'), step('screening')]);
    expect(reached(a)).toEqual(new Set(['submitted', 'technical', 'hr', 'screening', 'invited']));
  });
});

describe('stats', () => {
  it('nothing yet: all zeros', () => {
    const s = stats([]);
    expect(s).toMatchObject({ sent: 0, positive: 0, offers: 0, active: 0, rejected: 0, ghosted: 0, pool: 0 });
    expect(s.now).toEqual(STAGES.map((x) => ({ stage: x.id, count: 0 })));
    for (const stage of STAGES) for (const state of STATES) expect(s.byStage[stage.id][state.id]).toBe(0);
  });

  it('counts by the last status', () => {
    const apps = [
      app('submitted', 'pending'),
      app('submitted', 'failed'), // rejected without a word: not positive
      app('submitted', 'ghosted'),
      app('invited', 'pending'),
      app('screening', 'pool'),
      app('technical', 'passed'),
      app('technical', 'failed'),
      app('hr', 'ghosted'),
      app('offer', 'pending'),
      app('offer', 'passed'),
      app('offer', 'failed'), // you turned it down
    ];
    const s = stats(apps);
    expect(s.sent).toBe(11);
    expect(s.positive).toBe(8); // everything past Submitted
    expect(s.offers).toBe(3);
    expect(s.active).toBe(4); // submitted/pending, invited/pending, technical/passed, offer/pending
    expect(s.rejected).toBe(2);
    expect(s.ghosted).toBe(2);
    expect(s.pool).toBe(1);
    // a decided offer is in none of the buckets
    expect(s.active + s.rejected + s.ghosted + s.pool).toBe(s.sent - 2);
    expect(s.now).toEqual([
      { stage: 'submitted', count: 3 },
      { stage: 'invited', count: 1 },
      { stage: 'screening', count: 1 },
      { stage: 'technical', count: 2 },
      { stage: 'hr', count: 1 },
      { stage: 'offer', count: 3 },
    ]);
    expect(s.byStage.technical).toEqual({ pending: 0, passed: 1, failed: 1, ghosted: 0, pool: 0 });
    expect(s.byStage.offer).toEqual({ pending: 1, passed: 1, failed: 1, ghosted: 0, pool: 0 });
  });

  it('the history does not count, only where it is now', () => {
    const s = stats([app('submitted', 'pending', [step('submitted'), step('technical', 'failed')])]);
    expect(s.positive).toBe(0);
    expect(s.byStage.technical.failed).toBe(0);
  });
});
