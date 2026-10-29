import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/ad-texts/route';
import { listAdTexts } from '@/lib/applications';
import { isValidToken } from '@/server/auth';

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => ({ value: 'token' }) }) }));
vi.mock('@/server/auth', () => ({ AUTH_COOKIE: 'auth', isValidToken: vi.fn() }));
vi.mock('@/lib/applications', () => ({ listAdTexts: vi.fn() }));
const texts = vi.mocked(listAdTexts);
const loggedIn = vi.mocked(isValidToken);

describe('GET /api/ad-texts', () => {
  beforeEach(() => {
    texts.mockReset();
    texts.mockResolvedValue([{ jobId: 'acme|dev', content: 'We use Go.' }]);
    loggedIn.mockResolvedValue(true);
  });

  it('every application’s ad text, never cached', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ texts: [{ jobId: 'acme|dev', content: 'We use Go.' }] });
  });

  it('only with the login cookie', async () => {
    loggedIn.mockResolvedValue(false);
    expect((await GET()).status).toBe(401);
    expect(texts).not.toHaveBeenCalled();
  });
});
