-- Custom migration: what the tables need before they exist (lib/db/schema.ts can't declare it).
-- Extensions, pg_cron + pg_net, and the two functions offers.dup_key is computed with.
-- Idempotent, like every migration here: on a database set up with the SQL files that came before
-- Drizzle (supabase/ai-filter.sql, supabase/scraping.sql; in git history) it changes nothing.

create schema if not exists extensions;
--> statement-breakpoint
create extension if not exists unaccent with schema extensions;
--> statement-breakpoint
-- title similarity for AI duplicate candidates
create extension if not exists pg_trgm with schema extensions;
--> statement-breakpoint
-- the server key computes dup_key on insert (unaccent) and title similarity (pg_trgm) at query time;
-- Supabase grants this by default, a plain Postgres doesn't
grant usage on schema extensions to service_role;
--> statement-breakpoint

-- ---- Supabase Cron + pg_net: what calls /api/cron/scrape every few minutes ---------------------
-- Both exist on every Supabase plan. Elsewhere (a local Postgres) they may not: then the app
-- still works, it just scrapes only on the "Scrape now" button.
do $$
begin
  -- only the first time: granting again fails on Supabase ("dependent privileges exist")
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
  end if;
exception when others then
  raise notice 'pg_cron could not be enabled here (%): enable Cron in Supabase (Integrations → Cron), or call /api/cron/scrape from somewhere else', sqlerrm;
end $$;
--> statement-breakpoint
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net with schema extensions;
  end if;
exception when others then
  raise notice 'pg_net could not be enabled here (%): enable it in Supabase (Database → Extensions)', sqlerrm;
end $$;
--> statement-breakpoint

-- ---- one key per job, whichever board it came from --------------------------------------------
-- The job's key: company without legal suffix / country,
-- title without gender tags and ".js"; accents and punctuation ignored.
create or replace function public.jw_unaccent(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))
$$;
--> statement-breakpoint
create or replace function public.jw_dup_key(company text, title text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select
    regexp_replace(
      regexp_replace(lower(public.jw_unaccent(company)),
        '\y(sp\.?\s*z\.?\s*o\.?\s*o\.?|sp\.?\s*k\.?|sp\.?\s*j\.?|s\.?\s*a\.?|s\.?\s*c\.?|spolka\s+(z\s+ograniczona\s+odpowiedzialnoscia|akcyjna|komandytowa|jawna)|inc\.?|ltd\.?|llc|gmbh|s\.?r\.?o\.?|b\.?v\.?|polska|poland)(?=\W|$)',
        ' ', 'g'),
      '[^a-z0-9]+', '', 'g')
    || '|' ||
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(public.jw_unaccent(title)),
          '\(\s*([kmfdx]\s*/\s*[kmfdx](\s*/\s*[kmfdx])?|all genders?|any gender)\s*\)|\y[kmfdx]\s*/\s*[kmfdx](\s*/\s*[kmfdx])?\y',
          ' ', 'g'),
        '\.js\y', '', 'g'),
      '[^a-z0-9]+', '', 'g')
$$;
