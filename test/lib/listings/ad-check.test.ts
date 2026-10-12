import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrapeOfferFull, type Scraped } from '@/lib/ads';
import { linkedin } from '@/lib/boards/linkedin';
import { AD_CHECK_MS } from '@/lib/budgets';
import * as missesRepo from '@/lib/db/repos/keyword-misses';
import * as offersRepo from '@/lib/db/repos/offers';
import { keywordsKey, MAX_READS } from '@/lib/listings/pipeline/ad-check';
import { scrape } from '@/lib/listings/pipeline/fetch';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';

// scrape() on LinkedIn, whose cards have no skills: a title without a keyword has its ad read for one,
// once; its search looks back to an hour before the last complete run ({since}) and stops at a short page.
// `fetch` answers the search pages; the ads and the database are mocked. No network.

vi.mock('@/lib/ads', () => ({ scrapeOfferFull: vi.fn() }));
vi.mock('@/lib/db/repos/offers', () => ({ knownIds: vi.fn() }));
vi.mock('@/lib/db/repos/keyword-misses', () => ({ find: vi.fn(), save: vi.fn() }));

const readAd = vi.mocked(scrapeOfferFull);
const known = vi.mocked(offersRepo.knownIds);
const missedBefore = vi.mocked(missesRepo.find);
const remember = vi.mocked(missesRepo.save);

const settings = { ...DEFAULT_SETTINGS, keywords: ['React'], cities: ['warszawa'], ignore: ['php'] };
const scraper = (extra: { lastCompleteAt?: string | null; checkKeyword?: boolean } = {}) => ({
  kind: 'linkedin' as const,
  src: 'linkedin',
  config: { ...linkedin.listing.defaults, checkKeyword: extra.checkKeyword ?? true },
  lastCompleteAt: extra.lastCompleteAt ?? null,
});

type Card = { id: string; title: string; place?: string };
const card = ({ id, title, place = 'Warszawa, Mazowieckie, Poland' }: Card) =>
  `<li><div class="base-card base-search-card" data-entity-urn="urn:li:jobPosting:${id}">` +
  `<h3 class="base-search-card__title">${title}</h3><h4 class="base-search-card__subtitle">Acme</h4>` +
  `<span class="job-search-card__location">${place}</span></div></li>`;
const many = (count: number, from: number): Card[] =>
  Array.from({ length: count }, (_, i) => ({ id: String(from + i), title: `React Developer ${from + i}` }));

/** The search's pages by keyword, then by start (0, 10, …); past them, LinkedIn's bare "no results". */
let search: Partial<Record<string, Card[][]>> = {};
const requested: string[] = [];

const ad = (text: string): Scraped => ({ status: 'ok', text, details: {} });
const ads = (texts: Partial<Record<string, string>>) =>
  readAd.mockImplementation(({ id }) => {
    const text = texts[id];
    return text === undefined ? Promise.reject(new Error(`unexpected ad: ${id}`)) : Promise.resolve(ad(text));
  });

beforeEach(() => {
  search = {};
  requested.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = new URL(String(input));
      requested.push(url.href);
      const pages = search[url.searchParams.get('keywords') ?? ''] ?? [];
      const page = pages.at(Number(url.searchParams.get('start')) / 10);
      return Promise.resolve(new Response(page ? page.map(card).join('') : '<!DOCTYPE html><!---->'));
    }),
  );
  readAd.mockReset();
  known.mockReset().mockResolvedValue(new Set());
  missedBefore.mockReset().mockResolvedValue(new Set());
  remember.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ids = (offers: { id: string }[]) => offers.map((offer) => offer.id);

describe('the keyword check of the ads', () => {
  it('keeps a title without a keyword when its ad names one; reads each ad once', async () => {
    search.React = [
      [
        { id: '1', title: 'Senior React Developer' }, // the title names it: no ad read
        { id: '2', title: 'Front End Engineer' }, // the ad names it
        { id: '3', title: 'Java Developer' }, // the ad doesn't
        { id: '4', title: 'PHP Developer' }, // an ignored title: no ad read
        { id: '5', title: 'Frontend Developer', place: 'Kraków, Małopolskie, Poland' }, // not in the cities
        { id: '6', title: 'Software Engineer' }, // kept before (in offers): no ad read
        { id: '7', title: 'Data Engineer' }, // its ad named none before: not read again
      ],
    ];
    known.mockResolvedValue(new Set(['6']));
    missedBefore.mockResolvedValue(new Set(['7']));
    ads({ 2: 'Frontend in modern frameworks (e.g. React.js, Angular)', 3: 'Java 21, Spring Boot, Kafka' });

    const result = await scrape(scraper(), settings);

    expect(ids(result.kept)).toEqual(['1', '2', '6']);
    expect(readAd.mock.calls.map(([offer]) => offer.id)).toEqual(['2', '3']);
    expect(known).toHaveBeenCalledWith('linkedin', ['2', '3', '6', '7']);
    expect(missedBefore).toHaveBeenCalledWith('linkedin', ['2', '3', '6', '7'], 'react');
    expect(remember).toHaveBeenCalledWith('linkedin', ['3'], 'react');
    expect(result.skipped).toEqual({ keyword: 2, area: 1, ignored: 1 });
    expect(result.ads).toEqual({ read: 2, kept: 2, left: 0 });
    expect(result.pages.map((page) => [page.total, page.kept])).toEqual([[7, 3]]);
    expect(result).toMatchObject({ ok: true, error: null, found: 7, complete: true });
    expect(requested).toHaveLength(1); // 7 of 10: the last page
  });

  it('stops at an ad that fails or comes back empty: the rest wait, and the run is not complete', async () => {
    search.React = [
      [
        { id: '1', title: 'Front End Engineer' },
        { id: '2', title: 'Backend Engineer' },
        { id: '3', title: 'Fullstack Engineer' },
      ],
    ];
    readAd.mockResolvedValueOnce(ad('We build with React and TypeScript')).mockRejectedValueOnce(new Error('HTTP 429'));

    const result = await scrape(scraper(), settings);

    expect(ids(result.kept)).toEqual(['1']);
    expect(readAd).toHaveBeenCalledTimes(2);
    expect(remember).toHaveBeenCalledWith('linkedin', [], 'react');
    expect(result.ads).toEqual({ read: 1, kept: 1, left: 2 });
    expect(result).toMatchObject({
      ok: true,
      complete: false,
      error: 'reading the ads for the keywords: "Backend Engineer": HTTP 429; 2 left for the next run',
    });

    readAd.mockReset().mockResolvedValue({ status: 'empty', text: '', details: {} });
    const empty = await scrape(scraper(), settings);
    expect(readAd).toHaveBeenCalledTimes(1);
    expect(empty.error).toBe(
      'reading the ads for the keywords: "Front End Engineer": it came back empty (a login wall?); 3 left for the next run',
    );
    expect(empty.complete).toBe(false);
  });

  it('starts no read past its time: the rest wait for the next run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    search.React = [
      [
        { id: '1', title: 'Front End Engineer' },
        { id: '2', title: 'Backend Engineer' },
      ],
    ];
    readAd.mockImplementation(() => {
      vi.setSystemTime(Date.now() + AD_CHECK_MS);
      return Promise.resolve(ad('Java 21, Spring Boot, Kafka'));
    });

    const result = await scrape(scraper(), settings);

    expect(readAd).toHaveBeenCalledTimes(1);
    expect(result.ads).toEqual({ read: 1, kept: 0, left: 1 });
    expect(result).toMatchObject({ error: null, complete: false });
    expect(remember).toHaveBeenCalledWith('linkedin', ['1'], 'react');
  });

  it('reads at most MAX_READS a run: the rest wait for the next', async () => {
    search.React = [
      Array.from({ length: MAX_READS + 3 }, (_, i) => ({ id: String(i + 1), title: `Software Engineer ${i + 1}` })),
    ];
    readAd.mockResolvedValue(ad('Node.js, AWS'));

    const result = await scrape(scraper(), settings);

    expect(readAd).toHaveBeenCalledTimes(MAX_READS);
    expect(result.ads).toEqual({ read: MAX_READS, kept: 0, left: 3 });
    expect(result).toMatchObject({ error: null, complete: false });
    expect(remember.mock.calls[0][1]).toHaveLength(MAX_READS);
  });

  it("the database failing drops the ad's offers this time, the run says so and isn't complete", async () => {
    search.React = [
      [
        { id: '1', title: 'React Developer' },
        { id: '2', title: 'Front End Engineer' },
      ],
    ];
    known.mockRejectedValue(new Error('connection refused'));

    const result = await scrape(scraper(), settings);

    expect(ids(result.kept)).toEqual(['1']);
    expect(readAd).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      complete: false,
      error: 'reading the ads for the keywords: connection refused; 1 left for the next run',
    });
  });

  it('reads no ad without the keyword check, nor for a title that names a keyword', async () => {
    search.React = [[{ id: '1', title: 'Front End Engineer' }]];
    const unchecked = await scrape(scraper({ checkKeyword: false }), settings);
    expect(ids(unchecked.kept)).toEqual(['1']);
    expect(unchecked.ads).toBeUndefined();

    search.React = [[{ id: '1', title: 'React Developer' }]];
    const named = await scrape(scraper(), settings);
    expect(ids(named.kept)).toEqual(['1']);
    expect(named.ads).toBeUndefined();
    expect(readAd).not.toHaveBeenCalled();
    expect(known).not.toHaveBeenCalled();
  });

  it('keeps misses per keyword set, folded and sorted', () => {
    expect(keywordsKey([' React ', 'Angular', 'react', ''])).toBe('angular\nreact');
  });
});

describe('the search', () => {
  it('looks back to an hour before the last complete run; without one, an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-12T07:00:00Z'));
    search.React = [[]];
    await scrape(scraper({ lastCompleteAt: '2026-10-11T21:50:00Z' }), settings);
    await scrape(scraper(), settings);
    expect(requested.map((url) => new URL(url).searchParams.get('f_TPR'))).toEqual(['r36600', 'r3600']);
  });

  it('follows full pages, and a short one is the last (each keyword its own)', async () => {
    search.React = [many(10, 100), many(3, 200)];
    search.Angular = [many(10, 300), many(10, 400), []];
    const result = await scrape(scraper(), { ...settings, keywords: ['React', 'Angular'] });
    expect(
      requested.map((url) => [new URL(url).searchParams.get('keywords'), new URL(url).searchParams.get('start')]),
    ).toEqual([
      ['React', '0'],
      ['React', '10'],
      ['Angular', '0'],
      ['Angular', '10'],
      ['Angular', '20'],
    ]);
    expect(result.found).toBe(33);
    expect(result.complete).toBe(true);
  });
});
