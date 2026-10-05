# 5. A board registry, one file per board; seeds from the registry, once per board

- Status: accepted (2026-10-03)
- Context: [CONTRIBUTING.md → How to add a board](../../CONTRIBUTING.md#how-to-add-a-board)

## Context

What Jobwatch knows about one board (its hosts, how its links show an offer id, its default search, its
parser, its ad reader, its seed scrapers, the database's list of kinds) is needed by the server, the browser,
the database and the migration script. Adding a board should mean one place to describe it, and its seed
scrapers should reach every database without a hand-written insert in a migration.

## Decision

- `lib/boards/<id>.ts` exports a `Board`: id, label, hosts, link rules, and for a scraped board its
  `listing` (Settings' label and hint, the default search, the `seeds`). `lib/boards/index.ts` lists them
  (`SCRAPED_BOARDS`, then link-only `BOARDS`). It is shared by the server and the browser, so it holds no
  parsers: those are in `lib/listings/parsers/<id>.ts` (`lib/listings/registry.ts`), ad readers in
  `lib/ads/<id>.ts`.
- The database's allowed scraper kinds follow the registry: `scrapers_kind_check` in `lib/db/schema.ts` is
  built from `KIND_IDS`, so a new board's migration is `npm run db:generate`.
- Seeds come from the registry: after the migrations, `npm run db:migrate` runs `seedBoards`
  (`lib/db/seed.ts`), which adds the seeds of every board without a `board:<id>` marker in `scrape_seeds`,
  and the marker, in one transaction (the marker first, so of two migrations at once only one seeds).
  `0004_board_seeds` adds the markers of the boards whose scrapers `0003_seed` adds.

## Consequences

- A new board's searches appear by themselves on every database at its next `db:migrate`; a seed you
  deleted doesn't come back, and editing a board's seeds later doesn't touch existing databases.
- The registry, `lib/listings/kinds.ts` and `lib/db/seed.ts` run in plain Node (the migration script,
  drizzle-kit), hence `.ts` in their imports.
- Order matters: `SCRAPED_BOARDS` is Settings' order and the order of the kinds in the check constraint, so
  a new board goes at the end.
