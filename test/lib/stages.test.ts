import { describe, expect, it } from 'vitest';
import {
  isActive,
  isInProcess,
  isPositive,
  isRejected,
  isStage,
  isUnanswered,
  isOutcome,
  reached,
  STAGES,
  OUTCOMES,
  OFFER_LABELS,
  outcomeOf,
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
      { id: 'pending', label: OFFER_LABELS.pending },
      { id: 'passed', label: OFFER_LABELS.passed },
      { id: 'failed', label: OFFER_LABELS.failed },
    ]);
  });

  it('other stages have every outcome, with hints where there are any', () => {
    const states = outcomesFor('technical');
    expect(states.map((outcome) => outcome.id)).toEqual(OUTCOMES.map((outcome) => outcome.id));
    expect(states.find((outcome) => outcome.id === 'pool')?.hint).toMatch(/CV do bazy/);
    expect(states.find((outcome) => outcome.id === 'pending')?.hint).toBeUndefined();
  });

  it('outcomeLabel names the outcome at that stage; outcomeHeading is its name as a heading', () => {
    expect(outcomeLabel('offer', 'passed')).toBe(OFFER_LABELS.passed);
    expect(outcomeLabel('offer', 'pending')).toBe(OFFER_LABELS.pending);
    expect(outcomeLabel('offer', 'ghosted')).toBe(outcomeOf('ghosted').label); // not an offer outcome: the general name
    expect(outcomeLabel('hr', 'passed')).toBe(outcomeOf('passed').label);
    expect(outcomeLabel('hr', 'failed')).toBe(outcomeOf('failed').label);
    expect(outcomeHeading('pool')).toBe(outcomeOf('pool').label);
    expect(outcomeHeading('pending')).toBe(outcomeOf('pending').label);
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

describe('isActive / isInProcess / isUnanswered / isRejected', () => {
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

  it('active = in a recruitment process (past Submitted) or no answer yet (at Submitted)', () => {
    expect(isInProcess(app('invited', 'pending'))).toBe(true);
    expect(isInProcess(app('technical', 'passed'))).toBe(true);
    expect(isInProcess(app('offer', 'pending'))).toBe(true);
    expect(isInProcess(app('submitted', 'pending'))).toBe(false);
    expect(isInProcess(app('hr', 'failed'))).toBe(false);
    expect(isInProcess(app('offer', 'passed'))).toBe(false);
    expect(isUnanswered(app('submitted', 'pending'))).toBe(true);
    expect(isUnanswered(app('submitted', 'ghosted'))).toBe(false);
    expect(isUnanswered(app('invited', 'pending'))).toBe(false);
  });

  it('positive = past Submitted and still good, by the last status only', () => {
    expect(isPositive(app('invited', 'pending'))).toBe(true);
    expect(isPositive(app('technical', 'passed'))).toBe(true);
    expect(isPositive(app('submitted', 'passed'))).toBe(false);
    expect(isPositive(app('hr', 'failed', [step('hr', 'passed')]))).toBe(false);
    expect(isPositive(app('technical', 'ghosted'))).toBe(false);
    expect(isPositive(app('screening', 'pool'))).toBe(false);
    for (const outcome of ['pending', 'passed', 'failed'] as const)
      expect(isPositive(app('offer', outcome))).toBe(true);
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
    expect(totals).toMatchObject({
      sent: 0,
      positive: 0,
      offers: 0,
      inProcess: 0,
      unanswered: 0,
      rejected: 0,
      ghosted: 0,
      pool: 0,
    });
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
    expect(totals.positive).toBe(5); // invited/pending, technical/passed and the offers
    expect(totals.offers).toBe(3);
    expect(totals.inProcess).toBe(3); // invited/pending, technical/passed, offer/pending
    expect(totals.unanswered).toBe(1); // submitted/pending
    expect(totals.rejected).toBe(2);
    expect(totals.ghosted).toBe(2);
    expect(totals.pool).toBe(1);
    // a decided offer is in none of the buckets
    expect(totals.inProcess + totals.unanswered + totals.rejected + totals.ghosted + totals.pool).toBe(totals.sent - 2);
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
