-- The jobs you opened from a list (lib/db/repos/seen-jobs.ts), written by `npm run db:generate` and
-- made idempotent by hand (`if not exists`). RLS on with no policies, as every table.
CREATE TABLE IF NOT EXISTS "seen_jobs" (
	"dup_key" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seen_jobs" ENABLE ROW LEVEL SECURITY;
