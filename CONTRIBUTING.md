# Contributing

Before you push: `npm run typecheck && npm run lint && npm test` (and `npm run test:db` when you touched the
database code or the migrations; it needs Docker).

## How to add a board

1. **The board:** `lib/boards/<id>.ts`, exporting a `Board` (`lib/boards/types.ts`). Copy the closest one,
   `.ts` in its imports included (the migration script reads the boards in plain Node).
   - `id` is what `offers.src` stores, `label` its name in the filters, `hosts` its domains;
   - `alwaysInFilters` puts it in the board filter from the start (otherwise once a scraper uses it);
   - `tagsLinks` when the board tags the links it sends you on (an employer's page with
     `?utm_source=<board>` then counts as the board's);
   - `idFromLink` when its job links show the offer's id (`linkIdIsOfferId: false` if its scraper saves
     another id), `cleanLink` when its links need their query (otherwise a board's link loses it);
   - a board Jobwatch scrapes also has a `listing`: the scraper kind's label and hint in Settings, the
     default search, and the `seeds` (the scrapers it comes with).
2. **Its parser** (a scraped board): `lib/listings/parsers/<id>.ts`, a `ListingParser` that turns one page
   into offers.
3. **Register it** in `lib/boards/index.ts`, at the end of `SCRAPED_BOARDS` if it is scraped (that order is
   Settings' list and the database's), else in `BOARDS`; a parser also goes in `lib/listings/registry.ts`.
4. **The database** (a scraped board): `npm run db:generate` writes the migration that lets its kind into
   `scrapers`. Its seeds need nothing: `npm run db:migrate` adds them once per database (`lib/db/seed.ts`).
5. **A fixture and a test:** record one listing page into `test/fixtures/` (how: `test/fixtures/README.md`),
   add a case for it to `test/lib/listings/parse.test.ts`, then
   `npx vitest run -u test/lib/listings/parse.test.ts` to write its snapshot. Read the snapshot: it is what
   the parser reads.
6. **Optionally, its ads:** an offer's text comes from its page's schema.org JobPosting. If the board's pages
   have none, or its API gives a better text, add a reader in `lib/ads/<id>.ts` and list it in `READERS` in
   `lib/ads/index.ts`.
