import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, expect, it } from 'vitest';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { seedBoards } from '@/lib/db/seed';
import { SEED_SCRAPERS } from '@/lib/listings/kinds';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';
import { describeDb, exec } from './database';

// A fresh install's scrapers: the ones the SQL migrations inserted (0003_seed.sql, history now) and
// those lib/db/seed.ts adds after them, for any board not seeded yet. Both must be the registry's.

const migrations = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] })
  .entries;
const seeding = migrations
  .map(({ tag }) => readFileSync(`drizzle/${tag}.sql`, 'utf8'))
  .filter((file) => /insert into public\.(scrapers|scrape_seeds)\b/i.test(file));

let client: postgres.Sql | undefined;
const seed = () => seedBoards((client ??= postgres(process.env.TEST_DATABASE_URL ?? '', { max: 1 })));
afterAll(async () => {
  await client?.end();
});

/** What `npm run db:migrate` does to an empty database, for the seeds (the tables are emptied before each test). */
async function migrateAndSeed() {
  for (const file of seeding)
    for (const statement of file.split('--> statement-breakpoint')) await exec(sql.raw(statement));
  return seed();
}

const rows = async () =>
  (await scrapersRepo.list()).map(({ position, name, src, kind, enabled, config }) => ({
    position,
    name,
    src,
    kind,
    enabled,
    config,
  }));
const registry = SEED_SCRAPERS.map((scraper, index) => ({ position: index + 1, ...scraper, enabled: true }));

describeDb('seeds', () => {
  it('a fresh install starts with the registry’s scrapers and the default settings', async () => {
    await exec(sql`delete from public.scrape_seeds`);
    expect(await migrateAndSeed()).toEqual([]); // the migrations seeded today's boards already
    expect(await rows()).toEqual(registry);
    // the seed has the settings of its day; the ones added since come from the defaults when read
    const [{ settings }] = await exec(sql`select settings from public.scrape_settings`);
    expect(DEFAULT_SETTINGS).toMatchObject(settings as object);
  });

  it('a board not seeded yet gets its scrapers once, after the others', async () => {
    await exec(sql`delete from public.scrape_seeds`);
    await migrateAndSeed();
    // as if LinkedIn were a board added after this database was set up
    await exec(sql`delete from public.scrape_seeds where name = 'board:linkedin'`);
    await exec(sql`delete from public.scrapers where src = 'linkedin'`);
    await exec(sql`update public.scrapers set position = position + 10`);

    expect(await seed()).toEqual(['linkedin']);
    expect(await seed()).toEqual([]);
    const linkedin = (await rows()).filter((scraper) => scraper.src === 'linkedin');
    expect(linkedin).toEqual(registry.slice(6).map((scraper, index) => ({ ...scraper, position: 17 + index })));
  });

  it('scrapers you deleted stay deleted', async () => {
    await exec(sql`delete from public.scrape_seeds`);
    await migrateAndSeed();
    await exec(sql`delete from public.scrapers where kind = 'eldorado' or name = 'LinkedIn – remote'`);
    expect(await migrateAndSeed()).toEqual([]);
    expect((await rows()).map((scraper) => scraper.name)).toEqual(
      registry.map((scraper) => scraper.name).filter((name) => name !== 'Eldorado' && name !== 'LinkedIn – remote'),
    );
  });
});
