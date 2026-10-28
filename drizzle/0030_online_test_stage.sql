-- Online test: a stage of its own (it was one with Screening). Safe for the previous code: one more
-- stage allowed, and none has it until the code that knows it is deployed.
ALTER TABLE "applications" DROP CONSTRAINT "applications_stage_check";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_stage_check" CHECK (stage in ('submitted', 'invited', 'screening', 'test', 'technical', 'hr', 'offer'));