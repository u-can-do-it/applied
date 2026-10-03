import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import journal from '@/drizzle/meta/_journal.json';
import { isLocalDatabase, isoTimestamp, withSsl } from '@/lib/db/connection';
import { pendingMigrations } from '@/lib/db/health';

describe('withSsl', () => {
  it('asks for TLS on a remote database', () => {
    expect(withSsl('postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres')).toBe(
      'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require',
    );
    expect(withSsl('postgresql://u:p@host:6543/postgres?application_name=x')).toBe(
      'postgresql://u:p@host:6543/postgres?application_name=x&sslmode=require',
    );
  });

  it('keeps an sslmode that is already there, and leaves a local database alone', () => {
    expect(withSsl('postgresql://u:p@host/postgres?sslmode=verify-full')).toBe(
      'postgresql://u:p@host/postgres?sslmode=verify-full',
    );
    expect(withSsl('postgresql://postgres:pg@localhost:5544/postgres')).toBe(
      'postgresql://postgres:pg@localhost:5544/postgres',
    );
  });
});

describe('isLocalDatabase', () => {
  it('is true only for this machine', () => {
    expect(isLocalDatabase('postgresql://u:p@localhost:5432/x')).toBe(true);
    expect(isLocalDatabase('postgresql://u:p@127.0.0.1:5432/x')).toBe(true);
    expect(isLocalDatabase('postgresql://u:p@[::1]:5432/x')).toBe(true);
    expect(isLocalDatabase('postgresql://u:p@localhost.example.com:5432/x')).toBe(false);
    expect(isLocalDatabase('postgresql://u:p@db.ref.supabase.co:5432/x')).toBe(false);
    expect(isLocalDatabase('not a url')).toBe(false);
  });
});

describe('pendingMigrations', () => {
  const bundled = [
    { tag: '0000_a', when: 100 },
    { tag: '0001_b', when: 200 },
    { tag: '0002_c', when: 300 },
  ];

  it('is everything when no migration ever ran', () => {
    expect(pendingMigrations(bundled, null)).toEqual(['0000_a', '0001_b', '0002_c']);
  });

  it('is what came after the last one the database ran', () => {
    expect(pendingMigrations(bundled, 200)).toEqual(['0002_c']);
    expect(pendingMigrations(bundled, 300)).toEqual([]);
  });

  it('is nothing when the database is ahead of this build (a newer deploy migrated it)', () => {
    expect(pendingMigrations(bundled, 400)).toEqual([]);
  });
});

describe('drizzle/ migrations', () => {
  it('has a file for every journal entry, and no file the journal does not list', () => {
    const files = readdirSync('drizzle').filter((name) => name.endsWith('.sql'));
    expect(files.sort()).toEqual(journal.entries.map(({ tag }) => `${tag}.sql`).sort());
  });

  it('runs them in the order of their names (drizzle-kit goes by `when`)', () => {
    const byWhen = [...journal.entries].sort((a, b) => a.when - b.when).map(({ tag }) => tag);
    expect(byWhen).toEqual(journal.entries.map(({ tag }) => tag).sort());
  });

  it('keeps the baseline idempotent, so it can run on a database that already has the tables', () => {
    const baseline = readFileSync('drizzle/0001_baseline.sql', 'utf8');
    expect(baseline).not.toMatch(/CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/);
    expect(baseline).not.toMatch(/^ALTER TABLE "\w+" ADD CONSTRAINT "\w+_fkey"/m);
  });
});

describe('isoTimestamp', () => {
  it('turns Postgres timestamptz text into ISO 8601, keeping the microseconds', () => {
    expect(isoTimestamp('2026-10-03 12:34:56.123456+00')).toBe('2026-10-03T12:34:56.123456+00:00');
    expect(isoTimestamp('2026-10-03 12:34:56+05:30')).toBe('2026-10-03T12:34:56+05:30');
    expect(isoTimestamp('2026-03-29 01:00:00-07')).toBe('2026-03-29T01:00:00-07:00');
    expect(Date.parse(isoTimestamp('2026-10-03 12:34:56.5+02'))).toBe(Date.parse('2026-10-03T10:34:56.500Z'));
  });

  it('leaves anything else as it is', () => {
    expect(isoTimestamp('infinity')).toBe('infinity');
    expect(isoTimestamp('2026-10-03T12:34:56Z')).toBe('2026-10-03T12:34:56Z');
  });
});
