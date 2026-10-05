import { describe, expect, it } from 'vitest';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { scrapersToRun } from '@/lib/listings/pipeline/fetch';
import { intervalOf, isDue, nextRunAt } from '@/lib/listings/quota';

// A board with a quota of calls (Adzuna: one every 20 minutes) runs as often as its scrapers' calls allow.

const now = Date.parse('2026-10-05T12:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const URL = 'https://api.adzuna.com/v1/api/jobs/pl/search/{page}?what_or={keywords}';

type Quota = Pick<Scraper, 'kind' | 'enabled' | 'config' | 'lastRunAt'>;
const scraper = (extra: Partial<Quota> = {}): Quota => ({
  kind: 'adzuna',
  enabled: true,
  config: { url: URL },
  lastRunAt: ago(10),
  ...extra,
});
const keywords = ['React', 'Vue'];

describe('the quota of calls', () => {
  it('one scraper, one page: every 20 minutes, so every other run of a 10-minute schedule', () => {
    const one = [scraper()];
    expect(intervalOf(one[0], one, keywords)).toBe(20);
    // the run 10 minutes later skips it, the one 20 minutes later (recorded a little after it started) takes it
    for (const [minutes, due] of [
      [10, false],
      [14, false],
      [19.9, true],
      [40, true],
    ] as const)
      expect(isDue({ ...one[0], lastRunAt: ago(minutes) }, one, keywords, now), `${minutes} min`).toBe(due);
  });

  it('every call counts: pages, {keyword} searches and the other scrapers of the board, if on', () => {
    const paged = scraper({ config: { url: URL, pages: 3 } });
    const perKeyword = scraper({ config: { url: URL.replace('{keywords}', '{keyword}') } });
    const off = scraper({ enabled: false, config: { url: URL, pages: 5 } });
    const other = { ...scraper(), kind: 'justjoin' as const };
    expect(intervalOf(paged, [paged], keywords)).toBe(60);
    expect(intervalOf(perKeyword, [perKeyword], keywords)).toBe(40);
    expect(intervalOf(paged, [paged, perKeyword, off, other], keywords)).toBe(100);
  });

  it('never run, or a board without a quota: due on every run', () => {
    expect(nextRunAt(scraper({ lastRunAt: null }), [], keywords)).toBeNull();
    const justjoin = scraper({ kind: 'justjoin', lastRunAt: ago(0) });
    expect(nextRunAt(justjoin, [justjoin], keywords)).toBeNull();
    expect(isDue(justjoin, [justjoin], keywords, now)).toBe(true);
  });

  it('a scheduled run leaves out a scraper its quota holds back; Scrape now and /scrape take it anyway', () => {
    const adzuna = { ...scraper(), id: 'a', name: 'Adzuna' } as Scraper;
    const justjoin = { ...scraper({ kind: 'justjoin' }), id: 'j', name: 'JustJoin' } as Scraper;
    const off = { ...scraper({ kind: 'nofluff', enabled: false }), id: 'n', name: 'NoFluff' } as Scraper;
    const all = [adzuna, justjoin, off];
    const names = (scheduled: boolean) => scrapersToRun(all, { keywords }, scheduled, now).map((one) => one.name);
    expect(names(true)).toEqual(['JustJoin']);
    expect(names(false)).toEqual(['Adzuna', 'JustJoin']);
  });
});
