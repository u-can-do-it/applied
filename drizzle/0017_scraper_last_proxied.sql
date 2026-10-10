-- How a scraper's last run reached its board: the pages that came through ScrapingAnt (a board that
-- turns the server away, Eldorado; Settings says "fetched directly" or "through ScrapingAnt"). null: a run
-- from before it was counted. Written by `npm run db:generate` and made idempotent by hand (`if not exists`).
ALTER TABLE "scrapers" ADD COLUMN IF NOT EXISTS "last_proxied" integer;
