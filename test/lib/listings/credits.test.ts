import { describe, expect, it } from 'vitest';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { creditsUntil, monthlyCredits, runsEvery } from '@/lib/listings/credits';

// What the scrapers of the boards read through ScrapingAnt spend a month: their pages, at the intervals the
// schedule actually runs them.

type Credited = Parameters<typeof monthlyCredits>[0][number];
const scraper = (kind: Scraper['kind'], url: string, extra: Partial<Credited> = {}): Credited => ({
  id: kind,
  name: kind,
  kind,
  src: kind,
  enabled: true,
  config: { url },
  lastRunAt: null,
  ...extra,
});
const schedule = { everyMinutes: 10, weekendEveryMinutes: 10, fromHour: 7, toHour: 22, keywords: ['React'] };
const credits = (scrapers: Credited[], over: Partial<typeof schedule> = {}) =>
  Object.fromEntries(monthlyCredits(scrapers, { ...schedule, ...over }).map((one) => [one.name, one.credits]));

describe('ScrapingAnt credits a month', () => {
  it('a run is due 5 minutes early: on a 10-minute schedule 15 minutes is every 10, 20 every 20, 3 hours every 3', () => {
    expect(runsEvery(15, 10)).toBe(10);
    expect(runsEvery(20, 10)).toBe(20);
    expect(runsEvery(180, 10)).toBe(180);
    expect(runsEvery(20, 30)).toBe(30); // never more often than the schedule
    expect(runsEvery(null, 10)).toBe(10);
  });

  it("each scraper of a ScrapingAnt board, at its board's share or its own interval, 25 a residential page", () => {
    const protocol = scraper('theprotocol', 'https://theprotocol.it/praca?kw={keyword}&sort=date');
    const eldorado = scraper('eldorado', 'https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest');
    const own = scraper('pracuj', 'https://it.pracuj.pl/praca/{keyword};kw?sc=0', {
      config: { url: 'https://it.pracuj.pl/praca/{keyword};kw?sc=0', everyMinutes: 60 },
    });
    const justjoin = scraper('justjoin', 'https://justjoin.it/api/candidate-api/offers?keywords={keyword}');
    // 15 hours a day for 30 days: every 20 minutes 1,350 pages, every 3 hours 150 (×25), every hour 450
    expect(credits([protocol, eldorado, own, justjoin])).toEqual({ theprotocol: 1350, eldorado: 3750, pracuj: 450 });
    // two keywords: twice the pages, and the board's share every 40 minutes: the same credits
    expect(credits([protocol], { keywords: ['React', 'Vue'] })).toEqual({ theprotocol: 1350 });
    // off: nothing; all day (from = to): 24 hours
    expect(credits([{ ...protocol, enabled: false }])).toEqual({});
    expect(credits([protocol], { fromHour: 0, toHour: 0 })).toEqual({ theprotocol: 2160 });
  });

  it('what they would spend until the credits reset, at that pace', () => {
    const now = Date.parse('2026-10-25T00:00:00Z');
    expect(creditsUntil(3000, '2026-11-09T00:00:00Z', now)).toBe(1500);
    expect(creditsUntil(3000, '2026-10-01T00:00:00Z', now)).toBe(0);
  });
});
