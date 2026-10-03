import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import * as queueRepo from '@/lib/db/repos/notify-queue';
import * as runsRepo from '@/lib/db/repos/scrape-runs';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { sourceOptions } from '@/lib/listings/sources';
import { describeDb, exec, ISO } from './database';

const search = (name: string, src: string) => ({
  name,
  src,
  kind: 'json' as const,
  enabled: true,
  config: { url: `https://${src}.example/api?q={keyword}`, checkKeyword: true },
});

describeDb('scrapers', () => {
  it('adds, lists in order, edits and deletes', async () => {
    const second = await scrapersRepo.insert({ ...search('Second', 'boardb'), position: 2 });
    const first = await scrapersRepo.insert({ ...search('First', 'boarda'), position: 1 });
    expect((await scrapersRepo.list()).map((scraper) => scraper.name)).toEqual(['First', 'Second']);
    expect(await scrapersRepo.boards()).toEqual([
      { src: 'boarda', name: 'First' },
      { src: 'boardb', name: 'Second' },
    ]);
    // the boards to filter by: the built-in ones, then these
    expect((await sourceOptions()).slice(-2)).toEqual([
      { id: 'boarda', label: 'First' },
      { id: 'boardb', label: 'Second' },
    ]);

    await scrapersRepo.saveOutcome(first, { ok: true, found: 10, kept: 4, added: 2, error: null, ms: 1234, mark: 42 });
    let scraper = await scrapersRepo.get(first);
    expect(scraper).toMatchObject({ mark: 42, lastStatus: 'ok', lastFound: 10, lastKept: 4, lastNew: 2, lastMs: 1234 });
    expect(scraper?.lastRunAt).toMatch(ISO);
    expect(scraper?.config).toEqual(search('First', 'boarda').config);
    const [json] = await exec(sql`select jsonb_typeof(config) as config from public.scrapers where id = ${first}`);
    expect(json).toEqual({ config: 'object' });

    await scrapersRepo.update(first, { enabled: false });
    expect((await scrapersRepo.get(first))?.mark).toBe(42);
    await scrapersRepo.update(first, { config: { url: 'https://boarda.example/other' } }, true); // another search
    scraper = await scrapersRepo.get(first);
    expect(scraper).toMatchObject({ enabled: false, mark: null, config: { url: 'https://boarda.example/other' } });

    await scrapersRepo.remove(second);
    expect(await scrapersRepo.get(second)).toBeNull();
    expect(await scrapersRepo.list()).toHaveLength(1);
  });

  it('leaves out a kind this version does not know', async () => {
    await scrapersRepo.insert({ ...search('Known', 'known'), position: 1 });
    await exec(sql`alter table public.scrapers drop constraint scrapers_kind_check`);
    try {
      await exec(sql`insert into public.scrapers (name, src, kind) values ('Future', 'future', 'hologram')`);
      expect((await scrapersRepo.list()).map((scraper) => scraper.name)).toEqual(['Known']);
    } finally {
      await exec(sql`delete from public.scrapers where kind = 'hologram'`);
      await exec(sql`alter table public.scrapers add constraint scrapers_kind_check
        check (kind in ('justjoin', 'nofluff', 'solidjobs', 'bulldog', 'eldorado', 'builtin', 'linkedin', 'json', 'html', 'rss'))`);
    }
  });
});

describeDb('scraping settings, state and runs', () => {
  it('keeps the settings, with defaults for what is missing', async () => {
    expect(await settingsRepo.get()).toEqual(DEFAULT_SETTINGS);
    const mine = { ...DEFAULT_SETTINGS, keywords: ['Vue'], everyMinutes: 30, timeZone: 'UTC' };
    await settingsRepo.save(mine);
    await settingsRepo.save({ ...mine, keywords: ['Vue', 'Svelte'] }); // the one row, updated
    expect(await settingsRepo.get()).toEqual({ ...mine, keywords: ['Vue', 'Svelte'] });
    const [json] = await exec(sql`select jsonb_typeof(settings) as settings from public.scrape_settings`);
    expect(json).toEqual({ settings: 'object' });
  });

  it('gives the scrape lock to one caller at a time, until it is freed or runs out', async () => {
    const got = await Promise.all(Array.from({ length: 5 }, () => stateRepo.lock(60)));
    expect(got.filter(Boolean)).toHaveLength(1);
    const state = await stateRepo.get();
    expect(state.lockedUntil).toMatch(ISO);
    expect(state.lastRunAt).toMatch(ISO);
    expect(await stateRepo.lock(60)).toBe(false);

    await stateRepo.unlock();
    expect(await stateRepo.lock(60)).toBe(true);
    // a crashed run's lock runs out by itself
    await exec(sql`update public.scrape_state set locked_until = now() - interval '1 second'`);
    expect(await stateRepo.lock(60)).toBe(true);
  });

  it('records calls and mute', async () => {
    await stateRepo.markCall();
    await stateRepo.setMuted(true);
    const state = await stateRepo.get();
    expect(state.muted).toBe(true);
    expect(state.lastCallAt).toMatch(ISO);
  });

  it('logs runs, newest first, and keeps two weeks', async () => {
    const old = await runsRepo.start('cron');
    await exec(sql`update public.scrape_runs set started_at = now() - interval '15 days' where id = ${old}`);
    const id = await runsRepo.start('manual');
    expect(id).toBeGreaterThan(old);
    await runsRepo.finish(id, { found: 3, kept: 2, added: 1, fresh: 1, notified: 0, errors: [] });
    await runsRepo.update(id, { notified: 1, matched: 1, errors: [{ scraper: 'AI', error: 'slow' }] });
    const runs = await runsRepo.list();
    expect(runs.map((run) => run.id)).toEqual([id]); // the old one went with finish()
    expect(runs[0]).toMatchObject({
      trigger: 'manual',
      found: 3,
      notified: 1,
      matched: 1,
      errors: [{ scraper: 'AI', error: 'slow' }],
    });
    expect(runs[0].finishedAt).toMatch(ISO);
    const [json] = await exec(sql`select jsonb_typeof(errors) as errors from public.scrape_runs where id = ${id}`);
    expect(json).toEqual({ errors: 'array' });
  });
});

describeDb('Telegram queue', () => {
  const queued = (id: string) => ({
    src: 'justjoin',
    id,
    title: `Job ${id}`,
    company: null,
    seniority: null,
    remote: false,
    location: null,
    url: `https://justjoin.it/${id}`,
    dupKey: `x|${id}`,
  });

  it('queues once, and hands each offer to one sender only', async () => {
    await queueRepo.enqueue([queued('1'), queued('2')]);
    await queueRepo.enqueue([queued('1')]); // already there
    expect(await queueRepo.size()).toBe(2);
    const listed = await queueRepo.list();
    expect(listed.map((row) => row.id).sort()).toEqual(['1', '2']);

    const [one, two] = await Promise.all([queueRepo.claim(listed), queueRepo.claim(listed)]);
    expect([...one, ...two].map((row) => row.id).sort()).toEqual(['1', '2']);
    expect(await queueRepo.size()).toBe(0);

    // put back after a failed send: with its own time
    await queueRepo.enqueue([...one, ...two]);
    const times = (rows: queueRepo.QueuedAt[]) => Object.fromEntries(rows.map((row) => [row.id, row.queuedAt]));
    expect(times(await queueRepo.list())).toEqual(times(listed));
  });
});
