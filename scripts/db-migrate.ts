// npm run db:migrate: applies the pending migrations in drizzle/ to SUPABASE_DB_URL (from the shell,
// or .env: `node --env-file-if-exists=.env`, where the shell's value wins).
//
// The same migrator `drizzle-kit migrate` uses (drizzle-orm's), run directly because drizzle-kit
// exits with status 1 and no message when a statement fails: its progress spinner swallows the
// error. On production you want to know why. Like drizzle-kit, it runs every pending migration in
// one transaction, so a failure changes nothing.
//
// Plain Node runs this file (it strips the types itself); no build step. Hence the `.ts` in the import
// below, which Node needs (tsconfig.json: allowImportingTsExtensions).

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, withSsl } from '../lib/db/connection.ts';

const url = process.env.SUPABASE_DB_URL ?? '';
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('SUPABASE_DB_URL is not set, or not a postgresql:// URL (Supabase → Connect → Session pooler).');
  process.exit(1);
}
const { hostname, port, pathname } = new URL(url);
console.log(`Migrating ${hostname}:${port || '5432'}${pathname}`);

// the idempotent migrations say "already exists, skipping" a few hundred times: not news
const client = postgres(withSsl(url), { max: 1, onnotice: () => undefined });
const applied = async () => {
  const [{ present }] = await client<{ present: boolean }[]>`
    select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as present`;
  if (!present) return 0;
  const [{ count }] = await client<{ count: number }[]>`
    select count(*)::int as count from ${client(MIGRATIONS_SCHEMA)}.${client(MIGRATIONS_TABLE)}`;
  return count;
};

try {
  const before = await applied();
  await migrate(drizzle({ client }), {
    migrationsFolder: 'drizzle',
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
  const after = await applied();
  console.log(after > before ? `Applied ${after - before} migration(s); ${after} in all.` : `Up to date (${after}).`);
} catch (error) {
  const cause = (error instanceof Error && error.cause instanceof Error ? error.cause : error) as Error & {
    detail?: string;
    hint?: string;
    where?: string;
    code?: string;
  };
  console.error('Migration failed; rolled back, nothing changed.\n');
  console.error(cause.message);
  // Postgres' hint for this one is "use DROP ... CASCADE", which would drop your object with it
  const hint =
    cause.code === '2BP01' ? 'Something of yours is built on it: see scripts/db-preflight.sql (check 6).' : cause.hint;
  for (const extra of [cause.detail, hint, cause.where]) if (extra) console.error(extra);
  process.exitCode = 1;
} finally {
  await client.end();
}
