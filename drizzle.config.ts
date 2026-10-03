import { defineConfig } from 'drizzle-kit';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE, withSsl } from './lib/db/connection';

// `npm run db:generate` writes a migration from lib/db/schema.ts. Applying them is
// `npm run db:migrate` (scripts/db-migrate.ts: the same migrator, but it says why when one fails).
// Never `drizzle-kit push`: it changes the database without a migration file (docs/OPERATIONS.md → Database).
// drizzle-kit reads .env itself; a variable already set in the shell wins.
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: withSsl(process.env.SUPABASE_DB_URL ?? '') },
  // only the app's tables; Supabase's own schemas (auth, storage, cron, net…) are not ours
  schemaFilter: ['public'],
  // which migrations ran (lib/db/health.ts reads it too)
  migrations: { schema: MIGRATIONS_SCHEMA, table: MIGRATIONS_TABLE },
  strict: true,
  verbose: true,
});
