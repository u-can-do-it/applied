import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, OPTIONS, POST } from '@/app/api/import/route';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { isImportRequest } from '@/lib/listings/bookmarklet';
import { runAll } from '@/lib/listings/run';
import type { Scraper } from '@/lib/db/repos/scrapers';

vi.mock('@/lib/listings/bookmarklet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/listings/bookmarklet')>()),
  isImportRequest: vi.fn(),
}));
vi.mock('@/lib/listings/run', () => ({ runAll: vi.fn() }));
vi.mock('@/lib/db/repos/scrapers', () => ({ list: vi.fn() }));
vi.mock('@/lib/db/repos/scrape-settings', () => ({ get: vi.fn(() => Promise.resolve({ keywords: ['React'] })) }));
const allowed = vi.mocked(isImportRequest);
const run = vi.mocked(runAll);

const PAGE = 'https://czyjesteldorado.pl/search?tag%5B%5D=React&sort=newest';
const SUMMARY = { found: 3, kept: 2, added: 1, fresh: 1, notified: 0, notifyLater: true, errors: [], ms: 5 };
const ELDORADO = {
  id: 'e1',
  name: 'Eldorado',
  enabled: false,
  config: { url: 'https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest' },
} as Scraper;
const JUSTJOIN = { id: 'j1', name: 'Just Join', enabled: true, config: { url: 'https://justjoin.it/x' } } as Scraper;

const gzip = (value: unknown) =>
  new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();

const post = async (value: unknown) =>
  POST(new NextRequest('https://jobwatch.test/api/import', { method: 'POST', body: await gzip(value) }));

describe('/api/import', () => {
  beforeEach(() => {
    run.mockReset();
    run.mockResolvedValue(SUMMARY);
    allowed.mockResolvedValue(true);
    vi.mocked(scrapersRepo.list).mockResolvedValue([ELDORADO, JUSTJOIN]);
  });

  it('answers a preflight from any site, Authorization allowed', () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it("GET: the site's scrapers and their pages", async () => {
    const response = await GET(new NextRequest('https://jobwatch.test/api/import?host=czyjesteldorado.pl'));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ ok: true, data: { scrapers: ['Eldorado'], urls: [PAGE] } });
  });

  it("POST: runs that site's scrapers (switched off too) on the pages they read, nothing else", async () => {
    const response = await post({
      host: 'czyjesteldorado.pl',
      pages: [
        { url: PAGE, body: '<html>React</html>' },
        { url: 'https://justjoin.it/x', body: 'not asked for' },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: SUMMARY });
    expect(run).toHaveBeenCalledWith('bookmarklet', {
      background: true,
      browser: { scrapers: ['e1'], pages: new Map([[PAGE, '<html>React</html>']]) },
    });
  });

  it('refuses a site no scraper reads, and a body that is not gzipped JSON of pages', async () => {
    const elsewhere = await post({ host: 'example.com', pages: [] });
    expect(elsewhere.status).toBe(400);
    expect(await elsewhere.json()).toEqual({ ok: false, error: 'No scraper reads example.com' });
    const plain = await POST(
      new NextRequest('https://jobwatch.test/api/import', { method: 'POST', body: JSON.stringify({ host: 'x' }) }),
    );
    expect(plain.status).toBe(400);
    expect((await post({ host: 'czyjesteldorado.pl' })).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses without the key, with the CORS headers so the bookmarklet can say so', async () => {
    allowed.mockResolvedValue(false);
    for (const response of [
      await GET(new NextRequest('https://jobwatch.test/api/import?host=czyjesteldorado.pl')),
      await post({ host: 'czyjesteldorado.pl', pages: [] }),
    ]) {
      expect(response.status).toBe(401);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toEqual({ ok: false, error: 'Wrong or missing token' });
    }
    expect(run).not.toHaveBeenCalled();
  });
});
