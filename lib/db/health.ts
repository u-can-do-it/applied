import 'server-only';
import { sql } from 'drizzle-orm';
import journal from '@/drizzle/meta/_journal.json';
import { log } from '../log';
import { db } from './client';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from './connection';

// Is the database's schema the one this build expects? The migrations in drizzle/ are bundled with
// the app (their journal), and the database records the ones it ran; a deploy whose migrations
// weren't applied yet (`npm run db:migrate`) shows up as "behind" instead of failing query by query.

export type DbHealth = {
  db: 'ok' | 'behind' | 'unreachable';
  /** migrations bundled with the app that the database hasn't run, oldest first */
  pending: string[];
};

type Migration = { tag: string; when: number };

/**
 * The migrations `npm run db:migrate` would run (drizzle-orm's migrator): the ones newer than the last it recorded
 * (it goes by the journal's `when`, not by name). `lastApplied` null = it never ran.
 */
export function pendingMigrations(bundled: readonly Migration[], lastApplied: number | null): string[] {
  return bundled.filter((migration) => lastApplied === null || migration.when > lastApplied).map(({ tag }) => tag);
}

/** `created_at` of the last migration the database ran, null if none ever did */
async function lastAppliedMigration(): Promise<number | null> {
  const table = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  // a database no migration ran on has no such table: that's "behind", not unreachable
  const [{ present }] = await db().execute<{ present: boolean }>(
    sql`select to_regclass(${table}) is not null as present`,
  );
  if (!present) return null;
  const [{ last }] = await db().execute<{ last: string | null }>(
    sql`select max(created_at)::text as last from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
  );
  return last === null ? null : Number(last);
}

export async function checkDbHealth(): Promise<DbHealth> {
  let last: number | null;
  try {
    last = await lastAppliedMigration();
  } catch (error) {
    // no SUPABASE_DB_URL, a wrong password, the pooler down: all the same to the caller
    log.error('Database health check failed', { error });
    return { db: 'unreachable', pending: [] };
  }
  const pending = pendingMigrations(journal.entries, last);
  return { db: pending.length ? 'behind' : 'ok', pending };
}
