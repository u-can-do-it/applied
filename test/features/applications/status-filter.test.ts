import { expect, it } from 'vitest';
import type { Application } from '@/lib/applications';
import { outcomeLabel, stageOf, type HistoryEntry, type OutcomeId, type StageId } from '@/lib/stages';
import { cellId, filterOf, TILES } from '@/features/applications/status-filter';

const app = (stage: StageId, outcome: OutcomeId, history: HistoryEntry[] = []) =>
  ({ stage, outcome, history }) as unknown as Application;

it('nothing, or what ?status= can’t be (an old or mistyped link), shows them all', () => {
  for (const status of [null, '', 'nope', 'hr-nope', 'hr-failed-x', 'offer-ghosted', 'toString', 'constructor'])
    expect(filterOf(status)).toBeNull();
});

it('a tile: its label, and its applications by the last status', () => {
  for (const [id, tile] of Object.entries(TILES)) expect(filterOf(id)).toMatchObject({ id, label: tile.label });
  // HR passed, then rejected at the technical interview: rejected, not a positive reply
  const rejectedLater = app('technical', 'failed', [step('hr', 'passed'), step('technical', 'failed')]);
  expect(filterOf('rejected')?.test(rejectedLater)).toBe(true);
  expect(filterOf('positive')?.test(rejectedLater)).toBe(false);
  expect(filterOf('positive')?.test(app('hr', 'passed'))).toBe(true);
  // In progress: a recruitment process going on; No answer yet: still at Submitted
  expect(filterOf('process')?.test(app('hr', 'passed'))).toBe(true);
  expect(filterOf('process')?.test(app('submitted', 'pending'))).toBe(false);
  expect(filterOf('unanswered')?.test(app('submitted', 'pending'))).toBe(true);
  expect(filterOf('unanswered')?.test(app('hr', 'passed'))).toBe(false);
});

it('a funnel bar: the stage the last status is at', () => {
  const filter = filterOf('hr');
  expect(filter).toMatchObject({ id: 'hr', label: stageOf('hr').label });
  expect(filter?.test(app('hr', 'failed'))).toBe(true);
  expect(filter?.test(app('technical', 'failed', [step('hr', 'passed')]))).toBe(false);
});

it('a cell of the table: that stage and outcome, now', () => {
  const filter = filterOf(cellId('hr', 'passed'));
  expect(filter).toMatchObject({ id: 'hr-passed', label: `${stageOf('hr').short} · ${outcomeLabel('hr', 'passed')}` });
  expect(filter?.test(app('hr', 'passed'))).toBe(true);
  expect(filter?.test(app('technical', 'failed', [step('hr', 'passed')]))).toBe(false);
  expect(filterOf(cellId('offer', 'passed'))?.label).toBe(
    `${stageOf('offer').short} · ${outcomeLabel('offer', 'passed')}`,
  );
});

function step(stage: StageId, state: OutcomeId): HistoryEntry {
  return { stage, state, at: '2026-10-01T10:00:00Z' };
}
