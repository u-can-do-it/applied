-- The offer's window (features/offers/offer-sheet.tsx): your note on a job you haven't applied to
-- (job_notes; marking it applied moves it to the application), and the ad as the window shows it:
-- complete (an AI run's text is cut at its length) with what the board says besides (details).
-- Written by `npm run db:generate` and made idempotent by hand (`if not exists`). RLS on with no
-- policies, as every table.
CREATE TABLE IF NOT EXISTS "job_notes" (
	"dup_key" text PRIMARY KEY NOT NULL,
	"note" text,
	"note_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_notes_note_length" CHECK (length(note) <= 10000)
);
--> statement-breakpoint
ALTER TABLE "job_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "offer_details" ADD COLUMN IF NOT EXISTS "details" jsonb;--> statement-breakpoint
ALTER TABLE "offer_details" ADD COLUMN IF NOT EXISTS "complete" boolean DEFAULT false NOT NULL;
