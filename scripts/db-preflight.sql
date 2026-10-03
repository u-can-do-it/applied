-- Read-only checks before the first `npm run db:migrate` on a database set up before Drizzle
-- (by supabase/*.sql and scripts/db-migrate.sh). Every row should say PASS; a FAIL says what the
-- migrations would do differently from a plain no-op there. Changes nothing (a read-only transaction).
--
--   docker run --rm -i postgres:17-alpine psql "$SUPABASE_DB_URL" -X -q < scripts/db-preflight.sql
--
-- (Supabase → SQL Editor works too: paste the select alone.)

begin transaction read only;

with view_ as (
  select c.oid, c.reltype from pg_class c where c.oid = to_regclass('public.offers_unique')
),
-- what 0002_functions drops and creates again around the view
allowed (name) as (values ('ai_results'), ('ai_pending'), ('ai_range_stats'), ('ai_dup_candidates')),
-- anything else that depends on the view: other views (through their rewrite rule), functions or
-- columns using its row type… `drop view` (no cascade) would fail on those and roll everything back
dependents as (
  select distinct
    case when d.classid = 'pg_rewrite'::regclass
         then 'view ' || (select r.ev_class::regclass::text from pg_rewrite r where r.oid = d.objid)
         else pg_describe_object(d.classid, d.objid, d.objsubid) end as what
  from pg_depend d, view_ v
  where d.deptype = 'n'
    and ((d.refclassid = 'pg_class'::regclass and d.refobjid = v.oid)
         or (d.refclassid = 'pg_type'::regclass and d.refobjid = v.reltype))
    -- the view's own rule
    and not (d.classid = 'pg_rewrite'::regclass
             and (select r.ev_class from pg_rewrite r where r.oid = d.objid) = v.oid)
    and not (d.classid = 'pg_proc'::regclass
             and exists (select 1 from pg_proc p join allowed a on a.name = p.proname
                         where p.oid = d.objid and p.pronamespace = 'public'::regnamespace))
),
-- a row count from a table that may not exist (null if it doesn't), without failing the query
counted (what, n) as (
  select 'scrape_seeds linkedin',
    case when to_regclass('public.scrape_seeds') is not null then
      (xpath('/row/n/text()', query_to_xml(
        'select count(*) as n from public.scrape_seeds where name = ''linkedin''', false, true, '')))[1]::text::int
    end
  union all
  select 'scrape_settings rows',
    case when to_regclass('public.scrape_settings') is not null then
      (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.scrape_settings', false, true, '')))[1]::text::int
    end
)
select case when ok then 'PASS' else 'FAIL' end as result, check_, detail
from (
  select 1 as n, (select n = 1 from counted where what = 'scrape_seeds linkedin') is true as ok,
         'scrape_seeds has linkedin' as check_,
         'else 0003_seed adds the two LinkedIn scrapers again' as detail
  union all
  select 2, (select n = 1 from counted where what = 'scrape_settings rows') is true,
         'scrape_settings has 1 row',
         'else 0003_seed adds the default settings and the six boards'
  union all
  select 3, to_regclass('public.ai_filter') is null,
         'no public.ai_filter (the first AI filter''s table)',
         'a database from before AI profiles: run the old supabase/ai-filter.sql first (git history)'
  union all
  select 4, exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'ai_verdicts' and column_name = 'dup_key'),
         'ai_verdicts has dup_key',
         'missing table, or the old per-copy ai_verdicts: run the old supabase/ai-filter.sql first (git history)'
  union all
  select 5, to_regnamespace('drizzle') is null,
         'no drizzle schema yet',
         'migrations already ran here: npm run db:migrate only applies the newer ones'
  union all
  select 6, not exists (select 1 from dependents),
         'nothing else depends on offers_unique',
         coalesce('depends on it: ' || (select string_agg(what, ', ') from dependents),
                  'else 0002_functions fails (and rolls back) on drop view')
) checks
order by n;

rollback;
