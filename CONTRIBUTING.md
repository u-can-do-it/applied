# Contributing

Before you push: `npm run typecheck && npm run lint && npm test` (and `npm run test:db` when you touched the
database code or the migrations; it needs Docker).

## Naming

- **The glossary's words** ([docs/GLOSSARY.md](docs/GLOSSARY.md)), one per idea: a _board_ (a site), a
  _scraper_ (one search on a board), an _offer_ (one posting on one board), a _job_ (the same position across
  boards), an _application_ (yours, per job), its _stage_ and _outcome_, a _profile_ and its _version_, a
  _verdict_, a _scrape run_ or an _AI run_. A job is identified by its `jobId`, an offer's company + title hash
  is its `titleKey`; "key", "copy" and "source" are not names for any of these.
- **The database keeps its names** (`dup_key`, `stage_state`…): a column is renamed in TypeScript by mapping it
  in `lib/db/schema.ts` (`jobId: text('dup_key')`), never by a migration. Anything stored outside the code
  (jsonb, `localStorage`, URLs) keeps its format; the glossary lists those.
- **No single-letter names.** A name says what the value is: `settings`, `scraper`, `offer`, `result`, `zone`,
  `draft`, `error`, `match`, never the first letter of them. The exceptions: `i`/`j` as a loop counter, `a`/`b`
  in a comparator or for the two sides of a pair, `_` for what's left out, and Zod's `z` (an import). A caught
  error is `error` (or `failure` where an `error` is already in scope), an event is `event`. ESLint's
  `id-length` enforces it (`npm run lint`).

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
