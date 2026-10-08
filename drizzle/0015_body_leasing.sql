-- The "Rent-a-dev" badge: whether a job is a software house's / body leasing firm's, hiring you out to a
-- client. The AI says it with every verdict (null: a verdict from before it was asked); an application
-- keeps the latest call on its job (a fit check's, or one made by hand). Written by `npm run db:generate`
-- and made idempotent by hand (`if not exists`).
ALTER TABLE "ai_verdicts" ADD COLUMN IF NOT EXISTS "body_leasing" boolean;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "body_leasing" boolean;
