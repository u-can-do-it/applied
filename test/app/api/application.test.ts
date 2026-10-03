import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/application/route';
import { getApplication } from '@/lib/applications';

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => ({ value: 'token' }) }) }));
vi.mock('@/server/auth', () => ({ AUTH_COOKIE: 'auth', isValidToken: () => Promise.resolve(true) }));
vi.mock('@/lib/applications', () => ({ getApplication: vi.fn() }));
const load = vi.mocked(getApplication);

const get = (query: string) => GET(new NextRequest(`https://jobwatch.test/api/application${query}`));

describe('GET /api/application', () => {
  beforeEach(() => {
    load.mockReset();
    load.mockResolvedValue({ jobId: 'acme|dev', title: 'Dev' } as Awaited<ReturnType<typeof getApplication>>);
  });

  it('finds the application by its job id', async () => {
    const response = await get('?jobId=acme%7Cdev');
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith('acme|dev');
  });

  it('still takes ?key=, as pages loaded before the rename send it', async () => {
    expect((await get('?key=acme%7Cdev')).status).toBe(200);
    expect(load).toHaveBeenCalledWith('acme|dev');
  });

  it('needs one of them', async () => {
    expect((await get('')).status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });
});
