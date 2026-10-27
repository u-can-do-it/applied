-- Custom migration: the title key (public.jw_dup_key) drops a work mode at the end of the title: "(Remote)",
-- "- 100% zdalnie", "[Remote]", "| Remote", "– Fully Remote", "- Praca zdalna", "/ Hybrid", "- On-site",
-- several of them ("(Remote / Hybrid)"). Adzuna adds "(Remote)" to a remote job's title, so the same job
-- on NoFluff, Solid.jobs and Eldorado was a second job until an AI run's duplicate check paired them.
-- Only after a bracket or a separator, so "Remote Sensing Engineer" keeps its word, and never all of a
-- title. Gender tags go first, as before, so "… - Praca zdalna K/M" loses both.
--
-- Then the offers whose key changes get the new one, and each job such an offer belonged to is merged into
-- the job of its new key, as 0013_title_key_gender_tags.sql did (public.jw_merge_jobs moves the links,
-- verdicts, application, note, seen and archived marks since 0025). Idempotent: run again, no key changes.
-- Safe for the code before it: the key is the database's alone.
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
        case when work.stripped ~ '[a-z0-9]' then work.stripped else gender.stripped end,
        '\.js\y', '', 'g'),
      '[^a-z0-9]+', '', 'g')
  from (select regexp_replace(lower(public.jw_unaccent(title)),
          '\(\s*((nb|[kmfdxnwh])(\s*/\s*(nb|[kmfdxnwh])){1,3}|all genders?|any gender)\s*\)|\y(nb|[kmfdxnwh])(\s*/\s*(nb|[kmfdxnwh])){1,3}\y',
          ' ', 'g') as stripped) gender,
  lateral (select regexp_replace(gender.stripped,
          '(\s*(\(|\[|[-,|/–—])\s*(100\s*%\s*|fully\s+|full\s+|praca\s+)?(remote|zdalnie|zdalna|hybrid|hybrydowo|hybrydowa|on-?site|stacjonarnie)(\s*([/,+&]|or|lub|i)\s*(100\s*%\s*|fully\s+|full\s+|praca\s+)?(remote|zdalnie|zdalna|hybrid|hybrydowo|hybrydowa|on-?site|stacjonarnie))*\s*[)\]]?)+\s*$',
          '') as stripped) work
$$;
--> statement-breakpoint

do $$
declare
  rekey record;
  old_job text;
  new_job text;
begin
  -- the loop reads the keys as they were when it started: the updates inside don't change what it sees
  for rekey in
    select distinct o.dup_key as old_key, public.jw_dup_key(o.company, o.title) as new_key
    from public.offers o
    where o.dup_key is distinct from public.jw_dup_key(o.company, o.title)
    order by 1, 2
  loop
    -- a stored generated column is computed again on update
    update public.offers o set title = o.title
     where o.dup_key = rekey.old_key and public.jw_dup_key(o.company, o.title) = rekey.new_key;
    old_job := coalesce((select l.job_key from public.job_links l where l.dup_key = rekey.old_key), rekey.old_key);
    new_job := coalesce((select l.job_key from public.job_links l where l.dup_key = rekey.new_key), rekey.new_key);
    continue when old_job = new_job;
    -- old_job's offers that kept their key (or none) now point at new_job too
    perform public.jw_merge_jobs(new_job, old_job);
  end loop;
end $$;
