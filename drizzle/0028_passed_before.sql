-- Custom migration: the applications saved before lib/stages.ts passedBefore get what it adds now. At a
-- stage past Submitted (in progress, passed, rejected or ghosted; not the talent pool), the stages before
-- it whose last step isn't Passed get an automatic Passed: those before it in STAGES, even skipped ones,
-- except technical / HR (either order), which only if the history has them. They go right before the
-- current status (the last step, which stays last, so the status is the same), with its time.
-- Idempotent: a second run finds them passed. Safe for the previous code: an automatic step is one it
-- shows ("(auto)") and takes back like any other.
with stages (id, ord) as (
  values ('submitted', 0), ('invited', 1), ('screening', 2), ('technical', 3), ('hr', 4), ('offer', 5)
),
passed as (
  select a.dup_key,
         jsonb_agg(jsonb_build_object('stage', s.id, 'state', 'passed', 'at', a.history -> -1 -> 'at', 'auto', true)
                   order by s.ord) as steps
    from public.applications a
    join stages t on t.id = a.stage
    join stages s on s.id <> a.stage
   where a.stage <> 'submitted' and a.stage_state <> 'pool' and jsonb_array_length(a.history) > 0
     and coalesce((select h.e ->> 'state' from jsonb_array_elements(a.history) with ordinality h(e, n)
                    where h.e ->> 'stage' = s.id order by h.n desc limit 1), '') <> 'passed'
     and case when s.id in ('technical', 'hr')
              then a.stage in ('technical', 'hr', 'offer')
                   and exists (select 1 from jsonb_array_elements(a.history) e where e ->> 'stage' = s.id)
              else s.ord < t.ord end
   group by a.dup_key
)
update public.applications a
   set history = (a.history - -1) || p.steps || jsonb_build_array(a.history -> -1)
  from passed p
 where a.dup_key = p.dup_key;
