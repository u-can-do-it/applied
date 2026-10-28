-- Custom migration: the talent pool ("we'll keep your CV") is a mark on an application, not a status: its own
-- column, like the Rent-a-dev call. An application in it is ghosted after a year without news, not a month.
-- Those whose status was the talent pool get the mark and go back to In progress at the same stage; a
-- "pool" step in a history becomes In progress too (a stage moved on from that way counts as passed, as
-- before). Their stage_updated_at becomes now: the code before this ghosts In progress after a month and
-- doesn't know the mark, so until the deploy that keeps it from ghosting them (their year counts from now).
-- Idempotent: `if not exists` / `if exists`, and a second run finds no "pool".
ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "applications_stage_state_check";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "talent_pool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
update public.applications
   set talent_pool = true,
       stage_state = 'pending',
       stage_updated_at = now()
 where stage_state = 'pool';--> statement-breakpoint
update public.applications a
   set history = (select jsonb_agg(case when e ->> 'state' = 'pool' then jsonb_set(e, '{state}', '"pending"') else e end
                                   order by n)
                    from jsonb_array_elements(a.history) with ordinality h(e, n))
 where exists (select 1 from jsonb_array_elements(a.history) e where e ->> 'state' = 'pool');--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_stage_state_check" CHECK (stage_state in ('pending', 'passed', 'failed', 'ghosted'));
