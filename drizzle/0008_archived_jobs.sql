-- The jobs you archived from a list (lib/db/repos/archived-jobs.ts), written by `npm run db:generate` and
-- made idempotent by hand (`if not exists`). RLS on with no policies, as every table.
CREATE TABLE IF NOT EXISTS "archived_jobs" (
	"dup_key" text PRIMARY KEY NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archived_jobs" ENABLE ROW LEVEL SECURITY;
