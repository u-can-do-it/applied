import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import { isoTimestamp, TIMESTAMPTZ_OID, withSsl } from './connection';
import * as schema from './schema';

// A few connections per serverless instance, through Supabase's SESSION pooler (port 5432), not the
// transaction pooler (6543): through 6543, two queries back to back on one connection lose their
// answers, and a page (a dozen queries at once) hung until the function's limit. With Fluid compute
// one instance serves several requests at once (a page, a server action, an after() worker), so a
// single connection would queue them; in session mode each connection holds a real database
// connection while it's open, so the pool stays small (3) and idle ones close after 20 s.
// `prepare: false` is kept: harmless here, and needed if the URL is ever a transaction pooler's.
// See docs/decisions/0001-drizzle-over-postgrest.md.

export type Db = PostgresJsDatabase<typeof schema>;

// Created on first use, not at import: `next build` loads this module without SUPABASE_DB_URL.
// Kept on globalThis so `next dev`'s hot reloads reuse the connection instead of opening one per edit.
const cache = globalThis as typeof globalThis & { jobwatchDb?: { url: string; client: postgres.Sql; db: Db } };

/** The database (Drizzle over postgres.js); throws "SUPABASE_DB_URL is not set" until it is. */
export function db(): Db {
  const url = env.SUPABASE_DB_URL;
  if (cache.jobwatchDb?.url !== url) {
    void cache.jobwatchDb?.client.end(); // .env changed under `next dev`
    const client = postgres(withSsl(url), {
      prepare: false,
      max: 3,
      // a frozen instance's connection is dropped by the pooler anyway; don't hold it longer
      idle_timeout: 20,
      connect_timeout: 10,
      // A query or a lock wait never holds a function past its time limit (PostgREST had a 30 s
      // timeout too). Startup parameters: the session pooler passes them on.
      connection: { application_name: 'jobwatch', statement_timeout: 30_000, lock_timeout: 10_000 },
    });
    const database = drizzle({ client, schema });
    // drizzle() has just told the driver to hand timestamps over as Postgres' text; make that ISO
    // 8601 (schema.ts: timestamps are strings). Raw `sql` queries get the same.
    client.options.parsers[TIMESTAMPTZ_OID] = isoTimestamp;
    cache.jobwatchDb = { url, client, db: database };
  }
  return cache.jobwatchDb.db;
}

/** Closes the connections (tests and scripts; the app keeps them for its instance's life). */
export async function closeDb() {
  const open = cache.jobwatchDb;
  cache.jobwatchDb = undefined;
  await open?.client.end();
}
