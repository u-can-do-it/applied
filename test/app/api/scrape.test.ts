import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/scrape/route';
import { runAll } from '@/lib/listings/run';
import { isValidToken } from '@/server/auth';

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => ({ value: 'token' }) }) }));
vi.mock('@/server/auth', () => ({ AUTH_COOKIE: 'auth', isValidToken: vi.fn() }));
vi.mock('@/lib/listings/run', () => ({ runAll: vi.fn() }));
const loggedIn = vi.mocked(isValidToken);
const run = vi.mocked(runAll);

const SUMMARY = { found: 3, kept: 2, added: 1, fresh: 1, notified: 0, notifyLater: true, errors: [], ms: 5 };

const post = (headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' }, body?: string) =>
  POST(new NextRequest('https://jobwatch.test/api/scrape', { method: 'POST', headers, body }));

describe('POST /api/scrape', () => {
  beforeEach(() => {
    run.mockReset();
    run.mockResolvedValue(SUMMARY);
    loggedIn.mockResolvedValue(true);
  });

  it('runs every scraper now, the AI check and Telegram after the answer, and answers with the summary', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: SUMMARY });
    expect(run).toHaveBeenCalledWith('manual', { background: true });
  });

  it('runs one scraper, by its id', async () => {
    const response = await post({ 'sec-fetch-site': 'same-origin' }, JSON.stringify({ id: 'abc' }));
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith('manual', { background: true, scraper: 'abc' });
  });

  it('refuses a body without an id', async () => {
    const response = await post({ 'sec-fetch-site': 'same-origin' }, JSON.stringify({ id: '' }));
    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses without the login cookie', async () => {
    loggedIn.mockResolvedValue(false);
    const response = await post();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'Not logged in' });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers with the cause when the run fails before it starts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    run.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
  });

  describe('only from its own pages', () => {
    it.each([
      ['another site', { 'sec-fetch-site': 'cross-site' }],
      ['a sibling subdomain', { 'sec-fetch-site': 'same-site' }],
      ['no Sec-Fetch-Site, another Origin', { origin: 'https://evil.test', host: 'jobwatch.test' }],
      ['no Sec-Fetch-Site, no Origin', { host: 'jobwatch.test' }],
      ['no Sec-Fetch-Site, a malformed Origin', { origin: 'nonsense', host: 'jobwatch.test' }],
    ])('refuses %s', async (_, headers) => {
      const response = await post(headers);
      expect(response.status).toBe(403);
      expect(run).not.toHaveBeenCalled();
    });

    it.each([
      ['Sec-Fetch-Site: same-origin', { 'sec-fetch-site': 'same-origin' }],
      ['no Sec-Fetch-Site, Origin = Host', { origin: 'https://jobwatch.test', host: 'jobwatch.test' }],
      [
        'no Sec-Fetch-Site, Origin = X-Forwarded-Host',
        { origin: 'https://jobwatch.vercel.app', host: 'internal:3000', 'x-forwarded-host': 'jobwatch.vercel.app' },
      ],
    ])('accepts %s', async (_, headers) => {
      expect((await post(headers)).status).toBe(200);
    });
  });
});
