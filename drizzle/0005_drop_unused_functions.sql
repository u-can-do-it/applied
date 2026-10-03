-- Custom migration: the SQL functions the app called through PostgREST and no longer calls (their
-- queries are in TypeScript now, lib/db/repos/: applications' status changes and ghosting, the
-- scrape lock, the boards' offer counts, the AI tab's results / pending jobs / range counts).
-- Nothing else uses them: no other function, the offers_unique view or Supabase Cron's job command.
-- Their grants go with them. Idempotent: `if exists`, with each one's exact signature.
drop function if exists public.jw_set_application_status(text, text, text);
--> statement-breakpoint
drop function if exists public.jw_ghost_stale_applications(integer);
--> statement-breakpoint
drop function if exists public.jw_scrape_lock(integer);
--> statement-breakpoint
drop function if exists public.jw_source_counts();
--> statement-breakpoint
drop function if exists public.ai_results(uuid, integer);
--> statement-breakpoint
drop function if exists public.ai_pending(uuid, integer, timestamptz, timestamptz);
--> statement-breakpoint
drop function if exists public.ai_range_stats(uuid, integer, timestamptz, timestamptz);
