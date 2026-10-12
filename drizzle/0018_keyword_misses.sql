-- LinkedIn's cards have no skills (lib/listings/pipeline/ad-check.ts): an offer whose title names no keyword
-- has its ad read for one, once; keyword_misses remembers the ones that named none, for those keywords. And
-- scrapers.last_complete_at, the last run that got every page and ad: {since} in a link looks back to an
-- hour before it (lib/listings/match.ts). Written by `npm run db:generate` and made idempotent by hand
-- (`if not exists`). RLS on with no policies, as every table.
CREATE TABLE IF NOT EXISTS "keyword_misses" (
	"src" text NOT NULL,
	"id" text NOT NULL,
	"keywords" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_misses_pkey" PRIMARY KEY("src","id")
);
--> statement-breakpoint
ALTER TABLE "keyword_misses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scrapers" ADD COLUMN IF NOT EXISTS "last_complete_at" timestamp with time zone;
