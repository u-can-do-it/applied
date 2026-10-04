-- The browsers that get push notifications (lib/db/repos/push-subscriptions.ts), written by
-- `npm run db:generate` and made idempotent by hand (`if not exists`). RLS on with no policies, as
-- every table: Supabase's public API can't read the subscriptions.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
