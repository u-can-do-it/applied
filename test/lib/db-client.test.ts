import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fluid compute freezes an instance between requests: lib/db/client.ts keeps each request going until
// its idle connections have closed, so a frozen instance doesn't hold the pooler's few clients.

const waitUntil = vi.hoisted(() => vi.fn<(promise: Promise<unknown>) => void>());
vi.mock('@vercel/functions', () => ({ waitUntil }));

const { db, closeDb, holdUntilIdle, retryWhenPoolFull } = await import('@/lib/db/client');

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

// The pooler takes 15 clients: when several instances have them all for a moment, it turns a new
// connection away, and the query is sent again a little later instead of failing the page.
describe('retryWhenPoolFull', () => {
  const full = () =>
    new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15');

  it('sends the query again while the pooler is full', async () => {
    const query = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(full())
      .mockRejectedValueOnce(full())
      .mockResolvedValue('rows');
    const result = retryWhenPoolFull(query);
    await vi.advanceTimersByTimeAsync(750);
    await expect(result).resolves.toBe('rows');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('gives up after about 8 s with the pooler’s error', async () => {
    const query = vi.fn<() => Promise<string>>().mockRejectedValue(full());
    const result = retryWhenPoolFull(query);
    const failed = expect(result).rejects.toThrow('EMAXCONNSESSION');
    await vi.advanceTimersByTimeAsync(7_750);
    await failed;
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('any other error at once', async () => {
    const query = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('relation "offers" does not exist'));
    await expect(retryWhenPoolFull(query)).rejects.toThrow('does not exist');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
