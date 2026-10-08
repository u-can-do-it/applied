-- Custom migration: a job on an aggregator (Eldorado, Adzuna: boards whose offers are other boards',
-- lib/boards/ `aggregator`) and on a board of its own takes its details from the board of its own: the
-- title, company and link the lists show, and the offer tried first for its ad text (copies' order).
-- Only for jobs first seen from this migration on (the cutoff below): the ones before keep their
-- earliest offer, as they were shown. A job is still dated by its earliest offer, whichever stands for it.
-- The columns are the same, so `create or replace` keeps the view's grants.
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
      coalesce(l.job_key, o.dup_key) as job_key,
      split_part(o.dup_key, '|', 1) as company_key,
      min(o.first_seen) over (partition by coalesce(l.job_key, o.dup_key)) as job_first_seen,
      o.src in ('eldorado', 'adzuna') as aggregated
    from public.offers o
    left join public.job_links l on l.dup_key = o.dup_key
  ) y
  window w as (partition by y.job_key
               order by (y.aggregated and y.job_first_seen >= timestamptz '2026-10-08 17:00:00+00'),
                        y.first_seen, y.src, y.id
               rows between unbounded preceding and unbounded following)
) x
where rn = 1;
