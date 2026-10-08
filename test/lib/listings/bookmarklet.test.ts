import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { blockedPage, bookmarklet, importPlan, importToken, isImportRequest } from '@/lib/listings/bookmarklet';
import { scrape } from '@/lib/listings/pipeline/fetch';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';

// The bookmarklet: which pages it fetches, its key, the script itself (run against a stand-in page), and a
// scraper run on the pages it sends.

const ELDORADO = 'https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest';
/** ELDORADO's page for "React" */
const PAGE = 'https://czyjesteldorado.pl/search?tag%5B%5D=React&sort=newest';
const fixture = readFileSync(new URL('../../fixtures/eldorado.html', import.meta.url), 'utf8');

const scraper = (id: string, url: string, extra: Partial<Scraper> = {}) =>
  ({
    id,
    name: `Scraper ${id}`,
    src: 'eldorado',
    kind: 'eldorado',
    enabled: true,
    config: { url },
    ...extra,
  }) as Scraper;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('importPlan', () => {
  it("takes the scrapers whose pages are on the site, switched on or not, each keyword's page once", () => {
    const plan = importPlan(
      [
        scraper('a', ELDORADO),
        scraper('b', ELDORADO, { enabled: false }),
        scraper('c', 'https://justjoin.it/api/offers?q={keyword}'),
        scraper('d', 'https://czyjesteldorado.pl/search?q={keywords}'),
      ],
      { keywords: ['React', 'Node.js'] },
      'czyjesteldorado.pl',
    );
    expect(plan.scrapers.map((chosen) => chosen.id)).toEqual(['a', 'b', 'd']);
    expect(plan.urls).toEqual([
      'https://czyjesteldorado.pl/search?tag%5B%5D=React&sort=newest',
      'https://czyjesteldorado.pl/search?tag%5B%5D=Node.js&sort=newest',
      'https://czyjesteldorado.pl/search?q=React%20Node.js',
    ]);
  });

  it('leaves out a scraper whose link needs keywords there are none of, and another site', () => {
    expect(importPlan([scraper('a', ELDORADO)], { keywords: [] }, 'czyjesteldorado.pl').scrapers).toEqual([]);
    expect(importPlan([scraper('a', ELDORADO)], { keywords: ['React'] }, 'www.czyjesteldorado.pl').urls).toEqual([]);
  });

  it("leaves out an ATS's scraper: its careers page is on the site, but it reads the ATS's API", () => {
    const gitlab = scraper('a', 'https://job-boards.greenhouse.io/gitlab', { kind: 'ats', src: 'greenhouse' });
    expect(importPlan([gitlab], { keywords: ['React'] }, 'job-boards.greenhouse.io')).toEqual({
      scrapers: [],
      urls: [],
    });
  });
});

describe('blockedPage', () => {
  const refused = {
    scraper: 'Scraper c',
    error: 'React: HTTP 403, message: Just a moment... (the site blocks this server?)',
  };

  it('is the first page of the first scraper the latest scheduled run got a 403 from', () => {
    const blocked = blockedPage(
      [scraper('a', 'https://justjoin.it/x'), scraper('b', 'https://nofluffjobs.com/x'), scraper('c', ELDORADO)],
      { keywords: ['React', 'Node.js'] },
      [{ scraper: 'Scraper b', error: 'HTTP 503 Service Unavailable' }, refused],
    );
    expect(blocked).toBe(PAGE);
  });

  it('is none when that run got no 403', () => {
    const scrapers = [scraper('c', ELDORADO)];
    expect(blockedPage(scrapers, { keywords: ['React'] }, [])).toBeNull();
    expect(blockedPage(scrapers, { keywords: ['React'] }, [{ scraper: 'Scraper c', error: 'HTTP 4030' }])).toBeNull();
  });
});

describe('the key', () => {
  const asking = (authorization?: string) =>
    new Request('https://jobwatch.test/api/import', { headers: authorization ? { authorization } : {} });

  it('is derived from APP_PASSWORD, and only it lets a request through', async () => {
    vi.stubEnv('APP_PASSWORD', 'secret');
    const token = await importToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await isImportRequest(asking(`Bearer ${token}`))).toBe(true);
    expect(await isImportRequest(asking('Bearer nope'))).toBe(false);
    expect(await isImportRequest(asking())).toBe(false);
  });

  it('without APP_PASSWORD: none, and only a dev server lets it through', async () => {
    vi.stubEnv('APP_PASSWORD', '');
    expect(await importToken()).toBeNull();
    expect(await isImportRequest(asking())).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(await isImportRequest(asking())).toBe(false);
  });
});

describe('the script', () => {
  /** Runs the bookmark's script on a stand-in Eldorado page, its fetch answering like the app and the board. */
  async function click(
    answers: { plan: unknown; run: unknown; page?: Response },
    at: { host: string; origin: string; assign?: (url: string) => void } = {
      host: 'czyjesteldorado.pl',
      origin: 'https://czyjesteldorado.pl',
    },
  ) {
    const box = { style: {}, textContent: '', remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => box, body: { append: vi.fn() } });
    vi.stubGlobal('location', at);
    vi.stubGlobal('setTimeout', vi.fn());
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) =>
      Promise.resolve(
        url.startsWith('https://jobwatch.test/api/import?')
          ? Response.json(answers.plan)
          : url === 'https://jobwatch.test/api/import'
            ? Response.json(answers.run)
            : (answers.page ?? new Response(`<html>${url}</html>`)),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const link = bookmarklet('https://jobwatch.test', 'tok"en');
    expect(link.startsWith('javascript:')).toBe(true);
    // the bookmark's code, without the `void 0` that keeps the browser from showing its answer
    const code = decodeURIComponent(link.slice('javascript:'.length)).replace(/;void 0$/, '');
    await (0, eval)(code);
    return { fetch, said: box.textContent };
  }

  it('asks which pages, fetches them as you, and sends them gzipped with the key', async () => {
    const { fetch, said } = await click({
      plan: { ok: true, data: { scrapers: ['Eldorado'], urls: [PAGE] } },
      run: { ok: true, data: { found: 12, kept: 5, added: 2, errors: [] } },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://jobwatch.test/api/import?host=czyjesteldorado.pl',
      PAGE,
      'https://jobwatch.test/api/import',
    ]);
    expect(fetch.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer tok"en' } });
    expect(fetch.mock.calls[1][1]).toEqual({ credentials: 'include' });
    const sent = fetch.mock.calls[2][1] as RequestInit;
    expect(sent.headers).toEqual({ Authorization: 'Bearer tok"en', 'Content-Type': 'application/gzip' });
    const unzipped: unknown = await new Response(
      (sent.body as Blob).stream().pipeThrough(new DecompressionStream('gzip')),
    ).json();
    expect(unzipped).toEqual({ host: 'czyjesteldorado.pl', pages: [{ url: PAGE, body: `<html>${PAGE}</html>` }] });
    expect(said).toBe('Jobwatch: 12 found, 5 kept, 2 new');
  });

  it("says what went wrong: the app's refusal, or the board's", async () => {
    expect((await click({ plan: { ok: false, error: 'Wrong or missing token' }, run: null })).said).toBe(
      'Jobwatch: failed: Wrong or missing token',
    );
    const blocked = await click({
      plan: { ok: true, data: { scrapers: ['Eldorado'], urls: [PAGE] } },
      run: null,
      page: new Response('Just a moment...', { status: 403 }),
    });
    expect(blocked.said).toBe(`Jobwatch: failed: HTTP 403 from ${PAGE}`);
    expect(blocked.fetch).toHaveBeenCalledTimes(2);
  });

  it('clicked elsewhere (on Jobwatch): opens the blocked board for the second click, or says none is', async () => {
    const assign = vi.fn();
    const jobwatch = { host: 'jobwatch.test', origin: 'https://jobwatch.test', assign };
    const away = await click({ plan: { ok: true, data: { scrapers: [], urls: [], open: PAGE } }, run: null }, jobwatch);
    expect(away.said).toBe('Jobwatch: opening czyjesteldorado.pl… click Jobwatch import again there');
    expect(assign).toHaveBeenCalledWith(PAGE);
    expect(away.fetch).toHaveBeenCalledTimes(1);
    const none = await click({ plan: { ok: true, data: { scrapers: [], urls: [], open: null } }, run: null }, jobwatch);
    expect(none.said).toBe('Jobwatch: failed: no scraper reads jobwatch.test, and no board is blocking Jobwatch now');
  });
});

describe('a scraper on the pages the browser sent', () => {
  const eldorado = { kind: 'eldorado' as const, src: 'eldorado', config: { url: ELDORADO } };
  const settings = { ...DEFAULT_SETTINGS, keywords: ['React'] };

  it('reads them instead of fetching', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await scrape(eldorado, settings, new Map([[PAGE, fixture]]));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.found).toBeGreaterThan(0);
  });

  it("fails a page it wasn't sent", async () => {
    const result = await scrape(eldorado, settings, new Map());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('React: The bookmarklet didn’t send this page');
  });
});
