import { describe, expect, it } from 'vitest';
import {
  GHOST_AFTER_DAYS,
  isActive,
  isInProcess,
  isPositive,
  isRejected,
  isStage,
  isUnanswered,
  isOutcome,
  outcomeAt,
  reached,
  STAGES,
  OUTCOMES,
  OFFER_LABELS,
  outcomeOf,
  outcomeHeading,
  outcomeHint,
  outcomeLabel,
  outcomesFor,
  passedBefore,
  POOL_GHOST_AFTER_DAYS,
  stats,
  withStatus,
  type HistoryEntry,
  type StageId,
  type OutcomeId,
  type WithStatus,
  TALENT_POOL,
} from '@/lib/stages';

const app = (
  stage: StageId,
  outcome: OutcomeId,
  history: HistoryEntry[] = [],
  talentPool = false,
): WithStatus & { talentPool: boolean } => ({ stage, outcome, history, talentPool });
const step = (stage: StageId, state: OutcomeId = 'passed'): HistoryEntry => ({
  stage,
  state,
  at: '2026-10-01T10:00:00Z',
});

describe('stage and state names', () => {
  it('an offer has its own outcomes, and no ghosted', () => {
    expect(outcomesFor('offer')).toEqual([
      { id: 'pending', label: OFFER_LABELS.pending },
      { id: 'passed', label: OFFER_LABELS.passed },
      { id: 'failed', label: OFFER_LABELS.failed },
      { id: 'withdrawn', label: OFFER_LABELS.withdrawn },
    ]);
  });

  it('other stages have every outcome; the talent pool is none (a mark), with its hint', () => {
    const states = outcomesFor('technical');
    expect(states.map((outcome) => outcome.id)).toEqual(OUTCOMES.map((outcome) => outcome.id));
    expect(isOutcome('pool')).toBe(false);
    expect(TALENT_POOL.hint).toMatch(/CV do bazy/);
  });

  it('Ghosted and Withdrawn say what they mean: a silent no set by the app, your own no; the others need no hint', () => {
    const ghosted = outcomeHint('ghosted');
    expect(ghosted).toMatch(/silent no/);
    expect(ghosted).toContain(`${GHOST_AFTER_DAYS} days`);
    expect(ghosted).toContain(`${POOL_GHOST_AFTER_DAYS} in the talent pool`);
    expect(outcomeHint('withdrawn')).toMatch(/your own no/);
    const hinted: OutcomeId[] = ['ghosted', 'withdrawn'];
    for (const outcome of OUTCOMES) if (!hinted.includes(outcome.id)) expect(outcomeHint(outcome.id)).toBeUndefined();
  });

  it('outcomeLabel names the outcome at that stage; outcomeHeading is its name as a heading', () => {
    expect(outcomeLabel('offer', 'passed')).toBe(OFFER_LABELS.passed);
    expect(outcomeLabel('offer', 'pending')).toBe(OFFER_LABELS.pending);
    expect(outcomeLabel('offer', 'ghosted')).toBe(outcomeOf('ghosted').label); // not an offer outcome: the general name
    expect(outcomeLabel('hr', 'passed')).toBe(outcomeOf('passed').label);
    expect(outcomeLabel('hr', 'failed')).toBe(outcomeOf('failed').label);
    expect(outcomeHeading('ghosted')).toBe(outcomeOf('ghosted').label);
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
    expect(isActive(app('screening', 'withdrawn'))).toBe(false);
    expect(isActive(app('screening', 'pending', [], true))).toBe(true); // the talent pool is a mark
  });

  it('an offer is active only while undecided', () => {
    expect(isActive(app('offer', 'pending'))).toBe(true);
    expect(isActive(app('offer', 'passed'))).toBe(false);
    expect(isActive(app('offer', 'failed'))).toBe(false);
    expect(isActive(app('offer', 'withdrawn'))).toBe(false);
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
    for (const outcome of ['pending', 'passed', 'failed', 'withdrawn'] as const)
      expect(isPositive(app('offer', outcome))).toBe(true);
    expect(isPositive(app('screening', 'withdrawn'))).toBe(false);
  });

  it('rejected = they said no, an offer they took back too; your own no (Withdrawn) is not that', () => {
    expect(isRejected(app('hr', 'failed'))).toBe(true);
    expect(isRejected(app('submitted', 'failed'))).toBe(true);
    expect(isRejected(app('offer', 'failed'))).toBe(true); // taken back
    expect(isRejected(app('offer', 'withdrawn'))).toBe(false); // you declined
    expect(isRejected(app('screening', 'withdrawn'))).toBe(false);
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
    expect(reached(app('test', 'pending'))).toEqual(new Set(['submitted', 'test', 'invited']));
  });
});

describe('outcomeAt', () => {
  it('the stage it is at now: its outcome; one it never got to: null', () => {
    expect(outcomeAt(app('hr', 'ghosted'), 'hr')).toBe('ghosted');
    expect(outcomeAt(app('screening', 'pending'), 'technical')).toBeNull();
  });

  it('one it moved on from: its last step there, Passed if still in progress or skipped', () => {
    const application = app('hr', 'pending', [
      step('submitted', 'pending'),
      step('screening', 'pending'),
      step('technical', 'pending'),
      step('technical', 'failed'),
    ]);
    expect(outcomeAt(application, 'technical')).toBe('failed');
    expect(outcomeAt(application, 'screening')).toBe('passed');
    expect(outcomeAt(application, 'submitted')).toBe('passed');
    expect(outcomeAt(application, 'invited')).toBe('passed'); // skipped
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
      withdrawn: 0,
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
      app('screening', 'pending', [], true), // in the talent pool: still in progress
      app('technical', 'passed'),
      app('technical', 'failed'),
      app('hr', 'ghosted'),
      app('offer', 'pending'),
      app('offer', 'passed'),
      app('offer', 'failed'), // they took it back
      app('offer', 'withdrawn'), // you declined it
      app('screening', 'withdrawn'), // you pulled out
    ];
    const totals = stats(apps);
    expect(totals.sent).toBe(13);
    expect(totals.positive).toBe(7); // invited/pending, screening/pending, technical/passed and the offers
    expect(totals.offers).toBe(4);
    expect(totals.inProcess).toBe(4); // invited/pending, screening/pending, technical/passed, offer/pending
    expect(totals.unanswered).toBe(1); // submitted/pending
    expect(totals.rejected).toBe(3); // the offer taken back too
    expect(totals.ghosted).toBe(2);
    expect(totals.withdrawn).toBe(2); // the offer declined too
    expect(totals.pool).toBe(1); // a mark: in a bucket of its status too
    // an accepted offer is in none of the buckets
    expect(totals.inProcess + totals.unanswered + totals.rejected + totals.ghosted + totals.withdrawn).toBe(
      totals.sent - 1,
    );
    expect(totals.now).toEqual([
      { stage: 'submitted', count: 3 },
      { stage: 'invited', count: 1 },
      { stage: 'screening', count: 2 },
      { stage: 'test', count: 0 },
      { stage: 'technical', count: 2 },
      { stage: 'hr', count: 1 },
      { stage: 'offer', count: 4 },
    ]);
    // the table: every stage each one got to; the ones past Submitted passed it, and Initial contact
    expect(totals.byStage.submitted).toEqual({ pending: 1, passed: 10, failed: 1, ghosted: 1, withdrawn: 0 });
    expect(totals.byStage.invited).toEqual({ pending: 1, passed: 9, failed: 0, ghosted: 0, withdrawn: 0 });
    expect(totals.byStage.screening).toEqual({ pending: 1, passed: 0, failed: 0, ghosted: 0, withdrawn: 1 });
    expect(totals.byStage.technical).toEqual({ pending: 0, passed: 1, failed: 1, ghosted: 0, withdrawn: 0 });
    expect(totals.byStage.offer).toEqual({ pending: 1, passed: 1, failed: 1, ghosted: 0, withdrawn: 1 });
  });

  it('the tiles and the funnel go by where it is now; the table by the stages it got to', () => {
    const totals = stats([app('submitted', 'pending', [step('submitted'), step('technical', 'failed')])]);
    expect(totals.positive).toBe(0);
    expect(totals.now.find((atStage) => atStage.stage === 'technical')?.count).toBe(0);
    expect(totals.byStage.technical.failed).toBe(1);
    expect(totals.byStage.submitted.pending).toBe(1);
  });
});

describe('passedBefore / withStatus', () => {
  const steps = (history: HistoryEntry[]) => history.map((each) => `${each.stage}/${each.state}`);

  it('getting past Submitted passes the stages before it, skipped ones too', () => {
    const history = [step('submitted', 'pending'), step('screening', 'pending')];
    expect(passedBefore(history, 'technical')).toEqual(['submitted', 'invited', 'screening']);
  });

  it('not at Submitted, not what is already passed', () => {
    expect(passedBefore([step('submitted', 'pending')], 'submitted')).toEqual([]);
    const passed = [step('submitted', 'pending'), step('submitted'), step('invited'), step('screening')];
    expect(passedBefore(passed, 'technical')).toEqual([]);
  });

  it('a stage ghosted, rejected or in progress before you got further is passed now', () => {
    const history = [step('submitted', 'ghosted'), step('invited', 'failed'), step('screening', 'pending')];
    expect(passedBefore(history, 'technical')).toEqual(['submitted', 'invited', 'screening']);
  });

  it('technical and HR come in either order: the other one only if it was there', () => {
    const base = [step('submitted')];
    expect(passedBefore(base, 'hr')).toEqual(['invited']);
    expect(passedBefore([...base, step('hr', 'pending')], 'technical')).toEqual(['invited', 'hr']);
    expect(passedBefore(base, 'offer')).toEqual(['invited']);
    expect(passedBefore([...base, step('technical', 'pending')], 'offer')).toEqual(['invited', 'technical']);
    // an earlier stage doesn't pass a later one
    expect(passedBefore([...base, step('technical', 'pending')], 'screening')).toEqual(['invited']);
  });

  it('screening and the online test come in either order: each only if it was there', () => {
    const base = [step('submitted')];
    expect(passedBefore(base, 'test')).toEqual(['invited']);
    expect(passedBefore([...base, step('test', 'pending')], 'screening')).toEqual(['invited', 'test']);
    expect(passedBefore([...base, step('screening', 'pending')], 'technical')).toEqual(['invited', 'screening']);
    expect(passedBefore([...base, step('screening', 'pending'), step('test', 'pending')], 'hr')).toEqual([
      'invited',
      'screening',
      'test',
    ]);
  });

  it('withStatus adds the passed stages (automatic) before the change, at its time', () => {
    const history = withStatus([step('submitted', 'pending')], 'screening', 'failed', '2026-10-27T10:00:00Z');
    expect(steps(history)).toEqual(['submitted/pending', 'submitted/passed', 'invited/passed', 'screening/failed']);
    expect(history.slice(1, 3).every((each) => each.auto && each.at === '2026-10-27T10:00:00Z')).toBe(true);
    expect(history.at(-1)).toEqual({ stage: 'screening', state: 'failed', at: '2026-10-27T10:00:00Z' });
  });
});
