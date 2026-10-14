-- What a LinkedIn scraper's run couldn't read (its batch of requests used up, a page turned away), for a
-- follow-up a few minutes later (lib/listings/pipeline/follow-up.ts). The version before this one doesn't
-- read the column.
ALTER TABLE "scrapers" ADD COLUMN IF NOT EXISTS "follow_up" jsonb;--> statement-breakpoint
-- Supabase Cron knocks every five minutes whatever the interval (lib/listings/cron.ts), so a follow-up can
-- come between the runs. The version before this one keeps to its interval on these knocks as well
-- (checkDue), its Settings saying the schedule isn't the one it would make until the deploy. Runs any
-- number of times; nothing to do while the job isn't connected.
do $$
declare
  id bigint;
  line text;
begin
  if to_regnamespace('cron') is null then return; end if;
  select j.jobid, j.schedule into id, line from cron.job j where j.jobname = 'jobwatch-scrape';
  if not found then return; end if;
  perform cron.alter_job(id, schedule := regexp_replace(line, '^\S+', '*/5'));
end $$;
