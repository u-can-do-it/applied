-- Custom migration: a repost is a job of its own when its job was first seen 30+ days before. Until now an
-- offer with a known title key was always that job's offer: a role reopened months later was folded into the
-- old job, never announced, and stayed hidden if that job was archived.
--
-- offers.repost: for such an offer, the day (UTC) its new job began; offers.job_key: the offer's job before
-- AI merges, its title key plus "~" + repost for a repost (generated, so a later change of public.jw_dup_key
-- keeps it in step). Every offer saved so far keeps its job: repost is null, job_key = dup_key. job_links
-- now points job keys at their job (the same values for every job before this).
-- public.jw_ingest_offers decides it per new offer: the title key's latest job (the one begun last), and
-- when the job it is part of after AI merges was first seen; 30+ days ago → a new job.
-- The AI's duplicate check pairs jobs first seen under 30 days apart (was 45): a reworded repost after
-- that is a new job too, and an exact one isn't merged back into the old.
-- Safe for the code before it: the function returns the same columns (dup_key holds the job key), the view
-- the same ones; until the deploy that code counts a repost's offer under its title key (Activity, the job
-- count). Idempotent: `if not exists`, `create or replace`.
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "repost" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "job_key" text GENERATED ALWAYS AS (public.jw_dup_key(company, title) || coalesce('~' || repost, '')) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_job_key_idx" ON "offers" USING btree ("job_key");--> statement-breakpoint

create or replace view public.offers_unique with (security_invoker = true) as
select src, id, title, company, seniority, remote, url, job_first_seen as first_seen, job_key as dup_key, sources,
       copies, company_key,
       (select a.applied_at from public.applications a where a.dup_key = x.job_key) as applied_at
from (
  select y.*,
    array_agg(y.src) over w as sources,
    jsonb_agg(jsonb_build_object('src', y.src, 'id', y.id, 'url', y.url)) over w as copies,
    row_number() over w as rn
  from (
    select o.src, o.id, o.title, o.company, o.seniority, o.remote, o.url, o.first_seen,
      coalesce(l.job_key, o.job_key) as job_key,
      split_part(o.dup_key, '|', 1) as company_key,
      min(o.first_seen) over (partition by coalesce(l.job_key, o.job_key)) as job_first_seen,
      o.src in ('eldorado', 'adzuna') as aggregated
    from public.offers o
    left join public.job_links l on l.dup_key = o.job_key
  ) y
  window w as (partition by y.job_key
               order by (y.aggregated and y.job_first_seen >= timestamptz '2026-10-08 17:00:00+00'),
                        y.first_seen, y.src, y.id
               rows between unbounded preceding and unbounded following)
) x
where rn = 1;
--> statement-breakpoint

-- Saves what a run found. Returns only the rows that were really new, each with its job key (in dup_key)
-- and whether that job was already known. The subqueries can't see the rows this statement inserts, so
-- "seen_before" means "before this run".
create or replace function public.jw_ingest_offers(p_rows jsonb)
returns table (src text, id text, dup_key text, seen_before boolean)
language sql set search_path = '' as $$
  with incoming as (
    select distinct on (x.src, x.id) x.src, x.id, coalesce(nullif(x.title, ''), '(no title)') as title,
           nullif(x.company, '') as company, nullif(x.seniority, '') as seniority, coalesce(x.remote, false) as remote,
           x.url
    from jsonb_to_recordset(p_rows) as x(src text, id text, title text, company text, seniority text, remote boolean, url text)
    where x.src is not null and x.id is not null and x.url is not null
  ),
  keyed as (select i.*, public.jw_dup_key(i.company, i.title) as title_key from incoming i),
  -- per known title key: its latest job (the one begun last) and when the job that's part of was first seen
  latest as (
    select c.title_key, c.repost,
           (select min(o.first_seen) from public.offers o
             where o.job_key = c.job_id
                or o.job_key in (select l.dup_key from public.job_links l where l.job_key = c.job_id)) as began
    from (
      select distinct on (o.dup_key) o.dup_key as title_key, o.repost,
             coalesce((select l.job_key from public.job_links l where l.dup_key = o.job_key), o.job_key) as job_id
      from public.offers o
      where o.dup_key in (select k.title_key from keyed k)
      group by o.dup_key, o.repost, o.job_key
      order by o.dup_key, min(o.first_seen) desc
    ) c
  ),
  ins as (
    insert into public.offers (src, id, title, company, seniority, remote, url, repost)
    select k.src, k.id, k.title, k.company, k.seniority, k.remote, k.url,
           case when j.began is null or j.began > now() - interval '30 days' then j.repost
                else to_char(now() at time zone 'UTC', 'YYYY-MM-DD') end
    from keyed k
    left join latest j on j.title_key = k.title_key
    on conflict (src, id) do nothing
    returning offers.src, offers.id, offers.job_key
  )
  select ins.src, ins.id, ins.job_key,
         exists (select 1 from public.offers o where o.job_key = ins.job_key) as seen_before
  from ins
$$;
--> statement-breakpoint

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
      and not exists (select 1 from public.archived_jobs x where x.dup_key = u.dup_key)
  ),
  pairs as (
    select distinct on (least(a.job_key, b.job_key), greatest(a.job_key, b.job_key))
      a.job_key as ka, b.job_key as kb, extensions.similarity(a.title_norm, b.title_norm) as sim
    from jobs a
    join jobs b
      on b.job_key <> a.job_key
     and b.first_seen > a.first_seen - interval '30 days' and b.first_seen < a.first_seen + interval '30 days'
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
            left join public.job_links l2 on l2.dup_key = o2.job_key
           where coalesce(l2.job_key, o2.job_key) = a.job_key limit 1),
         b.title, b.company, b.seniority, b.remote, b.src, b.first_seen,
         (select left(d.description, 700) from public.offers o2
            join public.offer_details d on d.src = o2.src and d.id = o2.id and d.status = 'ok'
            left join public.job_links l2 on l2.dup_key = o2.job_key
           where coalesce(l2.job_key, o2.job_key) = b.job_key limit 1)
  from top t
  join jobs a on a.job_key = least(t.ka, t.kb)
  join jobs b on b.job_key = greatest(t.ka, t.kb)
$$;
--> statement-breakpoint

notify pgrst, 'reload schema';
