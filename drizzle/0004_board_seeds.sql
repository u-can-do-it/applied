-- Custom migration: from here on a board's scrapers are seeded from the board registry (lib/boards/,
-- `listing.seeds`) by `npm run db:migrate` after the migrations (lib/db/seed.ts), once per board: a
-- marker `board:<id>` in scrape_seeds says it was done. The boards seeded so far (by 0003_seed.sql,
-- or by the SQL files before Drizzle) get their marker here, so their scrapers you deleted stay
-- deleted. Idempotent: each marker is inserted once.
insert into public.scrape_seeds (name)
values ('board:justjoin'), ('board:nofluff'), ('board:solidjobs'), ('board:bulldog'), ('board:eldorado'),
  ('board:builtin'), ('board:linkedin')
on conflict (name) do nothing;
