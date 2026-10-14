import { describe, expect, it } from 'vitest';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { scrapersToRun } from '@/lib/listings/pipeline/fetch';
import { afterRun, FOLLOW_UP_MINUTES, MAX_FOLLOW_UPS, scrapersToFollowUp } from '@/lib/listings/pipeline/follow-up';
import type { FollowUp, Found } from '@/lib/listings/types';

// What a LinkedIn scraper's run couldn't read waits for a follow-up a few minutes later; until then its
// scraper rests, and once nothing is left, its {since} starts from the run that left it.

const STARTED = Date.parse('2026-10-14T07:20:00Z');
const NOW = STARTED + 30_000;
const iso = (at: number) => new Date(at).toISOString();
const offer = { src: 'linkedin', id: '9', title: 'Front End Engineer' } as Found;
const unread = { pages: [{ keyword: 'React', page: 4 }], ads: [offer] };
const waiting = (extra: Partial<FollowUp> = {}): FollowUp => ({
  from: iso(STARTED),
  at: iso(STARTED + FOLLOW_UP_MINUTES * 60_000),
  tries: 0,
  ...unread,
  ...extra,
});
const scraper = (src: string, followUp: FollowUp | null = null, enabled = true) =>
  ({ id: src, src, kind: src, enabled, followUp, lastRunAt: null, config: { url: 'https://x.test' } }) as Scraper;

describe('after a run', () => {
  it("a LinkedIn run that couldn't read everything: what's left waits FOLLOW_UP_MINUTES, {since} stays", () => {
    expect(afterRun(scraper('linkedin'), { complete: false, unread }, STARTED, NOW)).toEqual({
      followUp: waiting({ at: iso(NOW + FOLLOW_UP_MINUTES * 60_000) }),
      completeAt: null,
    });
  });

  it("its follow-up: what's still left waits again, the run it follows stays; once it's all read, {since} starts there", () => {
    const earlier = waiting({ from: '2026-10-14T07:00:00.000Z' });
    const later = STARTED + 10 * 60_000;
    expect(afterRun(scraper('linkedin', earlier), { complete: false, unread }, later, later).followUp).toMatchObject({
      from: '2026-10-14T07:00:00.000Z',
      tries: 1,
    });
    expect(afterRun(scraper('linkedin', earlier), { complete: true, unread: { pages: [], ads: [] } }, later)).toEqual({
      followUp: null,
      completeAt: '2026-10-14T07:00:00.000Z',
    });
  });

  it('given up after MAX_FOLLOW_UPS: the next run reads its whole window again', () => {
    const last = waiting({ tries: MAX_FOLLOW_UPS - 1 });
    expect(afterRun(scraper('linkedin', last), { complete: false, unread }, NOW, NOW)).toEqual({
      followUp: null,
      completeAt: null,
    });
  });

  it('a board without a pace has no follow-ups: complete from now, or not', () => {
    expect(afterRun(scraper('justjoin'), { complete: false, unread }, STARTED, NOW)).toEqual({
      followUp: null,
      completeAt: null,
    });
    expect(afterRun(scraper('justjoin'), { complete: true, unread }, STARTED, NOW).completeAt).toBe(iso(NOW));
  });
});

describe('which scrapers run', () => {
  const settings = { keywords: ['React'] };
  const resting = scraper('linkedin', waiting());
  const others = [scraper('justjoin'), scraper('nofluff', null, false)];

  it('a scraper waiting for its follow-up rests until then, in every run', () => {
    expect(scrapersToRun([resting, ...others], settings, true, NOW).map(({ id }) => id)).toEqual(['justjoin']);
    expect(scrapersToRun([resting, ...others], settings, false, NOW).map(({ id }) => id)).toEqual(['justjoin']);
    expect(scrapersToFollowUp([resting, ...others], NOW)).toEqual([]);
  });

  it('once due (a minute early: the knocks are not exact), a run takes it, and a follow-up only it', () => {
    const due = Date.parse(waiting().at) - 60_000;
    expect(scrapersToRun([resting, ...others], settings, true, due).map(({ id }) => id)).toEqual([
      'linkedin',
      'justjoin',
    ]);
    expect(scrapersToFollowUp([resting, ...others], due).map(({ id }) => id)).toEqual(['linkedin']);
    expect(scrapersToFollowUp([scraper('linkedin', waiting(), false)], due)).toEqual([]);
  });
});
