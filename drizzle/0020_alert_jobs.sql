-- LinkedIn's job alert emails, sent by a Gmail script to POST /api/alerts/linkedin: alert_jobs holds the jobs
-- they name until a scrape run reads and filters them (lib/listings/pipeline/alerts.ts), and scrape_state the
-- last email's time and number of jobs (Settings shows them). Written by `npm run db:generate` and made
-- idempotent by hand (`if not exists`). RLS on with no policies, as every table.
CREATE TABLE IF NOT EXISTS "alert_jobs" (
	"src" text NOT NULL,
	"id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text,
	"done_at" timestamp with time zone,
	CONSTRAINT "alert_jobs_pkey" PRIMARY KEY("src","id"),
	CONSTRAINT "alert_jobs_outcome_check" CHECK (outcome in ('kept', 'skipped', 'known'))
);
--> statement-breakpoint
ALTER TABLE "alert_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scrape_state" ADD COLUMN IF NOT EXISTS "alert_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scrape_state" ADD COLUMN IF NOT EXISTS "alert_email_jobs" integer;
