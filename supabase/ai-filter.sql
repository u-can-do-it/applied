-- App tables: AI filter (profiles, runs, verdicts, scraped ad text, duplicates) and applications.
-- Supabase -> SQL Editor -> paste -> Run (or: scripts/db-migrate.sh). Safe to re-run.

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;   -- title similarity for AI duplicate candidates
-- the server key computes dup_key on insert (unaccent) and title similarity (pg_trgm) at query time;
-- Supabase grants this by default, a plain Postgres doesn't
grant usage on schema extensions to service_role;

-- ---- 1. one key per job, whichever board it came from --------------------------------------
-- Same rules as Node-RED's store_notifications: company without legal suffix / country,
-- title without gender tags and ".js"; accents and punctuation ignored.
create or replace function public.jw_unaccent(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))
$$;

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

alter table public.offers
  add column if not exists dup_key text generated always as (public.jw_dup_key(company, title)) stored;
create index if not exists offers_dup_key_idx on public.offers (dup_key, first_seen);

-- AI-confirmed duplicates whose keys differ ("Frontend Developer" vs "Front-end Engineer", "EPAM" vs
-- "EPAM Systems"): every key of a merged group points at the group's key (its earliest job).
create table if not exists public.job_links (
  dup_key    text        primary key,
  job_key    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists job_links_job_key_idx on public.job_links (job_key);

-- every pair the AI has looked at, so no pair is ever asked twice
create table if not exists public.ai_dup_pairs (
  key_a      text        not null,
  key_b      text        not null,
  same       boolean     not null,
  reason     text,
  model      text,
  decided_at timestamptz not null default now(),
  primary key (key_a, key_b),
  check (key_a < key_b)
);

-- jobs you applied to; a snapshot of title / company / link, so the entry survives the offer row,
-- plus the complete ad text and its details (salary, location, contract, dates) saved when marked
create table if not exists public.applications (
  dup_key        text        primary key,      -- the job (see offers_unique)
  src            text        not null,         -- the copy it was marked on
  id             text        not null,
  title          text        not null,
  company        text,
  url            text        not null,
  applied_at     timestamptz not null default now(),
  content        text,
  details        jsonb,
  content_status text        not null default 'pending' check (content_status in ('pending', 'ok', 'empty', 'failed')),
  content_error  text,
  scraped_at     timestamptz
);
create index if not exists applications_applied_at_idx on public.applications (applied_at desc);

-- where each application stands: the stage (submitted -> initial contact, id "invited" -> screening /
-- online test -> technical / hr -> offer) and its outcome; history keeps every change with its date
-- (for the timeline and the funnel)
alter table public.applications add column if not exists stage text not null default 'submitted';
alter table public.applications add column if not exists stage_state text not null default 'pending';
alter table public.applications add column if not exists stage_updated_at timestamptz;
alter table public.applications add column if not exists history jsonb not null default '[]';
alter table public.applications drop constraint if exists applications_stage_check;
alter table public.applications add constraint applications_stage_check
  check (stage in ('submitted', 'invited', 'screening', 'technical', 'hr', 'offer'));
alter table public.applications drop constraint if exists applications_stage_state_check;
alter table public.applications add constraint applications_stage_state_check
  check (stage_state in ('pending', 'passed', 'failed', 'ghosted'));
update public.applications
   set history = jsonb_build_array(jsonb_build_object('stage', 'submitted', 'state', 'pending', 'at', applied_at))
 where history = '[]'::jsonb;

-- your own notes about the application (recruiter's name, salary you asked for, next steps…)
alter table public.applications add column if not exists note text;
alter table public.applications add column if not exists note_updated_at timestamptz;
alter table public.applications drop constraint if exists applications_note_length;
alter table public.applications add constraint applications_note_length check (length(note) <= 10000);

-- one status change, appended to the history in the same statement
create or replace function public.jw_set_application_status(p_key text, p_stage text, p_state text) returns void
language sql set search_path = '' as $$
  update public.applications
     set stage = p_stage, stage_state = p_state, stage_updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('stage', p_stage, 'state', p_state, 'at', now()))
   where dup_key = p_key
$$;

-- No news for p_days since the last status change (or since applying): ghosted, at the same
-- stage. Only what still waits for an answer: in progress, or passed and waiting for the next step
-- (not an accepted offer). The history entry says it was automatic, so it can be taken back.
create or replace function public.jw_ghost_stale_applications(p_days integer) returns integer
language sql set search_path = '' as $$
  with stale as (
    update public.applications a
       set stage_state = 'ghosted',
           stage_updated_at = now(),
           history = a.history || jsonb_build_array(jsonb_build_object('stage', a.stage, 'state', 'ghosted', 'at', now(), 'auto', true))
     where (a.stage_state = 'pending' or (a.stage_state = 'passed' and a.stage <> 'offer'))
       and coalesce(a.stage_updated_at, a.applied_at) < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::integer from stale
$$;

-- derived objects are rebuilt on every run of this file (the functions below depend on the view)
drop function if exists public.ai_results(uuid, integer);
drop function if exists public.ai_pending(uuid, integer, timestamptz, timestamptz);
drop function if exists public.ai_range_stats(uuid, integer, timestamptz, timestamptz);
drop function if exists public.ai_dup_candidates(timestamptz, timestamptz, integer);
drop view if exists public.offers_unique cascade;

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

-- ---- 2. profiles: criteria text + optional file (CV), one is "active" ------------------------
create table if not exists public.ai_profiles (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  prompt       text        not null default '',
  file_name    text,
  file_text    text,                          -- text extracted from the uploaded PDF / TXT / MD
  version      integer     not null default 1,  -- bumped when prompt or file change
  last_used_at timestamptz not null default now(), -- the most recently used profile is the active one
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- the first version of this feature had a single filter: keep it as a profile
do $$
begin
  if to_regclass('public.ai_filter') is not null then
    insert into public.ai_profiles (name, prompt, file_name, file_text)
    select 'My profile', prompt, file_name, file_text from public.ai_filter
    where coalesce(prompt, '') <> '' or file_text is not null;
    drop table public.ai_filter;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'ai_verdicts' and column_name = 'src') then
    drop table public.ai_verdicts;
  end if;
end $$;

-- ---- 3. verdicts: per profile version and per job (not per copy) -----------------------------
create table if not exists public.ai_verdicts (
  profile_id      uuid        not null references public.ai_profiles (id) on delete cascade,
  version         integer     not null,
  dup_key         text        not null,       -- the job's key (see offers_unique)
  match           boolean     not null,       -- fits the profile's criteria
  score           integer     not null check (score between 0 and 100), -- skills fit, %
  summary         text,
  checks          jsonb       not null default '[]', -- [{ "item": "React 4+ yrs", "met": true }, ...]
  had_description boolean     not null default false, -- false = judged on the title only
  created_at      timestamptz not null default now(),
  primary key (profile_id, version, dup_key)
);

-- ---- 4. manual runs ("today", a date range): first duplicates, then the assessment -------------
create table if not exists public.ai_runs (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.ai_profiles (id) on delete cascade,
  version     integer     not null,
  label       text        not null,
  range_gte   timestamptz,
  range_lt    timestamptz,
  status      text        not null default 'running' check (status in ('running', 'done', 'failed', 'cancelled')),
  total       integer     not null default 0,
  done        integer     not null default 0,
  error       text,
  lock_until  timestamptz,                    -- one worker at a time
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.ai_runs add column if not exists phase text not null default 'dedup';
alter table public.ai_runs add column if not exists pairs_checked integer not null default 0;
alter table public.ai_runs add column if not exists merged integer not null default 0;
create index if not exists ai_runs_profile_idx on public.ai_runs (profile_id, created_at desc);

-- ---- 5. full ad text, scraped once per offer and reused by every profile ---------------------
create table if not exists public.offer_details (
  src         text        not null,
  id          text        not null,
  description text,
  status      text        not null check (status in ('ok', 'empty')),
  fetched_at  timestamptz not null default now(),
  primary key (src, id),
  foreign key (src, id) references public.offers (src, id) on delete cascade
);

-- ---- 6. queries the app calls (PostgREST RPC; filters/order/limit apply to their rows) -------
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

-- ---- 7. access: only the server's secret key (the CV lives here) -----------------------------
alter table public.ai_profiles enable row level security;
alter table public.ai_verdicts enable row level security;
alter table public.ai_runs enable row level security;
alter table public.offer_details enable row level security;
alter table public.job_links enable row level security;
alter table public.ai_dup_pairs enable row level security;
alter table public.applications enable row level security;

grant select, insert, update, delete on public.ai_profiles, public.ai_verdicts, public.ai_runs,
  public.offer_details, public.job_links, public.ai_dup_pairs, public.applications to service_role;
grant select on public.offers to service_role;
revoke all on public.offers_unique from anon, authenticated;
grant select on public.offers_unique to service_role;

revoke execute on function public.ai_results(uuid, integer) from public, anon, authenticated;
revoke execute on function public.ai_pending(uuid, integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.ai_range_stats(uuid, integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.ai_dup_candidates(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.jw_merge_jobs(text, text) from public, anon, authenticated;
revoke execute on function public.jw_set_application_status(text, text, text) from public, anon, authenticated;
revoke execute on function public.jw_ghost_stale_applications(integer) from public, anon, authenticated;
grant execute on function public.ai_results(uuid, integer) to service_role;
grant execute on function public.ai_pending(uuid, integer, timestamptz, timestamptz) to service_role;
grant execute on function public.ai_range_stats(uuid, integer, timestamptz, timestamptz) to service_role;
grant execute on function public.ai_dup_candidates(timestamptz, timestamptz, integer) to service_role;
grant execute on function public.jw_merge_jobs(text, text) to service_role;
grant execute on function public.jw_set_application_status(text, text, text) to service_role;
grant execute on function public.jw_ghost_stale_applications(integer) to service_role;

notify pgrst, 'reload schema';
