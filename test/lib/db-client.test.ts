import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fluid compute freezes an instance between requests: lib/db/client.ts keeps each request going until
// its idle connections have closed, so a frozen instance doesn't hold the pooler's few clients.

const waitUntil = vi.hoisted(() => vi.fn<(promise: Promise<unknown>) => void>());
vi.mock('@vercel/functions', () => ({ waitUntil }));

const { db, closeDb, holdUntilIdle } = await import('@/lib/db/client');

const settled = async (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return done;
};

beforeEach(() => {
  vi.useFakeTimers();
  waitUntil.mockClear();
});
afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await closeDb();
});

describe('holdUntilIdle', () => {
  it('keeps the request going until the connections are idle long enough to close (5 s + 10 s for the query)', async () => {
    holdUntilIdle();
    const [held] = waitUntil.mock.calls[0];
    await vi.advanceTimersByTimeAsync(14_900);
    expect(await settled(held)).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await settled(held)).toBe(true);
  });

  it('each query starts the wait again; one wait at a time', async () => {
    holdUntilIdle();
    await vi.advanceTimersByTimeAsync(10_000);
    holdUntilIdle();
    const [first, second] = waitUntil.mock.calls.map(([promise]) => promise);
    expect(await settled(first)).toBe(true); // the newer one keeps the instance up
    await vi.advanceTimersByTimeAsync(14_900);
    expect(await settled(second)).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await settled(second)).toBe(true);
  });
});

describe('db()', () => {
  beforeEach(() => vi.stubEnv('SUPABASE_DB_URL', 'postgresql://u:p@localhost:5432/postgres'));

  it('holds each request on Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    db();
    db();
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });

  it('nowhere else (next dev, tests, scripts)', () => {
    vi.stubEnv('VERCEL', '');
    db();
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
