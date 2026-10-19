import { describe, expect, it } from 'vitest';
import { checkingSince, isMatching } from '@/lib/ai/matching';

const now = Date.parse('2026-10-19T13:40:00Z');
const run = { startedAt: '2026-10-19T13:35:00.123456+00:00' };
const held = '2026-10-19T13:44:00+00:00';

describe('checkingSince', () => {
  it('the run that holds the scrape lock, with the AI filter on: since it started', () => {
    expect(checkingSince({ aiOn: true, lockedUntil: held, run, now })).toBe(run.startedAt);
  });

  it('no lock, or one run out (a run that died), or no run: nothing is being checked', () => {
    expect(checkingSince({ aiOn: true, lockedUntil: null, run, now })).toBeNull();
    expect(checkingSince({ aiOn: true, lockedUntil: '2026-10-19T13:39:59+00:00', run, now })).toBeNull();
    expect(checkingSince({ aiOn: true, lockedUntil: held, run: null, now })).toBeNull();
  });

  it('the AI filter off, no profile or no OpenAI key: a run checks nothing', () => {
    expect(checkingSince({ aiOn: false, lockedUntil: held, run, now })).toBeNull();
  });
});

describe('isMatching', () => {
  const since = run.startedAt;
  const verdict = { match: true, score: 80 };

  it('a job the run brought, without its verdict yet', () => {
    expect(isMatching({ firstSeen: '2026-10-19T13:35:40.5+00:00' }, since)).toBe(true);
  });

  it('not once judged, nor a job from before the run (its check is over: no ad, or it failed)', () => {
    expect(isMatching({ firstSeen: '2026-10-19T13:35:40.5+00:00', ai: verdict }, since)).toBe(false);
    expect(isMatching({ firstSeen: '2026-10-19T13:21:00+00:00' }, since)).toBe(false);
  });

  it('nothing is while no run is checking', () => {
    expect(isMatching({ firstSeen: '2026-10-19T13:35:40.5+00:00' }, null)).toBe(false);
  });
});
