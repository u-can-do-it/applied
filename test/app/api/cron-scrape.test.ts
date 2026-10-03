import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/scrape/route';
import { continueWaitingRuns } from '@/lib/ai/runs';
import { SLICE_MS } from '@/lib/budgets';
import { lock } from '@/lib/db/repos/scrape-state';
import { runAll } from '@/lib/listings/run';
import { checkDue, isCronRequest } from '@/lib/listings/schedule';

// The cron's call: the scrape (if due), then the AI runs nobody works on, both after the answer.

const afterAnswer: (() => unknown)[] = [];
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => {
    afterAnswer.push(task);
  },
}));
vi.mock('@/lib/listings/run', () => ({ runAll: vi.fn() }));
vi.mock('@/lib/listings/schedule', () => ({ checkDue: vi.fn(), isCronRequest: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-state', () => ({ lock: vi.fn() }));
vi.mock('@/lib/ai/runs', () => ({ continueWaitingRuns: vi.fn() }));

const order: string[] = [];
const SUMMARY = { found: 1, kept: 1, added: 0, fresh: 0, notified: 0, errors: [], ms: 5 };
const call = () => GET(new NextRequest('https://jobwatch.test/api/cron/scrape'));
const runAfterAnswer = async () => {
  for (const task of afterAnswer.splice(0)) await task();
};

beforeEach(() => {
  vi.clearAllMocks();
  afterAnswer.length = 0;
  order.length = 0;
  vi.mocked(isCronRequest).mockResolvedValue(true);
  vi.mocked(checkDue).mockResolvedValue({ due: true });
  vi.mocked(lock).mockResolvedValue(true);
  vi.mocked(runAll).mockImplementation(() => {
    order.push('scrape');
    return Promise.resolve(SUMMARY);
  });
  vi.mocked(continueWaitingRuns).mockImplementation(() => {
    order.push('ai runs');
    return Promise.resolve(1);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('/api/cron/scrape', () => {
  it('answers at once; the scrape, then the AI runs, go on after the answer', async () => {
    const before = Date.now();
    const response = await call();
    expect(response.status).toBe(202);
    expect(order).toEqual([]);
    await runAfterAnswer();
    expect(order).toEqual(['scrape', 'ai runs']);
    // the AI runs get what's left of this call's time, counted from its start
    const [deadline] = vi.mocked(continueWaitingRuns).mock.calls[0];
    expect(deadline).toBeGreaterThanOrEqual(before + SLICE_MS);
    expect(deadline).toBeLessThanOrEqual(Date.now() + SLICE_MS);
  });

  it('continues the AI runs when no scrape is due, or another is going', async () => {
    vi.mocked(checkDue).mockResolvedValue({ due: false, reason: 'scraping is paused in Settings' });
    expect(await (await call()).json()).toEqual({ jobwatch: 'skipped', reason: 'scraping is paused in Settings' });
    await runAfterAnswer();
    expect(order).toEqual(['ai runs']);

    vi.mocked(checkDue).mockResolvedValue({ due: true });
    vi.mocked(lock).mockResolvedValue(false);
    expect(await (await call()).json()).toMatchObject({ jobwatch: 'busy' });
    await runAfterAnswer();
    expect(order).toEqual(['ai runs', 'ai runs']);
  });

  it('a failed scrape still lets the AI runs go on, and is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runAll).mockRejectedValue(new Error('connect ECONNREFUSED'));
    await call();
    await runAfterAnswer();
    expect(continueWaitingRuns).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logged.mock.calls[0][0] as string)).toMatchObject({
      level: 'error',
      route: '/api/cron/scrape',
      error: 'connect ECONNREFUSED',
    });
  });

  it('?wait=1 answers with the run, the AI runs after', async () => {
    const response = await GET(new NextRequest('https://jobwatch.test/api/cron/scrape?wait=1'));
    expect(await response.json()).toEqual({ jobwatch: 'done', ...SUMMARY });
    expect(order).toEqual(['scrape']);
    await runAfterAnswer();
    expect(order).toEqual(['scrape', 'ai runs']);
  });

  it('refuses a call without the secret, and does nothing', async () => {
    vi.mocked(isCronRequest).mockResolvedValue(false);
    expect((await call()).status).toBe(401);
    expect(afterAnswer).toEqual([]);
    expect(checkDue).not.toHaveBeenCalled();
  });
});
