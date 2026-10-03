import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { runAll } from '@/lib/listings/run';
import { saveProfile } from '@/lib/profiles';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { describeDb, exec } from './database';

// The whole scrape run (lib/listings/run.ts) against the database, with `fetch` stubbed: the board
// pages, Telegram and OpenAI are answered here, anything else fails the test. No network.

type Listing = { ref: string; name: string; at: string; mode?: string };

const BOARD = 'https://board.test';
const TELEGRAM = 'https://telegram.test';
const OPENAI = 'https://openai.test/v1';

let pages: Record<string, Listing[] | 'down'> = {};
const sent: string[] = [];
let telegramDown = false;

const fakeFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(`${TELEGRAM}/`)) {
    if (telegramDown) return Promise.resolve(Response.json({ ok: false }, { status: 500 }));
    if (url.endsWith('/sendMessage')) sent.push((JSON.parse(init?.body as string) as { text: string }).text);
    return Promise.resolve(Response.json({ ok: true, result: {} }));
  }
  if (url.startsWith(`${OPENAI}/`)) return Promise.resolve(new Response('overloaded', { status: 500 }));
  const path = url.startsWith(BOARD) ? new URL(url).pathname : null;
  const page = path === null ? undefined : pages[path];
  if (page === undefined) return Promise.reject(new Error(`unexpected request: ${url}`));
  if (page === 'down') return Promise.resolve(new Response('down', { status: 500 }));
  return Promise.resolve(Response.json({ offers: page }));
});

const search = (name: string, path: string, position: number) =>
  scrapersRepo.insert({
    name,
    src: 'board',
    kind: 'json',
    enabled: true,
    position,
    config: {
      url: `${BOARD}${path}`,
      checkKeyword: true,
      items: 'offers',
      fields: { id: 'ref', title: 'name', url: '/job/{ref}', date: 'at', remote: 'mode' },
    },
  });

const listing = (ref: string, name: string, day: number, mode = 'office'): Listing => ({
  ref,
  name,
  mode,
  at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`,
});

describeDb('a scrape run (runAll)', () => {
  beforeEach(() => {
    sent.length = 0;
    telegramDown = false;
    fakeFetch.mockClear();
    vi.stubGlobal('fetch', fakeFetch);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '42');
    vi.stubEnv('TELEGRAM_API_URL', TELEGRAM);
    vi.stubEnv('OPENAI_API_KEY', ''); // the AI filter is on in the settings, but can't work: everything is sent
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('saves on the first run, announces only what is new after it, and records every outcome', async () => {
    await settingsRepo.save({ ...DEFAULT_SETTINGS, keywords: ['React'], mute: ['java'] });
    const city = await search('Warszawa', '/warszawa', 1);
    const remote = await search('Remote', '/remote', 2);
    const broken = await search('Broken', '/broken', 3);
    pages = {
      '/warszawa': [listing('1', 'React Developer', 1), listing('2', 'Python Developer', 2)],
      // the same offer, and this search says it's remote
      '/remote': [listing('1', 'React Developer', 1, 'Remote'), listing('3', 'Senior React Engineer', 3)],
      '/broken': 'down',
    };

    // first run: every scraper's first, so it only saves
    const first = await runAll('manual');
    expect(first).toMatchObject({ found: 4, kept: 2, added: 2, fresh: 0, notified: 0 });
    expect(first.errors).toEqual([{ scraper: 'Broken', error: 'HTTP 500' }]);
    expect(sent).toEqual([]);
    expect(await queueRepo.size()).toBe(0);
    expect(await scrapersRepo.get(city)).toMatchObject({ lastStatus: 'ok', lastFound: 2, lastKept: 1, lastNew: 1 });
    expect(await scrapersRepo.get(remote)).toMatchObject({ lastStatus: 'ok', lastFound: 2, lastKept: 2, lastNew: 1 });
    // the newest offer on the page, kept or not
    expect((await scrapersRepo.get(city))?.mark).toBe(Date.parse('2026-09-02T10:00:00Z'));
    expect((await scrapersRepo.get(remote))?.mark).toBe(Date.parse('2026-09-03T10:00:00Z'));
    expect(await scrapersRepo.get(broken)).toMatchObject({ lastStatus: 'error', lastError: 'HTTP 500', mark: null });
    expect(await exec(sql`select id, title, remote from public.offers order by id`)).toEqual([
      { id: '1', title: 'React Developer', remote: true },
      { id: '3', title: 'Senior React Engineer', remote: false },
    ]);
    let [log] = await runsRepo.list();
    expect(log).toMatchObject({ trigger: 'manual', found: 4, kept: 2, added: 2, fresh: 0, notified: 0 });
    expect(log.finishedAt).not.toBeNull();
    expect(await stateRepo.lock(1)).toBe(true); // the run freed its lock
    await stateRepo.unlock();

    // second run: a new offer, an old one bumped up, a muted one, and one already known
    pages = {
      '/warszawa': [
        listing('1', 'React Developer', 1),
        listing('4', 'React Developer (Next.js)', 10),
        listing('5', 'Old React Developer', 1),
        listing('6', 'Java and React Developer', 11),
      ],
      '/remote': [listing('3', 'Senior React Engineer', 3)],
      '/broken': 'down',
    };
    const second = await runAll('cron');
    expect(second).toMatchObject({ found: 5, kept: 5, added: 3, fresh: 1, notified: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('React Developer (Next.js)');
    expect(sent[0]).not.toContain('Old React Developer');
    expect(await queueRepo.size()).toBe(0); // claimed and sent
    expect(await scrapersRepo.get(city)).toMatchObject({ lastNew: 3, mark: Date.parse('2026-09-11T10:00:00Z') });
    [log] = await runsRepo.list();
    expect(log).toMatchObject({ trigger: 'cron', added: 3, fresh: 1, notified: 1, matched: null });
  });

  it('does nothing while another run holds the lock', async () => {
    pages = {};
    expect(await stateRepo.lock(60)).toBe(true);
    const busy = await runAll('telegram');
    expect(busy).toMatchObject({ skipped: 'Another run is still going.', found: 0, errors: [] });
    expect(await runsRepo.list()).toEqual([]);
    expect(fakeFetch).not.toHaveBeenCalled();
    // the run that holds it is someone else's: still held
    expect(await stateRepo.lock(60)).toBe(false);
  });

  it('a database failure ends the run with the error in its log, and frees the lock', async () => {
    await search('Warszawa', '/warszawa', 1);
    pages = { '/warszawa': [listing('1', 'React Developer', 1)] };
    await exec(sql`alter function public.jw_ingest_offers(jsonb) rename to jw_ingest_offers_away`);
    try {
      const failed = await runAll('manual');
      expect(failed).toMatchObject({ found: 0, added: 0, errors: [{ scraper: 'Run' }] });
      expect(failed.errors[0].error).toMatch(/jw_ingest_offers/);
      const [log] = await runsRepo.list();
      expect(log).toMatchObject({ found: 0, errors: failed.errors });
      expect(log.finishedAt).not.toBeNull();
      expect(await stateRepo.lock(1)).toBe(true);
    } finally {
      await exec(sql`alter function public.jw_ingest_offers_away(jsonb) rename to jw_ingest_offers`);
    }
  });
  /** A first run (it only saves), then one that finds a new offer worth a message. */
  async function oneNewOffer() {
    await settingsRepo.save({ ...DEFAULT_SETTINGS, keywords: ['React'] });
    await search('Warszawa', '/warszawa', 1);
    pages = { '/warszawa': [listing('1', 'React Developer', 1)] };
    await runAll('manual');
    pages = { '/warszawa': [listing('1', 'React Developer', 1), listing('2', 'Frontend React Developer', 5)] };
  }

  it('Telegram down: the error goes into the run log, and the offer stays queued for the next send', async () => {
    await oneNewOffer();
    telegramDown = true;
    const run = await runAll('cron');
    const error = { scraper: 'AI / Telegram', error: 'Telegram sendMessage: HTTP 500' };
    expect(run).toMatchObject({ added: 1, fresh: 1, notified: 0, errors: [error] });
    const [log] = await runsRepo.list();
    expect(log).toMatchObject({ fresh: 1, notified: 0, matched: null, errors: [error] });
    expect((await queueRepo.list()).map((row) => row.id)).toEqual(['2']);
  });

  it('OpenAI down: the AI error is logged once, nothing is sent yet, the offer waits for a verdict', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('OPENAI_BASE_URL', OPENAI);
    await saveProfile({ name: 'P', prompt: 'React, remote', file: 'keep' });
    await oneNewOffer();
    const run = await runAll('cron');
    expect(run).toMatchObject({ added: 1, fresh: 1, notified: 0 });
    // the same error from the AI check and from the send's own check: logged once
    expect(run.errors).toEqual([{ scraper: 'AI', error: expect.stringMatching(/^OpenAI 500/) as unknown }]);
    const [log] = await runsRepo.list();
    expect(log).toMatchObject({ notified: 0, matched: 0, errors: run.errors });
    expect(sent).toEqual([]);
    expect(await queueRepo.size()).toBe(1);
  });
});
