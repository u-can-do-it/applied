import 'server-only';
import { waitUntil } from '@vercel/functions';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import { isoTimestamp, TIMESTAMPTZ_OID, withSsl } from './connection';
import * as schema from './schema';

// A few connections per serverless instance, through Supabase's session pooler (port 5432). Not the
// transaction pooler (6543): through it, queries sent back to back on one connection lose their
// answers, and a page sends a dozen at once. With Fluid compute one instance serves several requests
// at once (a page, a server action, an after() worker), so a single connection would queue them; in
// session mode each connection holds a real database connection while it's open, so the pool stays
// small and idle ones close after a few seconds. See docs/decisions/0001-drizzle-over-postgrest.md.
//
// Fluid compute freezes an instance between requests, timers and all: a connection still open when it froze
// stays open in the pooler (15 clients) for as long as the instance lives, and every deploy brings new ones.
// So after each query the request is kept going until its idle connections have closed (holdUntilIdle):
// what @vercel/functions' attachDatabasePool does for `pg`, which doesn't know postgres.js.

const IDLE_SECONDS = 5;
// a query started (db() called) finishes within this (most take milliseconds), then idles IDLE_SECONDS
// before its connection closes; an instance stays up this long after its last query
const QUERY_MS = 10_000;

export type Db = PostgresJsDatabase<typeof schema>;

// Created on first use, not at import: `next build` loads this module without SUPABASE_DB_URL.
// Kept on globalThis so `next dev`'s hot reloads reuse the connection instead of opening one per edit.
const cache = globalThis as typeof globalThis & { jobwatchDb?: { url: string; client: postgres.Sql; db: Db } };

let hold: { timer: ReturnType<typeof setTimeout>; release: () => void } | undefined;

/**
 * Keeps the request (on Vercel: the instance) going until the connections this query used are idle long
 * enough to close; each query starts the wait again. One wait at a time, like attachDatabasePool: a newer
 * one keeps the instance alive for the older. Outside Vercel's request scope waitUntil does nothing.
 */
export function holdUntilIdle() {
  if (hold) {
    clearTimeout(hold.timer);
    hold.release();
  }
  let release = () => {};
  const idle = new Promise<void>((resolve) => (release = resolve));
  const timer = setTimeout(
    () => {
      hold = undefined;
      release();
    },
    IDLE_SECONDS * 1000 + QUERY_MS,
  );
  hold = { timer, release };
  waitUntil(idle);
}

/** The database (Drizzle over postgres.js); throws "SUPABASE_DB_URL is not set" until it is. */
export function db(): Db {
  const url = env.SUPABASE_DB_URL;
  if (process.env.VERCEL) holdUntilIdle();
  if (cache.jobwatchDb?.url !== url) {
    void cache.jobwatchDb?.client.end(); // .env changed under `next dev`
    const client = postgres(withSsl(url), {
      prepare: false,
      max: 3,
      idle_timeout: IDLE_SECONDS,
      connect_timeout: 10,
      // Meant to stop a slow query or a lock wait before the function's time limit. The session
      // pooler doesn't pass startup parameters on: the connections run with the role's own
      // settings (statement_timeout 2 min, no lock_timeout) unless they're set on the role
      // (docs/OPERATIONS.md → "Timeouts and the pooler").
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
