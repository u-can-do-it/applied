import { describe, expect, it } from 'vitest';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { intervalOf, isDue, nextRunAt } from '@/lib/listings/quota';

// A board with a quota of calls (Adzuna: one an hour) runs as often as its scrapers' calls allow.

const now = Date.parse('2026-10-05T12:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const URL = 'https://api.adzuna.com/v1/api/jobs/pl/search/{page}?what_or={keywords}';

type Quota = Pick<Scraper, 'kind' | 'enabled' | 'config' | 'lastRunAt' | 'lastStatus'>;
const scraper = (extra: Partial<Quota> = {}): Quota => ({
  kind: 'adzuna',
  enabled: true,
  config: { url: URL },
  lastRunAt: ago(30),
  lastStatus: 'ok',
  ...extra,
});
const keywords = ['React', 'Vue'];

describe('the quota of calls', () => {
  it('one scraper, one page: once an hour, with a few minutes to spare for the run before it', () => {
    const one = [scraper()];
    expect(intervalOf(one[0], one, keywords)).toBe(60);
    for (const [minutes, due] of [
      [30, false],
      [54, false],
      [56, true],
      [120, true],
    ] as const)
      expect(isDue({ ...one[0], lastRunAt: ago(minutes) }, one, keywords, now), `${minutes} min`).toBe(due);
  });

  it('every call counts: pages, {keyword} searches and the other scrapers of the board, if on', () => {
    const paged = scraper({ config: { url: URL, pages: 3 } });
    const perKeyword = scraper({ config: { url: URL.replace('{keywords}', '{keyword}') } });
    const off = scraper({ enabled: false, config: { url: URL, pages: 5 } });
    const other = { ...scraper(), kind: 'justjoin' as const };
    expect(intervalOf(paged, [paged], keywords)).toBe(180);
    expect(intervalOf(perKeyword, [perKeyword], keywords)).toBe(120);
    expect(intervalOf(paged, [paged, perKeyword, off, other], keywords)).toBe(300);
  });

  it('after a failure it tries again sooner, but not on every run', () => {
    const failed = scraper({ lastStatus: 'error', lastRunAt: ago(5) });
    expect(isDue(failed, [failed], keywords, now)).toBe(false);
    expect(isDue({ ...failed, lastRunAt: ago(11) }, [failed], keywords, now)).toBe(true);
  });

  it('never run, or a board without a quota: due on every run', () => {
    expect(nextRunAt(scraper({ lastRunAt: null }), [], keywords)).toBeNull();
    const justjoin = scraper({ kind: 'justjoin', lastRunAt: ago(0) });
    expect(nextRunAt(justjoin, [justjoin], keywords)).toBeNull();
    expect(isDue(justjoin, [justjoin], keywords, now)).toBe(true);
  });
});
