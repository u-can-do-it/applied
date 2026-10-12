import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPosting } from '@/lib/ads/linkedin';
import * as alertsRepo from '@/lib/db/repos/alert-jobs';
import * as offersRepo from '@/lib/db/repos/offers';
import { seniorityOf } from '@/lib/listings/extract';
import { MAX_READS } from '@/lib/listings/pipeline/ad-check';
import { ALERTS, fetchAlerts } from '@/lib/listings/pipeline/alerts';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import type { Found } from '@/lib/listings/types';

// The jobs LinkedIn's alert emails named: each one's posting read, then the LinkedIn scrapers' filters.
// The database and LinkedIn are mocked.

vi.mock('@/lib/ads/linkedin', () => ({ readPosting: vi.fn(), readLinkedin: vi.fn() }));
vi.mock('@/lib/db/repos/alert-jobs', () => ({ waiting: vi.fn(), settle: vi.fn() }));
vi.mock('@/lib/db/repos/offers', () => ({ knownIds: vi.fn() }));

const read = vi.mocked(readPosting);
const waiting = vi.mocked(alertsRepo.waiting);
const settle = vi.mocked(alertsRepo.settle);
const known = vi.mocked(offersRepo.knownIds);

const settings = { ...DEFAULT_SETTINGS, keywords: ['React'], cities: ['warszawa'], ignore: ['php'], remoteOk: true };
const LONG = ' We build web apps for clients across Europe, in a team of twelve, with code review and CI.';
const posting = (title: string, location: string, text: string) => ({
  title,
  text: text + LONG,
  details: { company: 'Acme', location },
});
const postings = (all: Record<string, ReturnType<typeof posting>>) =>
  read.mockImplementation((id) => {
    const found = all[id] as ReturnType<typeof posting> | undefined;
    return found ? Promise.resolve(found) : Promise.reject(new Error(`unexpected posting: ${id}`));
  });
const later = () => Date.now() + 60_000;
const ids = (offers: Found[]) => offers.map((offer) => offer.id);

beforeEach(() => {
  read.mockReset();
  waiting.mockReset();
  settle.mockReset().mockResolvedValue(undefined);
  known.mockReset().mockResolvedValue(new Set());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fetchAlerts', () => {
  it('nothing waiting: nothing to add to the run', async () => {
    waiting.mockResolvedValue([]);
    expect(await fetchAlerts(settings, [], later())).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('reads each new job and keeps what the filters let through; saves what became of them when told', async () => {
    waiting.mockResolvedValue(['1', '2', '3', '4', '5', '6', '7', '8']);
    known.mockResolvedValue(new Set(['7'])); // saved before
    const scraped = [
      { src: 'linkedin', id: '8' },
      { src: 'justjoin', id: '6' },
    ] as Found[]; // 8: a scraper's, now
    postings({
      1: posting('Front End Engineer', 'Warszawa, Mazowieckie, Polska', 'Angular or React.js'), // the ad names it
      2: posting('Java Developer', 'Warszawa, Mazowieckie, Polska', 'Java 21, Spring'), // nothing names it
      3: posting('React Developer', 'Kraków, Małopolskie, Polska', 'React'), // not in the cities
      4: posting('React Developer', 'Polska', 'React'), // the whole country: remote
      5: posting('PHP / React Developer', 'Warszawa', 'React'), // an ignored title
      6: posting('Senior React Engineer (remote)', 'Gdańsk, Pomorskie, Polska', 'React'), // remote, says the title
    });

    const alerts = await fetchAlerts(settings, scraped, later());

    expect(read.mock.calls.map(([id]) => id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(alerts?.fetched.scraper).toBe(ALERTS);
    const result = alerts?.fetched.result;
    expect(ids(result?.kept ?? [])).toEqual(['1', '4', '6']);
    expect(result?.kept[0]).toEqual({
      src: 'linkedin',
      id: '1',
      title: 'Front End Engineer',
      company: 'Acme',
      seniority: seniorityOf('Front End Engineer'), // as a card's
      remote: false,
      url: 'https://www.linkedin.com/jobs/view/1',
      locations: ['Warszawa, Mazowieckie, Polska'],
      skills: [],
    });
    expect(result?.kept.map((offer) => offer.remote)).toEqual([false, true, true]);
    expect(result).toMatchObject({
      ok: true,
      error: null,
      found: 8,
      skipped: { keyword: 1, area: 1, ignored: 1 },
      complete: true,
    });

    expect(settle).not.toHaveBeenCalled(); // not before the offers are saved
    await alerts?.settle();
    expect(settle).toHaveBeenCalledWith(
      'linkedin',
      new Map([
        ['7', 'known'],
        ['8', 'known'],
        ['1', 'kept'],
        ['2', 'skipped'],
        ['3', 'skipped'],
        ['4', 'kept'],
        ['5', 'skipped'],
        ['6', 'kept'],
      ]),
    );
  });

  it('stops at a posting that fails or comes back empty, and past MAX_READS: the rest wait', async () => {
    waiting.mockResolvedValue(['1', '2', '3']);
    read
      .mockResolvedValueOnce(posting('React Developer', 'Warszawa', 'React'))
      .mockRejectedValueOnce(new Error('HTTP 429'));
    let alerts = await fetchAlerts(settings, [], later());
    expect(read).toHaveBeenCalledTimes(2);
    expect(alerts?.fetched.result).toMatchObject({
      ok: true,
      found: 1,
      complete: false,
      error: 'reading the jobs: job 2: HTTP 429; 2 wait for the next run',
    });
    await alerts?.settle();
    expect(settle).toHaveBeenLastCalledWith('linkedin', new Map([['1', 'kept']]));

    read.mockReset().mockResolvedValue({ title: '', text: '', details: {} });
    alerts = await fetchAlerts(settings, [], later());
    expect(alerts?.fetched.result.error).toBe(
      'reading the jobs: job 1: it came back empty (a login wall?); 3 wait for the next run',
    );

    waiting.mockResolvedValue(Array.from({ length: MAX_READS + 2 }, (_, i) => String(i + 1)));
    read.mockReset().mockResolvedValue(posting('React Developer', 'Warszawa', 'React'));
    alerts = await fetchAlerts(settings, [], later());
    expect(read).toHaveBeenCalledTimes(MAX_READS);
    expect(alerts?.fetched.result).toMatchObject({ found: MAX_READS, error: null, complete: false });
  });

  it('starts no read past the deadline', async () => {
    waiting.mockResolvedValue(['1', '2']);
    read.mockResolvedValue(posting('React Developer', 'Warszawa', 'React'));
    const alerts = await fetchAlerts(settings, [], Date.now() - 1);
    expect(read).not.toHaveBeenCalled();
    expect(alerts?.fetched.result).toMatchObject({ found: 0, kept: [], complete: false, error: null });
  });

  it('the database failing: the run says so, nothing is read or settled', async () => {
    waiting.mockRejectedValue(new Error('connection refused'));
    const alerts = await fetchAlerts(settings, [], later());
    expect(alerts?.fetched.result).toMatchObject({ ok: false, error: 'connection refused', found: 0 });
    await alerts?.settle();
    expect(settle).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
