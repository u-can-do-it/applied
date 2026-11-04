-- Custom migration: the AI's duplicate check also pairs look-alike jobs first seen 30 to 180 days apart, to find
-- a reworded repost's earlier job. Such a pair the model calls the same is not merged (a repost is a job of its
-- own, 0029_repost_own_job.sql): its "same" verdict in ai_dup_pairs links the two, and the later one's row shows
-- a repost badge that opens the earlier one (lib/db/repos/reposts.ts). An exact repost needs no AI to find its
-- earlier job (the same title key), so a pair with one title key isn't asked. An archived job is paired only
-- that far apart: never merged, as before, but a repost of a job you archived still points at it.
--
-- public.ai_dup_candidates takes how far apart (p_max_days), 30 by default: the code before this calls it
-- with three arguments and merges every pair the model calls the same, so until the deploy it gets the pairs
-- it got before. Its old signature goes (a fourth argument with a default would make a three-argument call
-- ambiguous), with its grant; the new one's is revoked as the old one's was. Idempotent: `if exists`,
-- `create or replace`.
drop function if exists public.ai_dup_candidates(timestamptz, timestamptz, integer);
--> statement-breakpoint

create or replace function public.ai_dup_candidates(p_gte timestamptz default null, p_lt timestamptz default null,
                                                    p_limit integer default 60, p_max_days integer default 30)
returns table (key_a text, key_b text, sim real,
               a_title text, a_company text, a_seniority text, a_remote boolean, a_src text, a_first_seen timestamptz, a_excerpt text,
               b_title text, b_company text, b_seniority text, b_remote boolean, b_src text, b_first_seen timestamptz, b_excerpt text)
language sql stable set search_path = '' as $$
  with jobs as (
    select u.dup_key as job_key, u.company_key, u.title, u.company, u.seniority, u.remote, u.src, u.first_seen,
           lower(public.jw_unaccent(u.title)) as title_norm,
           exists (select 1 from public.archived_jobs x where x.dup_key = u.dup_key) as archived
    from public.offers_unique u
    where u.company_key <> ''
  ),
  pairs as (
    select distinct on (least(a.job_key, b.job_key), greatest(a.job_key, b.job_key))
      a.job_key as ka, b.job_key as kb, extensions.similarity(a.title_norm, b.title_norm) as sim
    from jobs a
    join jobs b
      on b.job_key <> a.job_key
     and b.first_seen > a.first_seen - make_interval(days => p_max_days)
     and b.first_seen < a.first_seen + make_interval(days => p_max_days)
     -- under 30 days apart they'd be merged: never an archived job
     and ((not a.archived and not b.archived)
          or b.first_seen <= a.first_seen - interval '30 days' or b.first_seen >= a.first_seen + interval '30 days')
     and split_part(a.job_key, '~', 1) <> split_part(b.job_key, '~', 1)
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

revoke execute on function public.ai_dup_candidates(timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
--> statement-breakpoint

notify pgrst, 'reload schema';
