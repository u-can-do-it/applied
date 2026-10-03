import { describe, expect, it } from 'vitest';
import { filterCounts, filterRuns, isRunFilter } from '@/features/activity/run-filter';

const runs = [
  { id: 1, trigger: 'cron', errors: [] },
  { id: 2, trigger: 'manual', errors: [{ scraper: 'LinkedIn', error: 'HTTP 429' }] },
  { id: 3, trigger: 'cron', errors: [{ scraper: 'Run', error: 'db down' }] },
  { id: 4, trigger: 'telegram', errors: [] },
];

describe('the runs log filter', () => {
  it('shows every run, the ones a trigger started, or the ones with errors, in their order', () => {
    expect(filterRuns(runs, 'all').map((run) => run.id)).toEqual([1, 2, 3, 4]);
    expect(filterRuns(runs, 'cron').map((run) => run.id)).toEqual([1, 3]);
    expect(filterRuns(runs, 'manual').map((run) => run.id)).toEqual([2]);
    expect(filterRuns(runs, 'telegram').map((run) => run.id)).toEqual([4]);
    expect(filterRuns(runs, 'failed').map((run) => run.id)).toEqual([2, 3]);
  });

  it('counts what each filter shows', () => {
    expect(filterCounts(runs)).toEqual({ all: 4, cron: 2, manual: 1, telegram: 1, failed: 2 });
    expect(filterCounts([])).toEqual({ all: 0, cron: 0, manual: 0, telegram: 0, failed: 0 });
  });

  it('knows its filters', () => {
    expect(isRunFilter('cron')).toBe(true);
    expect(isRunFilter('')).toBe(false);
  });
});
