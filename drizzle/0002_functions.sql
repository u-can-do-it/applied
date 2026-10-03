-- Custom migration: what lib/db/schema.ts can't declare. The offers_unique view, the functions the
-- app calls (PostgREST RPC until the queries move to Drizzle), and who may use them. Copied from
-- supabase/ai-filter.sql and supabase/scraping.sql (the SQL files before Drizzle, in git history), and
-- idempotent like them: the view and the functions that return its rows are dropped and created
-- again (same definition, so nothing changes), the rest is `create or replace`.

-- ---- applications: status changes ---------------------------------------------------------------

-- one status change, appended to the history in the same statement
create or replace function public.jw_set_application_status(p_key text, p_stage text, p_state text) returns void
language sql set search_path = '' as $$
  update public.applications
     set stage = p_stage, stage_state = p_state, stage_updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('stage', p_stage, 'state', p_state, 'at', now()))
   where dup_key = p_key
$$;
--> statement-breakpoint

-- No news for p_days since the last status change (or since applying): ghosted, at the same
-- stage. Only what still waits for an answer: in progress, or passed and waiting for the next step
-- (not rejected, not the talent pool: those are answers). Never an offer (the decision is yours).
-- The history entry says it was automatic, to take it back.
create or replace function public.jw_ghost_stale_applications(p_days integer) returns integer
language sql set search_path = '' as $$
  with stale as (
    update public.applications a
       set stage_state = 'ghosted',
           stage_updated_at = now(),
           history = a.history || jsonb_build_array(jsonb_build_object('stage', a.stage, 'state', 'ghosted', 'at', now(), 'auto', true))
     where a.stage_state in ('pending', 'passed') and a.stage <> 'offer'
       and coalesce(a.stage_updated_at, a.applied_at) < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::integer from stale
$$;
--> statement-breakpoint

-- the view is dropped and created again, with the functions that read it. No `cascade` on the
-- view: anything else built on it (a view made by hand) makes this fail and roll back instead of
-- disappearing silently.
drop function if exists public.ai_results(uuid, integer);
--> statement-breakpoint
drop function if exists public.ai_pending(uuid, integer, timestamptz, timestamptz);
--> statement-breakpoint
drop function if exists public.ai_range_stats(uuid, integer, timestamptz, timestamptz);
--> statement-breakpoint
drop function if exists public.ai_dup_candidates(timestamptz, timestamptz, integer);
--> statement-breakpoint
drop view if exists public.offers_unique;
--> statement-breakpoint

-- Each job once: its earliest copy, plus every board it was posted on.
-- dup_key here is the job's key: the offer's own key, or its group's after an AI merge.
create view public.offers_unique with (security_invoker = true) as
select src, id, title, company, seniority, remote, url, first_seen, job_key as dup_key, sources, copies, company_key,
       (select a.applied_at from public.applications a where a.dup_key = x.job_key) as applied_at
from (
  select o.src, o.id, o.title, o.company, o.seniority, o.remote, o.url, o.first_seen,
    coalesce(l.job_key, o.dup_key) as job_key,
    split_part(o.dup_key, '|', 1) as company_key,
    array_agg(o.src) over w as sources,
    jsonb_agg(jsonb_build_object('src', o.src, 'id', o.id, 'url', o.url)) over w as copies,
    row_number() over (partition by coalesce(l.job_key, o.dup_key) order by o.first_seen, o.src, o.id) as rn
  from public.offers o
  left join public.job_links l on l.dup_key = o.dup_key
  window w as (partition by coalesce(l.job_key, o.dup_key) order by o.first_seen, o.src, o.id
               rows between unbounded preceding and unbounded following)
) x
where rn = 1;
--> statement-breakpoint

-- ---- AI filter: queries the app calls (PostgREST RPC; filters/order/limit apply to their rows) ----

create or replace function public.ai_results(p_profile uuid, p_version integer)
returns table (src text, id text, title text, company text, seniority text, remote boolean, url text,
               first_seen timestamptz, dup_key text, sources text[], copies jsonb, applied_at timestamptz,
               match boolean, score integer, summary text, checks jsonb, had_description boolean)
language sql stable set search_path = '' as $$
  select u.src, u.id, u.title, u.company, u.seniority, u.remote, u.url, u.first_seen, u.dup_key,
         u.sources, u.copies, u.applied_at, v.match, v.score, v.summary, v.checks, v.had_description
  from public.offers_unique u
  join public.ai_verdicts v on v.dup_key = u.dup_key
  where v.profile_id = p_profile and v.version = p_version
$$;
--> statement-breakpoint

create or replace function public.ai_pending(p_profile uuid, p_version integer,
                                             p_gte timestamptz default null, p_lt timestamptz default null)
returns setof public.offers_unique
language sql stable set search_path = '' as $$
  select u.* from public.offers_unique u
  where (p_gte is null or u.first_seen >= p_gte)
    and (p_lt is null or u.first_seen < p_lt)
    and not exists (select 1 from public.ai_verdicts v
                    where v.profile_id = p_profile and v.version = p_version and v.dup_key = u.dup_key)
$$;
--> statement-breakpoint

create or replace function public.ai_range_stats(p_profile uuid, p_version integer,
                                                 p_gte timestamptz default null, p_lt timestamptz default null)
returns table (total bigint, checked bigint, matched bigint)
language sql stable set search_path = '' as $$
  select count(*), count(v.dup_key), count(*) filter (where v.match)
  from public.offers_unique u
  left join public.ai_verdicts v
    on v.dup_key = u.dup_key and v.profile_id = p_profile and v.version = p_version
  where (p_gte is null or u.first_seen >= p_gte) and (p_lt is null or u.first_seen < p_lt)
$$;
--> statement-breakpoint

-- Pairs worth asking the AI about: a job in the range vs any job up to 45 days apart, same
-- company (or one name a prefix of the other: "EPAM" / "EPAM Systems"), similar title, keys
-- that differ (exact duplicates are already one job) and a pair nobody has decided yet.
create or replace function public.ai_dup_candidates(p_gte timestamptz default null, p_lt timestamptz default null,
                                                    p_limit integer default 60)
returns table (key_a text, key_b text, sim real,
               a_title text, a_company text, a_seniority text, a_remote boolean, a_src text, a_first_seen timestamptz, a_excerpt text,
               b_title text, b_company text, b_seniority text, b_remote boolean, b_src text, b_first_seen timestamptz, b_excerpt text)
language sql stable set search_path = '' as $$
  with jobs as (
    select u.dup_key as job_key, u.company_key, u.title, u.company, u.seniority, u.remote, u.src, u.first_seen,
           lower(public.jw_unaccent(u.title)) as title_norm
    from public.offers_unique u
    where u.company_key <> ''
  ),
  pairs as (
    select distinct on (least(a.job_key, b.job_key), greatest(a.job_key, b.job_key))
      a.job_key as ka, b.job_key as kb, extensions.similarity(a.title_norm, b.title_norm) as sim
    from jobs a
    join jobs b
      on b.job_key <> a.job_key
     and b.first_seen between a.first_seen - interval '45 days' and a.first_seen + interval '45 days'
     and (a.company_key = b.company_key
          or (least(length(a.company_key), length(b.company_key)) >= 4
              and (a.company_key like b.company_key || '%' or b.company_key like a.company_key || '%')))
    where (p_gte is null or a.first_seen >= p_gte)
      and (p_lt is null or a.first_seen < p_lt)
      and extensions.similarity(a.title_norm, b.title_norm) >= 0.45
      and not exists (select 1 from public.ai_dup_pairs d
                      where d.key_a = least(a.job_key, b.job_key) and d.key_b = greatest(a.job_key, b.job_key))
    order by least(a.job_key, b.job_key), greatest(a.job_key, b.job_key)
  ),
  top as (select * from pairs order by sim desc limit p_limit)
  select least(t.ka, t.kb), greatest(t.ka, t.kb), t.sim,
         a.title, a.company, a.seniority, a.remote, a.src, a.first_seen,
         (select left(d.description, 700) from public.offers o2
            join public.offer_details d on d.src = o2.src and d.id = o2.id and d.status = 'ok'
            left join public.job_links l2 on l2.dup_key = o2.dup_key
           where coalesce(l2.job_key, o2.dup_key) = a.job_key limit 1),
         b.title, b.company, b.seniority, b.remote, b.src, b.first_seen,
         (select left(d.description, 700) from public.offers o2
            join public.offer_details d on d.src = o2.src and d.id = o2.id and d.status = 'ok'
            left join public.job_links l2 on l2.dup_key = o2.dup_key
           where coalesce(l2.job_key, o2.dup_key) = b.job_key limit 1)
  from top t
  join jobs a on a.job_key = least(t.ka, t.kb)
  join jobs b on b.job_key = greatest(t.ka, t.kb)
$$;
--> statement-breakpoint

-- Makes p_alias's group part of p_keep's group. Verdicts follow: the kept group's stay, the
-- alias's are adopted where the kept group had none for that profile version.
create or replace function public.jw_merge_jobs(p_keep text, p_alias text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_keep is null or p_alias is null or p_keep = p_alias then return; end if;
  update public.job_links set job_key = p_keep where job_key = p_alias;
  insert into public.job_links (dup_key, job_key) values (p_alias, p_keep)
    on conflict (dup_key) do update set job_key = excluded.job_key;
  update public.ai_verdicts v set dup_key = p_keep
   where v.dup_key = p_alias
     and not exists (select 1 from public.ai_verdicts w
                     where w.profile_id = v.profile_id and w.version = v.version and w.dup_key = p_keep);
  delete from public.ai_verdicts where dup_key = p_alias;
  update public.applications a set dup_key = p_keep
   where a.dup_key = p_alias and not exists (select 1 from public.applications b where b.dup_key = p_keep);
  -- both were marked: the kept job's entry stays, with the other one's note added to its own
  update public.applications k set note = left(concat_ws(e'\n\n', k.note, a.note), 10000), note_updated_at = now()
    from public.applications a
   where k.dup_key = p_keep and a.dup_key = p_alias and a.note is not null and a.note is distinct from k.note;
  delete from public.applications where dup_key = p_alias;
end $$;
--> statement-breakpoint

-- ---- scraping --------------------------------------------------------------------------------

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
--> statement-breakpoint

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
--> statement-breakpoint

create or replace function public.jw_source_counts()
returns table (src text, offers bigint, newest timestamptz)
language sql stable set search_path = '' as $$
  select o.src, count(*), max(o.first_seen) from public.offers o group by o.src
$$;
--> statement-breakpoint

-- Supabase Cron: calls the app on the schedule Settings makes (lib/scraping/cron.ts: the interval,
-- within the hours, in UTC) and is switched off while scraping is paused; the app still decides
-- whether a run is due. Called from Settings with the app's URL and secret, and again whenever the
-- interval, the hours, the time zone or the pause change (jw_cron_reschedule).
drop function if exists public.jw_cron_connect(text, text);
--> statement-breakpoint
create or replace function public.jw_cron_connect(p_url text, p_secret text, p_schedule text default '*/5 * * * *', p_active boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare
  id bigint;
begin
  if to_regnamespace('cron') is null then return 'pg_cron is not enabled (Supabase → Integrations → Cron)'; end if;
  if to_regnamespace('net') is null then return 'pg_net is not enabled (Supabase → Database → Extensions)'; end if;
  id := cron.schedule('jobwatch-scrape', p_schedule, format(
    'select net.http_get(url := %L, headers := jsonb_build_object(%L, %L), timeout_milliseconds := 20000)',
    p_url, 'Authorization', 'Bearer ' || p_secret));
  perform cron.alter_job(id, active := p_active);
  -- cron keeps every run's details forever; keep a week
  perform cron.schedule('jobwatch-cron-cleanup', '17 3 * * *',
    $c$delete from cron.job_run_details where end_time < now() - interval '7 days'$c$);
  return 'ok';
end $$;
--> statement-breakpoint

-- the connected job's new schedule, or off / on again; 'not connected' if there's none
create or replace function public.jw_cron_reschedule(p_schedule text, p_active boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  id bigint;
begin
  if to_regnamespace('cron') is null then return 'not connected'; end if;
  select j.jobid into id from cron.job j where j.jobname = 'jobwatch-scrape';
  if not found then return 'not connected'; end if;
  perform cron.alter_job(id, schedule := p_schedule, active := p_active);
  return 'ok';
end $$;
--> statement-breakpoint

create or replace function public.jw_cron_disconnect() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if to_regnamespace('cron') is null then return 'pg_cron is not enabled'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('jobwatch-scrape', 'jobwatch-cron-cleanup');
  return 'ok';
end $$;
--> statement-breakpoint

-- what Settings shows: is the job there, and how did its last call go (and what the app said)
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
    select r.status_code, r.error_msg, r.created, r.content into res
      from net._http_response r
     where r.content like '%"jobwatch"%' or r.error_msg is not null
     order by r.created desc limit 1;
    if found then
      out := out || jsonb_build_object('lastStatus', res.status_code, 'lastError', res.error_msg, 'lastAt', res.created);
      begin -- {"jobwatch": "skipped", "reason": "outside 7:00–22:00 …"} or "started"
        out := out || jsonb_build_object('lastResult', res.content::jsonb ->> 'jobwatch', 'lastReason', res.content::jsonb ->> 'reason');
      exception when others then null;
      end;
    end if;
  exception when others then null; -- no access to pg_net's table: show the job only
  end;
  return out;
end $$;
--> statement-breakpoint

-- ---- access: only the server's secret key (the CV lives here) -----------------------------------
-- RLS is on for every table with no policies (0001_baseline.sql): the anon / publishable key can't
-- read or write anything; the server's secret key bypasses RLS.

grant select, insert, update, delete on public.ai_profiles, public.ai_verdicts, public.ai_runs,
  public.offer_details, public.job_links, public.ai_dup_pairs, public.applications to service_role;
--> statement-breakpoint
grant select on public.offers to service_role;
--> statement-breakpoint
revoke all on public.offers_unique from anon, authenticated;
--> statement-breakpoint
grant select on public.offers_unique to service_role;
--> statement-breakpoint

revoke execute on function public.ai_results(uuid, integer) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.ai_pending(uuid, integer, timestamptz, timestamptz) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.ai_range_stats(uuid, integer, timestamptz, timestamptz) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.ai_dup_candidates(timestamptz, timestamptz, integer) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_merge_jobs(text, text) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_set_application_status(text, text, text) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_ghost_stale_applications(integer) from public, anon, authenticated;
--> statement-breakpoint
grant execute on function public.ai_results(uuid, integer) to service_role;
--> statement-breakpoint
grant execute on function public.ai_pending(uuid, integer, timestamptz, timestamptz) to service_role;
--> statement-breakpoint
grant execute on function public.ai_range_stats(uuid, integer, timestamptz, timestamptz) to service_role;
--> statement-breakpoint
grant execute on function public.ai_dup_candidates(timestamptz, timestamptz, integer) to service_role;
--> statement-breakpoint
grant execute on function public.jw_merge_jobs(text, text) to service_role;
--> statement-breakpoint
grant execute on function public.jw_set_application_status(text, text, text) to service_role;
--> statement-breakpoint
grant execute on function public.jw_ghost_stale_applications(integer) to service_role;
--> statement-breakpoint

grant select, insert, update, delete on public.scrapers, public.scrape_settings, public.scrape_state,
  public.scrape_runs, public.notify_queue to service_role;
--> statement-breakpoint
grant insert on public.offers to service_role;
--> statement-breakpoint
grant usage, select on all sequences in schema public to service_role;
--> statement-breakpoint

revoke execute on function public.jw_ingest_offers(jsonb) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_scrape_lock(integer) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_source_counts() from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_cron_connect(text, text, text, boolean) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_cron_reschedule(text, boolean) from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_cron_disconnect() from public, anon, authenticated;
--> statement-breakpoint
revoke execute on function public.jw_cron_status() from public, anon, authenticated;
--> statement-breakpoint
grant execute on function public.jw_ingest_offers(jsonb) to service_role;
--> statement-breakpoint
grant execute on function public.jw_scrape_lock(integer) to service_role;
--> statement-breakpoint
grant execute on function public.jw_source_counts() to service_role;
--> statement-breakpoint
grant execute on function public.jw_cron_connect(text, text, text, boolean) to service_role;
--> statement-breakpoint
grant execute on function public.jw_cron_reschedule(text, boolean) to service_role;
--> statement-breakpoint
grant execute on function public.jw_cron_disconnect() to service_role;
--> statement-breakpoint
grant execute on function public.jw_cron_status() to service_role;
--> statement-breakpoint

notify pgrst, 'reload schema';
