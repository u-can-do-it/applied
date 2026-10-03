import { describe, expect, it } from 'vitest';
import {
  isActive,
  isRejected,
  isStage,
  isOutcome,
  reached,
  STAGES,
  OUTCOMES,
  outcomeHeading,
  outcomeLabel,
  outcomesFor,
  stats,
  type HistoryEntry,
  type StageId,
  type OutcomeId,
  type WithStatus,
} from '@/lib/stages';

const app = (stage: StageId, outcome: OutcomeId, history: HistoryEntry[] = []): WithStatus => ({
  stage,
  outcome,
  history,
});
const step = (stage: StageId, state: OutcomeId = 'passed'): HistoryEntry => ({
  stage,
  state,
  at: '2026-10-01T10:00:00Z',
});

describe('stage and state names', () => {
  it('an offer has its own outcomes, and no ghosted or talent pool', () => {
    expect(outcomesFor('offer')).toEqual([
      { id: 'pending', label: 'Received' },
      { id: 'passed', label: 'Accepted' },
      { id: 'failed', label: 'Rejected' },
    ]);
  });

  it('other stages have every outcome, with hints where there are any', () => {
    const states = outcomesFor('technical');
    expect(states.map((outcome) => outcome.id)).toEqual(OUTCOMES.map((outcome) => outcome.id));
    expect(states.find((outcome) => outcome.id === 'pool')?.hint).toMatch(/Talent pool/);
    expect(states.find((outcome) => outcome.id === 'pending')?.hint).toBeUndefined();
  });

  it('outcomeLabel names the outcome at that stage; outcomeHeading prefers the short name', () => {
    expect(outcomeLabel('offer', 'passed')).toBe('Accepted');
    expect(outcomeLabel('offer', 'pending')).toBe('Received');
    expect(outcomeLabel('offer', 'ghosted')).toBe('Ghosted'); // not an offer outcome: the general name
    expect(outcomeLabel('hr', 'passed')).toBe('Passed');
    expect(outcomeLabel('hr', 'failed')).toBe('Rejected');
    expect(outcomeHeading('pool')).toBe('Talent pool');
    expect(outcomeHeading('pending')).toBe('In progress');
  });

  it('isStage / isOutcome guard the stored values', () => {
    for (const stage of STAGES) expect(isStage(stage.id)).toBe(true);
    for (const outcome of OUTCOMES) expect(isOutcome(outcome.id)).toBe(true);
    expect(isStage('interview')).toBe(false);
    expect(isStage(undefined)).toBe(false);
    expect(isOutcome('accepted')).toBe(false);
    expect(isOutcome('passed ')).toBe(false);
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
    const application = app('technical', 'pending', [step('submitted'), step('hr'), step('screening')]);
    expect(reached(application)).toEqual(new Set(['submitted', 'technical', 'hr', 'screening', 'invited']));
  });
});

describe('stats', () => {
  it('nothing yet: all zeros', () => {
    const totals = stats([]);
    expect(totals).toMatchObject({ sent: 0, positive: 0, offers: 0, active: 0, rejected: 0, ghosted: 0, pool: 0 });
    expect(totals.now).toEqual(STAGES.map((stage) => ({ stage: stage.id, count: 0 })));
    for (const stage of STAGES) for (const state of OUTCOMES) expect(totals.byStage[stage.id][state.id]).toBe(0);
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
    const totals = stats(apps);
    expect(totals.sent).toBe(11);
    expect(totals.positive).toBe(8); // everything past Submitted
    expect(totals.offers).toBe(3);
    expect(totals.active).toBe(4); // submitted/pending, invited/pending, technical/passed, offer/pending
    expect(totals.rejected).toBe(2);
    expect(totals.ghosted).toBe(2);
    expect(totals.pool).toBe(1);
    // a decided offer is in none of the buckets
    expect(totals.active + totals.rejected + totals.ghosted + totals.pool).toBe(totals.sent - 2);
    expect(totals.now).toEqual([
      { stage: 'submitted', count: 3 },
      { stage: 'invited', count: 1 },
      { stage: 'screening', count: 1 },
      { stage: 'technical', count: 2 },
      { stage: 'hr', count: 1 },
      { stage: 'offer', count: 3 },
    ]);
    expect(totals.byStage.technical).toEqual({ pending: 0, passed: 1, failed: 1, ghosted: 0, pool: 0 });
    expect(totals.byStage.offer).toEqual({ pending: 1, passed: 1, failed: 1, ghosted: 0, pool: 0 });
  });

  it('the history does not count, only where it is now', () => {
    const totals = stats([app('submitted', 'pending', [step('submitted'), step('technical', 'failed')])]);
    expect(totals.positive).toBe(0);
    expect(totals.byStage.technical.failed).toBe(0);
  });
});
