// The database tests' setup: they run only when TEST_DATABASE_URL is set (npm run test:db starts a
// throwaway container and sets it), and only against a database on this machine, since they empty
// its tables before each test.
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe } from 'vitest';
import { closeDb, db } from '@/lib/db/client';
import { isLocalDatabase } from '@/lib/db/connection';

const url = process.env.TEST_DATABASE_URL;
if (url && (!isLocalDatabase(url) || url.includes('?')))
  throw new Error('TEST_DATABASE_URL must be a database on localhost: the tests empty its tables.');
// the app's code connects to SUPABASE_DB_URL; lib/env.ts reads it on every use outside production
if (url) process.env.SUPABASE_DB_URL = url;

/** `describe`, skipped without TEST_DATABASE_URL; each test starts with empty tables. */
export function describeDb(name: string, tests: () => void) {
  describe.skipIf(!url)(name, () => {
    beforeEach(emptyTables);
    afterAll(closeDb);
    tests();
  });
}

async function emptyTables() {
  await db().execute(sql`
    truncate public.offers, public.job_links, public.ai_dup_pairs, public.applications, public.ai_profiles,
      public.ai_verdicts, public.ai_runs, public.offer_details, public.scrapers, public.scrape_runs,
      public.notify_queue, public.scrape_settings
    restart identity cascade`);
  await db().execute(sql`delete from public.scrape_state`);
  await db().execute(sql`insert into public.scrape_state (id) values (true)`);
}

/** Runs SQL as is (setting up a case the app's own code wouldn't make, like an old timestamp). */
export const exec = (query: ReturnType<typeof sql>) => db().execute(query);

/** ISO 8601 with an offset, as the app gets every timestamp */
export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}:\d{2}$/;
