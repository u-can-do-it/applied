-- Withdrawn: an outcome of its own, your no (you pulled out, or declined an offer), so it isn't counted
-- as Rejected (they said no) nor left to be ghosted. Safe for the previous code: one more outcome allowed,
-- and none has it until the code that knows it is deployed. The Offer's Rejected, which meant you declined,
-- now means they took the offer back (Taken back), and you declining is Withdrawn (Declined). No row is
-- moved: there were no offers saved when this was written (2026-10-29), and moving one to 'withdrawn'
-- here would show the previous code an outcome it doesn't know.
ALTER TABLE "applications" DROP CONSTRAINT "applications_stage_state_check";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_stage_state_check" CHECK (stage_state in ('pending', 'passed', 'failed', 'ghosted', 'withdrawn'));