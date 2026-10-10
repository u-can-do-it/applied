import { describe, expect, it } from 'vitest';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { newJobs, selectAnnouncable } from '@/lib/listings/pipeline/announce';
import type { ScrapeResult } from '@/lib/listings/pipeline/fetch';
import { offerKey, toNewOffer, type AddedOffer, type Fetched } from '@/lib/listings/pipeline/model';
import { addedPerScraper, runErrors, scraperOutcomes, summarize } from '@/lib/listings/pipeline/outcomes';
import { pickOwners } from '@/lib/listings/pipeline/owners';
import type { Found } from '@/lib/listings/types';

// The scrape pipeline's pure steps, without a database or a network.

const scraper = (id: string, extra: Partial<Scraper> = {}): Scraper =>
  ({
    id,
    name: `Scraper ${id}`,
    src: 'justjoin',
    kind: 'justjoin',
    enabled: true,
    config: {},
    mark: 100,
    ...extra,
  }) as Scraper;

const offer = (id: string, extra: Partial<Found> = {}): Found => ({
  src: 'justjoin',
  id,
  title: `React Developer ${id}`,
  company: 'Acme',
  seniority: null,
  remote: false,
  url: `https://justjoin.it/${id}`,
  locations: ['Warszawa'],
  skills: [],
  sort: 200,
  ...extra,
});

const result = (kept: Found[], extra: Partial<ScrapeResult> = {}): ScrapeResult => ({
  ok: true,
  error: null,
  found: kept.length,
  kept,
  skipped: { keyword: 0, area: 0, ignored: 0 },
  pages: [],
  proxied: 0,
  ms: 5,
  ...extra,
});

const added = (id: string, titleKey: string, seenBefore = false, src = 'justjoin'): AddedOffer => ({
  src,
  id,
  titleKey,
  seenBefore,
});

const settings = { mute: ['java'], cities: ['warszaw'] };

describe('pickOwners', () => {
  it('the first scraper that found an offer owns it', () => {
    const first = scraper('s1');
    const second = scraper('s2');
    const owners = pickOwners([
      { scraper: first, result: result([offer('a'), offer('b')]) },
      { scraper: second, result: result([offer('b'), offer('c')]) },
    ]);
    expect([...owners.keys()]).toEqual(['justjoin\na', 'justjoin\nb', 'justjoin\nc']);
    expect(owners.get('justjoin\nb')?.scraper).toBe(first);
    expect(owners.get('justjoin\nc')?.scraper).toBe(second);
  });

  it('an offer is remote if any search says so, and keeps its first owner', () => {
    const first = scraper('s1');
    const owners = pickOwners([
      { scraper: first, result: result([offer('a')]) },
      { scraper: scraper('s2'), result: result([offer('a', { remote: true, title: 'Other' })]) },
      { scraper: scraper('s3'), result: result([offer('a', { remote: false })]) },
    ]);
    expect(owners.get('justjoin\na')).toEqual({ scraper: first, offer: { ...offer('a'), remote: true } });
  });

  it('the same id on two boards is two offers', () => {
    const owners = pickOwners([
      { scraper: scraper('s1'), result: result([offer('a'), offer('a', { src: 'nofluff' })]) },
    ]);
    expect(owners.size).toBe(2);
  });
});

describe('selectAnnouncable', () => {
  const owned = (fetched: Fetched[]) => pickOwners(fetched);

  it('queues a new job once, with its place, and the database row', () => {
    const owners = owned([{ scraper: scraper('s1'), result: result([offer('a'), offer('b')]) }]);
    const fresh = selectAnnouncable([added('a', 'job-1'), added('b', 'job-1')], owners, settings);
    expect(fresh).toEqual([{ ...toNewOffer(offer('a')), location: 'Warszawa', jobId: 'job-1' }]);
  });

  it("skips a scraper's first run, an old offer bumped up, a known job and a muted title", () => {
    const owners = owned([
      { scraper: scraper('first', { mark: null }), result: result([offer('new-scraper')]) },
      {
        scraper: scraper('s1', { mark: 100 }),
        result: result([
          offer('bumped', { sort: 100 }),
          offer('known'),
          offer('muted', { title: 'Java Developer' }),
          offer('undated', { sort: undefined }),
          offer('fine', { sort: 101 }),
        ]),
      },
    ]);
    const fresh = selectAnnouncable(
      [
        added('new-scraper', 'j1'),
        added('bumped', 'j2'),
        added('known', 'j3', true),
        added('muted', 'j4'),
        added('undated', 'j5'),
        added('fine', 'j6'),
        added('nobody', 'j7'), // not found in this run (can't happen, but no owner: no message)
      ],
      owners,
      settings,
    );
    expect(fresh.map((row) => row.id)).toEqual(['undated', 'fine']);
  });
});

describe('newJobs', () => {
  it('every new job once, including the ones not announced; never a known one', () => {
    expect(newJobs([added('a', 'j1'), added('b', 'j1'), added('c', 'j2', true), added('d', 'j3')])).toEqual([
      'j1',
      'j3',
    ]);
  });
});

describe('outcomes', () => {
  const ok = scraper('ok', { mark: 100 });
  const failing = scraper('failing', { mark: 50 });
  const fresh = scraper('fresh', { mark: null });
  const fetched: Fetched[] = [
    { scraper: ok, result: result([offer('a'), offer('b')], { found: 7, maxSort: 300, error: 'page 2: HTTP 500' }) },
    { scraper: failing, result: result([], { ok: false, error: 'HTTP 403', maxSort: 999 }) },
    { scraper: fresh, result: result([offer('c', { src: 'nofluff' })], { maxSort: undefined }) },
  ];
  const owners = pickOwners(fetched);
  const rows = [added('a', 'j1'), added('c', 'j2', false, 'nofluff')];

  it('counts the new offers per owning scraper', () => {
    expect(addedPerScraper(rows, owners)).toEqual(
      new Map([
        ['ok', 1],
        ['fresh', 1],
      ]),
    );
  });

  it('moves the watermark only on success; a first run marks "has run" with 0', () => {
    expect(scraperOutcomes(fetched, addedPerScraper(rows, owners))).toEqual([
      {
        id: 'ok',
        outcome: { ok: true, found: 7, kept: 2, added: 1, error: 'page 2: HTTP 500', ms: 5, proxied: 0, mark: 300 },
      },
      { id: 'failing', outcome: { ok: false, found: 0, kept: 0, added: 0, error: 'HTTP 403', ms: 5, proxied: 0, mark: 50 } },
      { id: 'fresh', outcome: { ok: true, found: 1, kept: 1, added: 1, error: null, ms: 5, proxied: 0, mark: 0 } },
    ]);
    // a newer watermark than what the pages had stays
    expect(scraperOutcomes([{ scraper: ok, result: result([], { maxSort: 10 }) }], new Map())[0].outcome.mark).toBe(
      100,
    );
  });

  it('sums up the run, with the failed scrapers as errors', () => {
    expect(runErrors(fetched)).toEqual([
      { scraper: 'Scraper ok', error: 'page 2: HTTP 500' },
      { scraper: 'Scraper failing', error: 'HTTP 403' },
    ]);
    const fresh = [{ ...toNewOffer(offer('a')), location: null, jobId: 'j1' }];
    expect(summarize({ fetched, owners, added: rows, fresh, ms: 42 })).toEqual({
      found: 8,
      kept: 3,
      added: 2,
      fresh: 1,
      notified: 0,
      errors: runErrors(fetched),
      ms: 42,
    });
  });
});

describe('toNewOffer', () => {
  it('trims, drops NUL characters and fills a missing title', () => {
    expect(
      toNewOffer(
        offer(' a\u0000 ', { title: ' \u0000 ', company: ' ', seniority: ' Senior ', url: ' https://x.test/a ' }),
      ),
    ).toEqual({
      src: 'justjoin',
      id: 'a',
      title: '(no title)',
      company: null,
      seniority: 'Senior',
      remote: false,
      url: 'https://x.test/a',
    });
    expect(offerKey({ src: 'a', id: 'b' })).toBe('a\nb');
  });
});
