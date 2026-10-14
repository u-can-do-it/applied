import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkedin } from '@/lib/boards/linkedin';
import { Deferred, paced, resetPace } from '@/lib/pace';

// A paced board's requests (LinkedIn's): one at a time, a gap apart, a batch per window, none while it
// rests after a 429. Fake timers; the requests are answered here.

const pace = linkedin.pace ?? { gapMs: 0, batch: 0, windowMs: 0 };
const LINKEDIN = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/1';
const sentAt: number[] = [];
const answer =
  (status = 200) =>
  () => {
    sentAt.push(Date.now());
    return Promise.resolve(new Response('', { status }));
  };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-10-14T07:20:00Z'));
  resetPace();
  sentAt.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a paced board', () => {
  it('one request at a time, the gap apart', async () => {
    const all = Promise.all([paced(LINKEDIN, answer()), paced(LINKEDIN, answer()), paced(LINKEDIN, answer())]);
    await vi.runAllTimersAsync();
    await all;
    const start = sentAt[0];
    expect(sentAt.map((at) => at - start)).toEqual([0, pace.gapMs, 2 * pace.gapMs]);
  });

  it("past its batch, a request isn't sent but deferred, until the window has room again", async () => {
    const batch = Array.from({ length: pace.batch }, () => paced(LINKEDIN, answer()));
    const over = paced(LINKEDIN, answer());
    const settled = expect(over).rejects.toBeInstanceOf(Deferred);
    await vi.runAllTimersAsync();
    await Promise.all(batch);
    await settled;
    expect(sentAt).toHaveLength(pace.batch);

    vi.setSystemTime(sentAt[0] + pace.windowMs + 1);
    const later = paced(LINKEDIN, answer());
    await vi.runAllTimersAsync();
    expect((await later).status).toBe(200);
  });

  it('rests a window after a 429: what comes then is deferred, not sent', async () => {
    expect((await paced(LINKEDIN, answer(429))).status).toBe(429);
    const next = expect(paced(LINKEDIN, answer())).rejects.toThrow('LinkedIn turned a request away (HTTP 429)');
    await vi.runAllTimersAsync();
    await next;
    expect(sentAt).toHaveLength(1);

    vi.setSystemTime(Date.now() + pace.windowMs);
    const after = paced(LINKEDIN, answer());
    await vi.runAllTimersAsync();
    expect((await after).status).toBe(200);
  });

  it('another board goes at once, whatever LinkedIn waits for', async () => {
    void paced(LINKEDIN, answer());
    void paced(LINKEDIN, answer());
    await paced('https://justjoin.it/job-offers/1', answer());
    expect(sentAt).toHaveLength(2); // LinkedIn's first and JustJoin's; LinkedIn's second waits its gap
  });
});
