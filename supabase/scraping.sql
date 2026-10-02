-- Scraping inside the app (replaces the Node-RED flow): the scrapers and their settings, a log
-- of runs, the Telegram queue, and the call from Supabase Cron to /api/cron/scrape.
-- Needs supabase/ai-filter.sql first (offers.dup_key). Safe to re-run: only adds what's missing.

-- ---- 1. Supabase Cron + pg_net: what calls the endpoint every few minutes ---------------------
-- Both exist on every Supabase plan. Elsewhere (a local Postgres) they may not: then the app
-- still works, it just needs another caller (Node-RED, cron-job.org…) or the "Scrape now" button.
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
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net with schema extensions;
  end if;
exception when others then
  raise notice 'pg_net could not be enabled here (%): enable it in Supabase (Database → Extensions)', sqlerrm;
end $$;

-- ---- 2. scrapers: one row per search -----------------------------------------------------------
-- kind = the parser: the six boards Node-RED knew, or a generic one (JSON / HTML / RSS) set up
-- in the app. src = the board as stored in offers.src; searches on the same board share it, so
-- an offer found by two of them is still one row.
create table if not exists public.scrapers (
  id          uuid primary key default gen_random_uuid(),
  position    integer not null default 0,
  name        text not null,
  src         text not null,
  kind        text not null,
  enabled     boolean not null default true,
  config      jsonb not null default '{}'::jsonb, -- url, headers, filters, field paths…
  -- newest "sort value" seen (publish time or the board's id counter). Offers older than this
  -- that show up later (bumped, renewed) are saved but not announced. null = never ran: the
  -- first run only saves, like Node-RED's seeding, so a new scraper doesn't flood Telegram.
  mark        double precision,
  last_run_at timestamptz,
  last_status text,
  last_found  integer,
  last_kept   integer,
  last_new    integer,
  last_error  text,
  last_ms     integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.scrapers drop constraint if exists scrapers_src_check;
alter table public.scrapers add constraint scrapers_src_check check (src ~ '^[a-z0-9][a-z0-9_-]{0,29}$');
alter table public.scrapers drop constraint if exists scrapers_kind_check;
alter table public.scrapers add constraint scrapers_kind_check
  check (kind in ('justjoin', 'nofluff', 'solidjobs', 'bulldog', 'eldorado', 'builtin', 'linkedin', 'json', 'html', 'rss'));
alter table public.scrapers drop constraint if exists scrapers_status_check;
alter table public.scrapers add constraint scrapers_status_check check (last_status in ('ok', 'error'));

-- ---- 3. settings (what Node-RED had in its function nodes) and machine state ----------------
create table if not exists public.scrape_settings (
  id         boolean primary key default true check (id), -- a single row
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.scrape_state (
  id           boolean primary key default true check (id),
  locked_until timestamptz, -- one run at a time
  last_call_at timestamptz, -- the endpoint was called (by any trigger), even if nothing was due
  last_run_at  timestamptz, -- a run actually started
  muted        boolean not null default false -- /mute: offers wait in notify_queue
);
insert into public.scrape_state (id) values (true) on conflict (id) do nothing;

-- first install: the defaults and the six boards with Node-RED's URLs and filters
with created as (
  insert into public.scrape_settings (id, settings) values (true, jsonb_build_object(
    'enabled', true,          -- scheduled runs (the "Scrape now" button works either way)
    'everyMinutes', 5,
    'fromHour', 7, 'toHour', 22, -- Warsaw time, like Node-RED's "0 */5 7-21 * * *"
    'keywords', jsonb_build_array('React'),
    'cities', jsonb_build_array('warszaw', 'warsaw'),
    'remoteOk', true,
    'ignore', jsonb_build_array(),
    'mute', jsonb_build_array('.net', 'dotnet', 'go', 'golang', 'java'),
    'notify', true))
  on conflict (id) do nothing
  returning 1
)
insert into public.scrapers (position, name, src, kind, config)
select v.position, v.name, v.src, v.kind, v.config::jsonb
from (values
  (1, 'JustJoin', 'justjoin', 'justjoin',
   '{"url": "https://justjoin.it/api/candidate-api/offers?keywords={keyword}&keywordType=any&sortBy=publishedAt&orderBy=descending&itemsCount=100", "checkKeyword": true, "checkLocation": true}'),
  (2, 'NoFluff', 'nofluff', 'nofluff',
   '{"url": "https://nofluffjobs.com/pl/praca-it/{keyword_slug}?sort=newest", "checkKeyword": true, "checkLocation": true}'),
  (3, 'Solid.jobs', 'solidjobs', 'solidjobs',
   '{"url": "https://solid.jobs/public-api/offers/IT?campaign=nodered-jobwatch&search.searchTerm={keyword}&sortActive=validFrom&sortDirection=desc&pageSize=100", "headers": {"X-Api-Version": "1.0", "campaign": "44"}, "checkKeyword": true, "checkLocation": true}'),
  (4, 'Bulldog', 'bulldog', 'bulldog',
   '{"url": "https://bulldogjob.pl/companies/jobs/s/skills,{keyword}/order,published,desc", "checkKeyword": false, "checkLocation": true}'),
  (5, 'Eldorado', 'eldorado', 'eldorado',
   '{"url": "https://czyjesteldorado.pl/search?tag%5B%5D={keyword}&sort=newest", "checkKeyword": false, "checkLocation": true}'),
  (6, 'Built In', 'builtin', 'builtin',
   '{"url": "https://builtin.com/jobs/remote?search={keyword}&daysSinceUpdated=1&city=&state=&country=POL&allLocations=true", "headers": {"User-Agent": "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.12.45 Mobile Safari/537.36"}, "checkKeyword": true, "checkLocation": false}')
) as v(position, name, src, kind, config)
where exists (select 1 from created);

-- scrapers added in later versions: each one once, so one you deleted doesn't come back
create table if not exists public.scrape_seeds (
  name text primary key,
  at   timestamptz not null default now()
);
with first_time as (insert into public.scrape_seeds (name) values ('linkedin') on conflict (name) do nothing returning 1)
insert into public.scrapers (position, name, src, kind, config)
select v.position, v.name, 'linkedin', 'linkedin', v.config::jsonb
from (values
  (7, 'LinkedIn – Warszawa',
   '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Warszawa&f_TPR=r86400&sortBy=DD&start=0", "checkKeyword": true, "checkLocation": true}'),
  (8, 'LinkedIn – remote',
   '{"url": "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords={keyword}&location=Poland&f_WT=2&f_TPR=r86400&sortBy=DD&start=0", "checkKeyword": true, "checkLocation": true}')
) as v(position, name, config)
where exists (select 1 from first_time);

-- ---- 4. runs and the Telegram queue ---------------------------------------------------------
create table if not exists public.scrape_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text not null, -- cron | manual | telegram
  found       integer not null default 0, -- items on the pages
  kept        integer not null default 0, -- after keyword / city filters
  added       integer not null default 0, -- new rows in offers
  fresh       integer not null default 0, -- new jobs worth a message (not a copy of a known one)
  notified    integer not null default 0, -- sent to Telegram in this run
  errors      jsonb not null default '[]'::jsonb
);
create index if not exists scrape_runs_started_idx on public.scrape_runs (started_at desc);

-- new jobs wait here until they're sent; while muted, they pile up (like Node-RED's queue)
create table if not exists public.notify_queue (
  src       text not null,
  id        text not null,
  title     text not null,
  company   text,
  seniority text,
  remote    boolean,
  location  text,
  url       text not null,
  queued_at timestamptz not null default now(),
  primary key (src, id)
);

-- the AI filter (Telegram gets only the offers the active AI profile matches): the queue knows
-- each offer's job, to find its verdict, and a run logs how many matched (null = no AI filter)
alter table public.notify_queue add column if not exists dup_key text;
alter table public.scrape_runs add column if not exists matched integer;

-- ---- 5. functions -------------------------------------------------------------------------
-- Saves what a run found. Returns only the rows that were really new, each with whether the same
-- job (same company + title, any board) was already known. The subquery can't see the rows this
-- statement inserts, so "seen_before" means "before this run".
create or replace function public.jw_ingest_offers(p_rows jsonb)
returns table (src text, id text, dup_key text, seen_before boolean)
language sql set search_path = '' as $$
  with incoming as (
    select distinct on (x.src, x.id) x.*
    from jsonb_to_recordset(p_rows) as x(src text, id text, title text, company text, seniority text, remote boolean, url text)
    where x.src is not null and x.id is not null and x.url is not null
  ),
  ins as (
    insert into public.offers (src, id, title, company, seniority, remote, url)
    select i.src, i.id, coalesce(nullif(i.title, ''), '(no title)'), nullif(i.company, ''), nullif(i.seniority, ''),
           coalesce(i.remote, false), i.url
    from incoming i
    on conflict (src, id) do nothing
    returning offers.src, offers.id, offers.dup_key
  )
  select ins.src, ins.id, ins.dup_key,
         exists (select 1 from public.offers o where o.dup_key = ins.dup_key) as seen_before
  from ins
$$;

-- one run at a time; a crashed run frees the lock when it expires
create or replace function public.jw_scrape_lock(p_seconds integer) returns boolean
language sql set search_path = '' as $$
  with got as (
    update public.scrape_state set locked_until = now() + make_interval(secs => p_seconds), last_run_at = now()
     where id and (locked_until is null or locked_until < now())
    returning 1
  )
  select exists (select 1 from got)
$$;

create or replace function public.jw_source_counts()
returns table (src text, offers bigint, newest timestamptz)
language sql stable set search_path = '' as $$
  select o.src, count(*), max(o.first_seen) from public.offers o group by o.src
$$;

-- Supabase Cron: calls the app every 5 minutes; the app decides whether a run is due (its own
-- interval and hours, in Warsaw time). Called from Settings with the app's URL and secret.
create or replace function public.jw_cron_connect(p_url text, p_secret text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if to_regnamespace('cron') is null then return 'pg_cron is not enabled (Supabase → Integrations → Cron)'; end if;
  if to_regnamespace('net') is null then return 'pg_net is not enabled (Supabase → Database → Extensions)'; end if;
  perform cron.schedule('jobwatch-scrape', '*/5 * * * *', format(
    'select net.http_get(url := %L, headers := jsonb_build_object(%L, %L), timeout_milliseconds := 20000)',
    p_url, 'Authorization', 'Bearer ' || p_secret));
  -- cron keeps every run's details forever; keep a week
  perform cron.schedule('jobwatch-cron-cleanup', '17 3 * * *',
    $c$delete from cron.job_run_details where end_time < now() - interval '7 days'$c$);
  return 'ok';
end $$;

create or replace function public.jw_cron_disconnect() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if to_regnamespace('cron') is null then return 'pg_cron is not enabled'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('jobwatch-scrape', 'jobwatch-cron-cleanup');
  return 'ok';
end $$;

-- what Settings shows: is the job there, and how did its last call go
create or replace function public.jw_cron_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  job record;
  res record;
  out jsonb;
begin
  if to_regnamespace('cron') is null then return jsonb_build_object('available', false); end if;
  select j.jobid, j.schedule, j.active, j.command into job from cron.job j where j.jobname = 'jobwatch-scrape';
  if not found then return jsonb_build_object('available', true, 'scheduled', false); end if;
  out := jsonb_build_object('available', true, 'scheduled', true, 'schedule', job.schedule, 'active', job.active,
    -- the URL it calls, without the secret
    'url', substring(job.command from 'url := ''([^'']+)'''));
  begin
    -- pg_net keeps responses for a few hours; ours are the ones that came back from /api/cron/scrape
    select r.status_code, r.error_msg, r.created into res
      from net._http_response r
     where r.content like '%"jobwatch"%' or r.error_msg is not null
     order by r.created desc limit 1;
    if found then
      out := out || jsonb_build_object('lastStatus', res.status_code, 'lastError', res.error_msg, 'lastAt', res.created);
    end if;
  exception when others then null; -- no access to pg_net's table: show the job only
  end;
  return out;
end $$;

-- ---- 6. access: only the server's secret key --------------------------------------------------
alter table public.scrapers enable row level security;
alter table public.scrape_settings enable row level security;
alter table public.scrape_state enable row level security;
alter table public.scrape_runs enable row level security;
alter table public.notify_queue enable row level security;
alter table public.scrape_seeds enable row level security;

grant select, insert, update, delete on public.scrapers, public.scrape_settings, public.scrape_state,
  public.scrape_runs, public.notify_queue to service_role;
grant insert on public.offers to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.jw_ingest_offers(jsonb) from public, anon, authenticated;
revoke execute on function public.jw_scrape_lock(integer) from public, anon, authenticated;
revoke execute on function public.jw_source_counts() from public, anon, authenticated;
revoke execute on function public.jw_cron_connect(text, text) from public, anon, authenticated;
revoke execute on function public.jw_cron_disconnect() from public, anon, authenticated;
revoke execute on function public.jw_cron_status() from public, anon, authenticated;
grant execute on function public.jw_ingest_offers(jsonb) to service_role;
grant execute on function public.jw_scrape_lock(integer) to service_role;
grant execute on function public.jw_source_counts() to service_role;
grant execute on function public.jw_cron_connect(text, text) to service_role;
grant execute on function public.jw_cron_disconnect() to service_role;
grant execute on function public.jw_cron_status() to service_role;

notify pgrst, 'reload schema';
