-- ⚠️  DESTRUCTIVE: wipes everything in the `public` schema (tables, views, functions, data)
-- of the old app, then creates the Jobwatch `offers` table.
-- Supabase → SQL Editor → paste → Run.
-- Leaves auth users and storage buckets alone (separate schemas).

drop schema if exists public cascade;
create schema public;

-- restore Supabase's default grants on a fresh public schema
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- ---- Jobwatch (same as schema.sql) -----------------------------------------

create table public.offers (
  src        text        not null,
  id         text        not null,
  title      text        not null,
  company    text,
  seniority  text,
  remote     boolean,
  url        text        not null,
  first_seen timestamptz not null default now(),
  primary key (src, id)
);

create index offers_first_seen_idx on public.offers (first_seen desc);

-- RLS on, no policies: only the secret key (server-side) can read/write
alter table public.offers enable row level security;

-- make the REST API pick up the new table right away
notify pgrst, 'reload schema';

-- shows what's left in public afterwards; should be just `offers`
select table_name from information_schema.tables where table_schema = 'public';
