import { describe, expect, it } from 'vitest';
import {
  filterCounts,
  isRunFilter,
  parseRunsQuery,
  runsHref,
  runsOf,
  RUN_FILTERS,
} from '@/features/activity/run-filter';

describe('the runs log filter', () => {
  it('asks the repo for every run, the ones a trigger started, or the ones with errors', () => {
    expect(runsOf('all')).toEqual({});
    expect(runsOf('cron')).toEqual({ trigger: 'cron' });
    expect(runsOf('telegram')).toEqual({ trigger: 'telegram' });
    expect(runsOf('failed')).toEqual({ failed: true });
  });

  it('counts what each filter shows, a trigger without runs as none', () => {
    expect(filterCounts({ all: 4, failed: 2, byTrigger: { cron: 2, manual: 1, telegram: 1 } })).toEqual({
      all: 4,
      cron: 2,
      manual: 1,
      telegram: 1,
      bookmarklet: 0,
      failed: 2,
    });
    expect(filterCounts({ all: 0, failed: 0, byTrigger: {} })).toEqual({
      all: 0,
      cron: 0,
      manual: 0,
      telegram: 0,
      bookmarklet: 0,
      failed: 0,
    });
  });

  it('knows its filters', () => {
    expect(isRunFilter('cron')).toBe(true);
    expect(isRunFilter('')).toBe(false);
  });
});

describe('the runs log in the URL', () => {
  it('links a filter and a page, leaving out "all" and the first page', () => {
    expect(runsHref('all')).toBe('/activity');
    expect(runsHref('all', 0)).toBe('/activity');
    expect(runsHref('failed')).toBe('/activity?runs=failed');
    expect(runsHref('cron', 2)).toBe('/activity?runs=cron&page=2');
    expect(runsHref('all', 1)).toBe('/activity?page=1');
  });

  it('reads them back, each checked', () => {
    for (const { id } of RUN_FILTERS)
      for (const page of [0, 3]) {
        const query = Object.fromEntries(new URL(runsHref(id, page), 'https://app.test').searchParams);
        expect(parseRunsQuery(query)).toEqual({ filter: id, page });
      }
    expect(parseRunsQuery({})).toEqual({ filter: 'all', page: 0 });
    expect(parseRunsQuery({ runs: 'nope', page: '-2' })).toEqual({ filter: 'all', page: 0 });
    expect(parseRunsQuery({ runs: ['manual', 'cron'], page: '1.7' })).toEqual({ filter: 'manual', page: 1 });
    expect(parseRunsQuery({ page: 'x' })).toEqual({ filter: 'all', page: 0 });
  });
});
