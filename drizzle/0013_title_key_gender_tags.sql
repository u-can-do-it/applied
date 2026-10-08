-- Custom migration: the title key (public.jw_dup_key) drops every gender tag the boards use, not only
-- k/m/f/d/x ones: "(k/m/n)", "(m/f/n)", "(m/w/d)", "(h/f)", "(M/F/NB)", up to four parts. Before,
-- "Software Developer (m/f/n)" kept an "n" in its key, so the same job on another board without the tag
-- was a second job.
--
-- Then the offers whose key changes get the new one (offers.dup_key is stored), and each job such an
-- offer belonged to is merged into the job of its new key (public.jw_merge_jobs: links, verdicts, the
-- application), its seen and archived marks copied over. Idempotent: run again, no key changes.
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
          '\(\s*((nb|[kmfdxnwh])(\s*/\s*(nb|[kmfdxnwh])){1,3}|all genders?|any gender)\s*\)|\y(nb|[kmfdxnwh])(\s*/\s*(nb|[kmfdxnwh])){1,3}\y',
          ' ', 'g'),
        '\.js\y', '', 'g'),
      '[^a-z0-9]+', '', 'g')
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
    insert into public.seen_jobs (dup_key, seen_at)
      select new_job, s.seen_at from public.seen_jobs s where s.dup_key = old_job
      on conflict (dup_key) do nothing;
    insert into public.archived_jobs (dup_key, archived_at)
      select new_job, a.archived_at from public.archived_jobs a where a.dup_key = old_job
      on conflict (dup_key) do nothing;
    -- old_job's offers that kept their key (or none) now point at new_job too
    perform public.jw_merge_jobs(new_job, old_job);
  end loop;
end $$;
