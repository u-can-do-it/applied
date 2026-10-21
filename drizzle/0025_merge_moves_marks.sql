-- Custom migration: public.jw_merge_jobs moves the seen and archived marks and your note on the job too.
-- Before, they stayed under the alias's id, which no list shows after the merge: an archived job came back
-- to the lists, an opened one lost its check mark, a note left the job's window. Same function as
-- 0002_functions.sql plus those moves: the kept job's own mark stays (its earlier time); both noted, the
-- two notes, the kept one's first (on its application, if it has one by then). Idempotent: `create or
-- replace`, the grants stay.
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
  -- seen or archived as either job: the kept one is
  insert into public.seen_jobs (dup_key, seen_at)
    select p_keep, s.seen_at from public.seen_jobs s where s.dup_key = p_alias
    on conflict (dup_key) do update set seen_at = least(public.seen_jobs.seen_at, excluded.seen_at);
  delete from public.seen_jobs where dup_key = p_alias;
  insert into public.archived_jobs (dup_key, archived_at)
    select p_keep, a.archived_at from public.archived_jobs a where a.dup_key = p_alias
    on conflict (dup_key) do update set archived_at = least(public.archived_jobs.archived_at, excluded.archived_at);
  delete from public.archived_jobs where dup_key = p_alias;
  -- the other one's note: on the kept job's application if it has one now (marking applied moves it there),
  -- else the kept job's note, added to its own
  update public.applications k set note = left(concat_ws(e'\n\n', k.note, n.note), 10000), note_updated_at = now()
    from public.job_notes n
   where k.dup_key = p_keep and n.dup_key = p_alias and n.note is not null and n.note is distinct from k.note;
  insert into public.job_notes (dup_key, note, note_updated_at)
    select p_keep, n.note, n.note_updated_at from public.job_notes n
     where n.dup_key = p_alias and not exists (select 1 from public.applications a where a.dup_key = p_keep)
    on conflict (dup_key) do update
      set note = left(concat_ws(e'\n\n', public.job_notes.note, excluded.note), 10000), note_updated_at = now()
      where excluded.note is distinct from public.job_notes.note;
  delete from public.job_notes where dup_key = p_alias;
end $$;
--> statement-breakpoint

notify pgrst, 'reload schema';
