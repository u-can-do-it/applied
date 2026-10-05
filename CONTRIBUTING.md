# Contributing

How the code is organised and the conventions it follows. How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Running it: [docs/OPERATIONS.md](docs/OPERATIONS.md). Why it's built this way: [docs/decisions/](docs/decisions).

Before you push: `npm run typecheck && npm run lint && npm run format:check && npm test` (and `npm run test:db`
when you touched the database code or the migrations; it needs Docker). Set up a local database first: the
[README's quick start](README.md#quick-start).

## Where things live

- **`app/`: routes only.** Pages, layouts, `error.tsx`, and `api/*/route.ts`. A page puts features together;
  what it renders lives in `features/`. A page's `maxDuration` covers its server actions and their `after()`
  work, so it's set where those need longer (the literal `300`: `test/lib/budgets.test.ts`). An operation that
  needs the time on its own is a route with its own `maxDuration`, like `POST /api/scrape` ("Scrape now").
- **`features/<feature>/`: one area of the app**, its components and its server actions (`actions.ts`, starting
  with `'use server'`, every action built with `action()` / `formAction()` from `server/action.ts`).
  `offers` (the lists, filters, Mark applied's button), `ai` (profiles, AI runs and their card), `applications`
  (the Applied tab, applying, the add/edit form), `scraping` (Settings: schedule, time zone, filters, scrapers,
  Supabase Cron, the "Scrape now" button), `notifications` (Settings → Notifications: push on this device, mute,
  the queue, the AI filter switch), `telegram` (its Settings panel), `health` (Settings' Health card),
  `activity` (the Activity tab: runs, scrapers' results, the queue, cron calls, AI runs), `login`, and `shell`
  (the header, tabs, auto-refresh, the service worker's registration). A feature imports another's module by its `@/features/…` path.
- **`components/`: pieces more than one feature uses** (`DateInput`, `TimeZone` / `useZone`, `useAction` for
  a button or a toggle, `useAppForm` for a form ([below](#forms)), `useConfirm()` for "are you sure?",
  `useReturnFocus()` for a dialog opened from code, `useAutosave()` for a field that saves itself,
  `useRefreshWhile()` for a page that refreshes while the server works, `Field` / `CheckField` / `Code`,
  `LoadError`, the search box's classes, `QueryProvider`). They import nothing from `features/`.
  **`components/ui/`** holds the shadcn/ui components, added with `npx shadcn@latest add <name>`
  (`components.json` says where things go) and then the repo's own code: edit them like any other file.
- **One component per file**, named after it, about 200 lines at most; a hook or helper that only it uses
  stays in its file. ESLint's `max-lines` (300, blank lines and comments not counted) stops a file growing
  into a god component.
- **Reading data:** server components, and server actions for every change. A read the browser repeats on
  its own (an application's ad text while it's fetched, AutoRefresh's "anything new?") is a TanStack Query
  `useQuery` with its `refetchInterval`; a page whose server-rendered data moves while the server works
  (pending ad texts in the list, an AI run) uses `useRefreshWhile()` instead, since the refresh is what
  brings that data.
- **`server/`: the request's gate.** The login cookie (`auth.ts`), `requireLogin()` (`session.ts`) and the
  action wrapper (`action.ts`: login, the input checked against its Zod schema, a `Result` instead of a throw).
- **`lib/`: what the app knows, without the UI.** Boards, listings and the scrape pipeline, ads, AI, the
  database (`lib/db/`: schema and one repo per table), dates, Telegram. Server-only modules start with
  `import 'server-only'`. Queries go in `lib/db/repos/`; the rules on top of them (which copy an application
  keeps, when its date may move, profile versions…) stay in the services (`lib/applications.ts`, `lib/ai/`,
  `lib/listings/`). A lifecycle with more than two states is a typed `transition(state, event)` with an
  exhaustive `switch`, like `lib/ad-content-state.ts` and `lib/ai/run-state.ts`.
- **`lib/shared/`: what client components may import, guaranteed** (errors, `Result`, formatting, URL filters,
  the Zod schemas the actions and their forms check the input with, `cn()` for class names). Nothing in it
  reads the database or a secret. Other `lib/` modules without `import 'server-only'` (e.g. `lib/dates.ts`,
  `lib/stages.ts`) may be imported by client components too; check that line first.
- **Configuration** is read through `env` from `lib/env.ts`, never `process.env`: a new variable goes into its
  schema (with its default), `.env.example` and [OPERATIONS.md](docs/OPERATIONS.md#environment-variables).
- **Imports:** `app/`, `features/`, `components/` and `server/` use `@/…`, except between files of the same
  folder (`./…`). `lib/` uses relative paths within itself (`../db/…`), and `.ts` in them where a script runs
  the module in plain Node. Client components start with `'use client'`.

## Naming

- **The glossary's words** ([ARCHITECTURE.md → Glossary](docs/ARCHITECTURE.md#glossary)), one per idea: a
  _board_ (a site), a _scraper_ (one search on a board), an _offer_ (one posting on one board), a _job_ (the
  same position across boards), an _application_ (yours, per job), its _stage_ and _outcome_, a _profile_ and
  its _version_, a _verdict_, a _scrape run_ or an _AI run_. A job is identified by its `jobId`, an offer's
  company + title hash is its `titleKey`; "key", "copy" and "source" are not names for any of these.
- **The database keeps its names** (`dup_key`, `stage_state`…): a column is renamed in TypeScript by mapping it
  in `lib/db/schema.ts` (`jobId: text('dup_key')`), never by a migration. Anything stored outside the code
  (jsonb, `localStorage`, URLs) keeps its format; the glossary lists those.
- **No single-letter names.** A name says what the value is: `settings`, `scraper`, `offer`, `result`, `zone`,
  `draft`, `error`, `match`, never the first letter of them. The exceptions: `i`/`j` as a loop counter, `a`/`b`
  in a comparator or for the two sides of a pair, `_` for what's left out, and Zod's `z` (an import). A caught
  error is `error` (or `failure` where an `error` is already in scope), an event is `event`. ESLint's
  `id-length` enforces it (`npm run lint`).
- **Files** are kebab-case and named after their one component, hook or subject (`application-sheet.tsx`,
  `use-autosave.ts`, `run-state.ts`); a board's files are named by its id in each folder.
- **Comments** say why, not what, and sparingly. A file starts with what it is for when that isn't obvious.

## Forms

TanStack Form with the server action's own schema ([ADR 0006](docs/decisions/0006-tanstack-form-zod-mini-lazy-forms.md)):

- `useAppForm` (`components/form.tsx`) with its fields
  (`<form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>`, which wire the
  label, the hint, the error, `aria-invalid` and `aria-describedby`), checked with the schema of the action it
  calls (`validators: { onDynamic: formSchema(schema) }`, `validationLogic: checkOnSubmit`: on Save, then on
  every change).
- The schemas are in `lib/shared/schemas/`, written with `zod/mini` (`import * as z from 'zod/mini'`: functions,
  not methods, so a page gets only what it uses); import one from a form, and where only a message is wanted,
  the message (`application-messages.ts`). A message the user sees is worded in the schema.
- A form that's on the page from the start (Settings) loads its schema on the first check instead:
  `onDynamicAsync: lazySchema(() => import(…))`; if it can't be loaded, the form says so rather than save
  unchecked. It follows the refreshed page while it still shows the old values (`useFollowServer`).
- When the form's values aren't the schema's input, a validator maps them: the scraper editor checks
  `toForm(values)` with the action's schema and puts each problem at its field (`scraperErrors`).
- What the server answers goes through `answered(form, action(…), { success })`: the toast `success` words
  from the answer, if given; what went wrong in `<FormError>` by the button.
- Enter: a short form (Settings, a `Dialog`) saves on Enter. A long form in a `Sheet` doesn't
  (`onKeyDown={noImplicitSubmit}`): Save, which closes it, is a click. A box can give Enter its own job
  (the link reads the page, a date commits).
- A form shown only on a click (a `Sheet`, a `Dialog`) is `lazy()`-loaded inside `<LazyForm>`
  (`components/lazy-form.tsx`: its header and grey fields while it loads, a message if it can't), so the
  page doesn't carry the form library and zod until then.

## Styling

Tailwind v4 and shadcn/ui ([ADR 0007](docs/decisions/0007-shadcn-ui-and-tailwind-v4.md)):

- The colours are tokens in `app/globals.css` (shadcn's names: `background`, `foreground`, `card`, `primary`,
  `muted`, `destructive`, `border`, `ring`…, plus the app's own `brand`, `success`, `warning`, `pool`), one
  light set and one dark set that follows the system: use `bg-card`, `text-muted-foreground`,
  `text-destructive` and the like, never a colour of its own and never a `dark:` colour.
- Styling is utility classes on the element; `globals.css` keeps only the tokens, the base rules and the
  page's column (`.wrap`).
- A success ("Saved.") is a `sonner` toast (`toast`, or `useAction`); what went wrong, which you have to read
  or act on, is an inline `Alert` next to the control (`useAction` and `<ActionError>`) until the next try.
- A destructive step asks with `useConfirm()`, never `confirm()`.
- A window is a shadcn `Dialog` (short forms) or `Sheet` (a long form or a page about one thing), with
  `onInteractOutside={keepOpenOnToast}` (`components/toasts.ts`) so a click on a toast doesn't close it.
- Icons are `lucide-react` (`<CheckIcon />`): an icon is hidden from screen readers unless you give it an
  `aria-label`, and an icon-only button needs one.

## Logging and outbound requests

- What goes wrong on the server is logged with `log.error/warn/info(message, context)` (`lib/log.ts`: one
  JSON line, secrets redacted), not `console`. Put the ids in the context (`runId`, `scrapeRunId`, `scraper`,
  `jobId`, `route`) and the error under `error`; never build a secret into the message. Anything in `after()`
  must catch and log its own failure: nobody else sees it.
- A request to a link from a user or a page goes through `fetchOutbound()` and its body through `readText()`
  (`lib/outbound.ts`, the [SSRF checks](docs/OPERATIONS.md#ssrf-policy)). Plain `fetch` only for services the
  environment configures (Telegram, OpenAI); push goes through `web-push` to the push service the browser chose
  (`lib/push.ts`: https only, with a timeout).
- A page is read with `parsePage()` (`lib/dom.ts`) or, for a feed, `fast-xml-parser`, not regular expressions.

## The database

- Change a table in `lib/db/schema.ts`, then `npm run db:generate`, **read the migration**, make it
  idempotent like the others (`if not exists`, `on conflict do nothing`), and commit it with the change. SQL
  Drizzle can't express goes into a custom migration (`npm run db:generate -- --custom --name=what`).
- Apply it with `npm run db:migrate` to a local database; never `drizzle-kit push`. After changing a migration,
  `npm run db:check` and `npm run db:verify`.
- A deploy with a new migration needs `npm run db:migrate` on production ([OPERATIONS.md](docs/OPERATIONS.md#database)).
- Timestamps are strings, ISO 8601 with microseconds (`2026-10-03T12:34:56.123456+00:00`, `lib/db/client.ts`):
  they go to the browser as they are, `lib/dates.ts` parses them, and one read back in
  a `where` (a note's `note_updated_at`) matches to the microsecond.

## How to add a board

1. **The board:** `lib/boards/<id>.ts`, exporting a `Board` (`lib/boards/types.ts`). Copy the closest one,
   `.ts` in its imports included (the migration script reads the boards in plain Node).
   - `id` is what `offers.src` stores, `label` its name in the filters, `hosts` its domains, each a
     `(^|\.)domain$` pattern (`test/lib/boards/registry.test.ts` checks that, and that no two boards claim one);
   - `alwaysInFilters` puts it in the board filter from the start (otherwise once a scraper uses it);
   - `tagsLinks` when the board tags the links it sends you on (an employer's page with
     `?utm_source=<board>` then counts as the board's);
   - `idFromLink` when its job links show the offer's id (`linkIdIsOfferId: false` if its scraper saves
     another id), `cleanLink` when its links need their query (otherwise a board's link loses it);
   - a board Jobwatch scrapes also has a `listing`: the scraper kind's label and hint in Settings, the
     default search, and the `seeds` (the scrapers it comes with); `minutesPerCall` when its API has a quota
     of calls (`lib/listings/quota.ts` then runs its scrapers as often as their calls allow). What its API
     needs in every link (an API key, read from a variable of its own) goes in `lib/listings/api-params.ts`,
     never in the link.
2. **Its parser** (a scraped board): `lib/listings/parsers/<id>.ts`, a `ListingParser` that turns one page
   into offers, with a `sort` value if the board has a date or a counter (it becomes the scraper's mark).
3. **Register it** in `lib/boards/index.ts`, at the end of `SCRAPED_BOARDS` if it is scraped (that order is
   Settings' list and the database's), else in `BOARDS`; a parser also goes in `PARSERS` in
   `lib/listings/registry.ts` (`npm run typecheck` says if it's missing).
4. **The database** (a scraped board): `npm run db:generate` writes the migration that lets its kind into
   `scrapers`. Its seeds need nothing: `npm run db:migrate` adds them once per database (`lib/db/seed.ts`,
   [ADR 0005](docs/decisions/0005-board-registry-and-seeds.md)).
5. **A fixture and a test:** record one listing page into `test/fixtures/` (how:
   [test/fixtures/README.md](test/fixtures/README.md)), add a case for it to
   `test/lib/listings/parse.test.ts`, then `npx vitest run -u test/lib/listings/parse.test.ts` to write its
   snapshot. Read the snapshot: it is what the parser reads.
6. **Optionally, its ads:** an offer's text comes from its page's schema.org JobPosting. If the board's pages
   have none, or its API gives a better text, add a reader in `lib/ads/<id>.ts` and list it in `READERS` in
   `lib/ads/index.ts`.

## Tests

Vitest; the tests are in `test/`, mirroring the source tree (`test/lib/…`, `test/features/…`). `server-only`
is stubbed and `@/` resolves as in `tsconfig.json` (`vitest.config.ts`). Tests run in Node; a component test
starts with `// @vitest-environment jsdom` and uses Testing Library.

| Command                                             | What                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                          | Every test. The database tests (`test/db/`) are skipped without `TEST_DATABASE_URL`.                                                                                                                                                                           |
| `npx vitest run test/lib/dates.test.ts`             | One file; `npx vitest` watches.                                                                                                                                                                                                                                |
| `npm run test:db`                                   | The database tests: starts a `supabase/postgres` container, migrates it with `npm run db:migrate` (`DOTENV=0`, so `.env` isn't read), runs `test/db/` one file at a time, removes it. They refuse anything but localhost: they empty the tables. Needs Docker. |
| `scripts/test-db.sh <local url>`                    | The same against an empty local database you started (what CI does).                                                                                                                                                                                           |
| `npm run db:verify`                                 | The migrations against two throwaway databases: pre-Drizzle set-up → migrated is unchanged, empty → same schema, every migration twice, `schema.ts` agrees. Needs Docker and the full git history.                                                             |
| `npx vitest run -u test/lib/listings/parse.test.ts` | Rewrites the parser snapshots; read the diff. Re-recording the board fixtures: [test/fixtures/README.md](test/fixtures/README.md).                                                                                                                             |

Pure modules get unit tests (the pipeline's pure steps, the state machines, dates, matching, the Health
checks); whatever needs SQL goes in `test/db/` against a real database, not a mock. A test never calls a real
board, Telegram or OpenAI: stub `fetch` or the module.

## CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) on every push to `main` and every pull
request, with the Node version from `.nvmrc`:

- **check:** `npm ci`, `npm run typecheck`, `npm run lint` (no warnings allowed), `npm run format:check`,
  `npm test`, `npm run build` (no secrets: nothing reads the database or the env while building);
- **db:** the database tests against a `supabase/postgres` service container (`scripts/test-db.sh <url>`).

Prettier formats code and Markdown (`.prettierignore` leaves out `drizzle/`, `supabase/`, the fixtures and
snapshots): `npm run format` writes, `npm run format:check` only checks.

## Commits and pull requests

- Work on a branch and open a pull request to `main`; CI must pass.
- A commit is one coherent change that builds and passes its tests. Its subject says what changed as an
  outcome, often with its area first (`Board registry: one file per board; listings and ads split`,
  `Applied: remove a status step clicked by mistake`); the body is a short list of what changed and why, with
  `fix:` for a bug fixed on the way.
- Keep docs in the same change: a new env var in OPERATIONS.md, a new table or lifecycle in ARCHITECTURE.md, a
  non-obvious choice as a new ADR in `docs/decisions/` (next number; context, decision, consequences).
