import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import { isoTimestamp, TIMESTAMPTZ_OID, withSsl } from './connection';
import * as schema from './schema';

// A few connections per serverless instance, through Supabase's transaction pooler (port 6543):
// Vercel starts many short-lived instances, and with Fluid compute one instance serves several
// requests at once (a page, a server action, an after() worker), so a single connection would
// queue them. The pooler, not the instance, holds the real database connections, so a small pool
// here is cheap. It hands out a different backend per transaction, so prepared statements can't be
// reused across calls: `prepare: false`. See docs/decisions/0001-drizzle-over-postgrest.md.

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
      max: 5,
      // a frozen instance's connection is dropped by the pooler anyway; don't hold it longer
      idle_timeout: 20,
      connect_timeout: 10,
      // A query or a lock wait never holds a function past its time limit (PostgREST had a 30 s
      // timeout too). Startup parameters: Supabase's transaction pooler may not pass them on, see
      // docs/decisions/0001-drizzle-over-postgrest.md for the role-level fallback.
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
