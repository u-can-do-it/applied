-- Custom migration: public.ai_dup_candidates leaves the archived jobs out. You decided on them, so the AI
-- doesn't spend a call on pairing one with a look-alike, and a reworded repost is listed as a job of its
-- own instead of being merged into the archived one and hidden with it. A repost with the same title key
-- is still the archived job's offer (that's the job's id, not the AI's call). Same function as
-- 0002_functions.sql plus the `not exists`. Idempotent: `create or replace`, the grants stay.
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

notify pgrst, 'reload schema';
