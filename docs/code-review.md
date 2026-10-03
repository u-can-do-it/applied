# Jobwatch Code Review

*3 October 2026*

What to change so that someone who did not write Jobwatch can read it, extend it and trust it. Ordered by what unblocks the most further work.

| | |
|---|---|
| Source files | 60 |
| Lines (TS/TSX/SQL/CSS) | ≈10,300 |
| Tests | 0 |
| Lint rules | 0 |
| CI jobs | 0 |
| Runtime dependencies | 6 |
| Typecheck | passes |

---

## Verdict

The app is carefully written and clearly works. The individual functions are competent, security is taken seriously, and the comments explain intent. The problem is not quality of lines but **absence of structure above the line**: knowledge about one concept (a job board, an application's status, a scrape run) is spread across five or six files, every module re-invents the same small things (error messages, PostgREST quoting, dialogs, input validation), and nothing but the author's memory checks that a refactor is safe. The README is effectively the architecture document, and it is 200 lines of prose that the UI then repeats inside Settings.

For a solo developer this is fine. For a second developer, or for you in a year, it is the kind of codebase where every change requires re-reading half the project. The recommendations below aim at one outcome: *a new concept has one obvious home, a new board is one file, and a change is verified by running one command.*

| Area | State today | Priority |
|---|---|---|
| Tests, lint, CI | None. Typecheck is the only automated check. | **High** |
| Data access | Hand-built PostgREST URLs, quoting written four times, row types maintained by hand. Recommended: Drizzle ORM. | **High** |
| Module layout | Flat `app/` with 25 files; "board" knowledge in 6 files; two different "scrape" modules. | **High** |
| UI components | Everything hand-made: four dialogs, date picker, tooltip, 692-line list component, polling via refs. Recommended: shadcn/ui. | **High** |
| Input validation | Bespoke per action; four different result shapes. | Medium |
| Naming | 182 single-letter variables; `s` means settings, scraper, string or source depending on the file. | Medium |
| Understandability of the product | Settings explains itself in paragraphs; inconsistent terms; AI run lifecycle is opaque. | Medium |
| Background work | AI runs continue only while a browser tab is open. | Medium |
| Security, auth, SSRF guard | Good. Keep as is. | Keep |
| Type safety | Strict TS, no `any`. Keep. | Keep |

---

## What to keep

Refactoring is easier when the good parts are named, so they survive it.

- **Server/client split.** `server-only` imports on every module with secrets; client components only receive plain data.
- **Security posture.** HMAC cookie, constant-time compare, fail-closed in production, SSRF guard on scraper URLs, webhook secret, RLS with no public policies.
- **Idempotent SQL.** Every migration can be re-run. Keep that property when moving to versioned migrations.
- **"Why" comments.** Comments explain the reason for a decision, not what the line does. Keep that style; move the longer ones into docs.
- **Optimistic UI.** `useOptimistic` + transitions make the app feel instant. Keep the pattern, centralise it.
- **Pure helpers already isolated.** `match.ts`, `stages.ts`, `boards.ts`, `cron.ts` have no I/O. They are ready for unit tests.
- **Accessibility.** aria roles, live regions and keyboard focus are already considered.
- **Scraper test mode.** "Test" in Settings showing raw samples is a genuinely good debugging tool.

---

## 1 · Foundation

### No automated tests — High

About a third of the code is pure logic with tricky edge cases: time zones and DST in `dates.ts`, word-boundary matching in `match.ts`, ten board parsers, statistics in `stages.ts`, link normalisation in `boards.ts`, the UTC hour expansion in `cron.ts`, Telegram message batching, the six-way branching in `updateApplication`. None of it is tested. Scrapers also break silently whenever a board changes its markup, and today the only way to notice is the Settings page.

**Do:** add Vitest. Start with pure modules (one afternoon gets 60% of the value): `dates`, `match`, `boards`, `stages`, `cron`, `telegram.formatNotification`, `scrape.htmlToText`. Then record one real response per board into `test/fixtures/` and assert the parsed output, so a parser change is visible in a diff. Add a `npm test` script.

### No linter, formatter or CI — High

Formatting is manual (lines reach 220 characters), unused imports are not caught, and nothing runs on push. The repository has no `.github/`, no ESLint config, no Prettier config.

**Do:** `eslint` with `eslint-config-next` and `typescript-eslint` (strict, type-checked), Prettier at `printWidth: 120`, and one GitHub Actions workflow running `typecheck`, `lint`, `test` and `build` on every push. Optionally `lefthook` for a pre-commit format.

### Configuration is read from `process.env` in twelve places — Medium

`OPENAI_*`, `TELEGRAM_*`, `SUPABASE_*`, `APP_PASSWORD`, `CRON_SECRET`, `VERCEL_PROJECT_PRODUCTION_URL` are each read where they are used, with the defaults repeated. `TELEGRAM_API_URL` is used but missing from `.env.example`. There is no single place to see what the app needs to run.

**Do:** one `lib/env.ts` that parses `process.env` once with a Zod schema (or `@t3-oss/env-nextjs`), applies defaults, and exports a typed `env` object. Fail at boot with a readable message instead of at first use.

---

## 2 · Data layer

### A hand-rolled PostgREST client with string-built filters — High

`lib/supabase.ts` is 50 lines and every other module composes URLs like `url.searchParams.set('dup_key', \`eq.${key}\`)`. Escaping of values inside `in.(…)` and `or=(…)` is written four separate times (`pgQuote` in `ai-runs.ts`, `q` in `applications.ts`, `quote` in `store.ts`, inline in `knownIds`). Row types (`Row`, `Pending`, `OfferRow`, `Application`, `Scraper`, `RunRow`, `Queued`) are hand-maintained mirrors of the SQL and drift silently. Response parsing (`Content-Range`, `Prefer` headers) is repeated.

**Do:** adopt **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`, `postgres` driver) over a direct Postgres connection to Supabase. It fits this app better than `@supabase/supabase-js` for three reasons:

- **The schema already needs real SQL.** A window-function view (`offers_unique`), a generated column (`dup_key`), `pg_trgm` similarity, upserts, and nine `jw_*` functions. PostgREST can only call these as opaque RPCs; Drizzle lets you keep them as SQL (the `sql` tag, custom migration files) *and* write ordinary queries with typed tables, joins and transactions. Several RPCs (`jw_set_application_status`, `jw_ghost_stale_applications`, `jw_scrape_lock`) become plain Drizzle transactions in TypeScript, where they are testable.
- **One source of truth.** Tables are declared in `lib/db/schema.ts`; row types are inferred (`typeof offers.$inferSelect`), not generated and committed. `drizzle-kit generate` turns schema changes into versioned migration files, replacing the loose SQL files and the Docker `psql` script.
- **Everything that touches the database is server-side Node.** Route handlers, server actions and `after()` callbacks. `proxy.ts` never queries the database. So a pooled Postgres connection is fine: use Supabase's transaction pooler (port 6543) with `postgres(url, { prepare: false, max: 1 })` per serverless instance. `SUPABASE_DB_URL` already exists for the scripts; it becomes the app's connection too, and `SUPABASE_SECRET_KEY` goes away.

**When `supabase-js` would be the better pick instead:** if you wanted to run queries on the Edge runtime, avoid holding any database connection, or use Supabase Auth, Storage or Realtime. None of those apply here. It remains a fine lighter option (`.eq()`, `.in()`, `.rpc()`, generated types via `supabase gen types`) if you would rather not manage a connection string on Vercel; the quoting helpers disappear either way.

Whichever you choose, record the reason in a short ADR, since the current direct-PostgREST code was itself a deliberate choice.

### Migrations are loose files applied through Docker — Medium

`schema.sql`, `ai-filter.sql`, `scraping.sql`, `reset.sql` and a 576-line one-off `remove-duplicates.sql` sit side by side. Nothing records which ran. The code carries fallbacks for a half-migrated database (`viewMissing` in `offers.ts`, try/catch in `source-list.ts` and `time-zone.ts`), which is extra paths to read and test for a state the app should simply refuse to run in.

**Do:** versioned migrations generated by `drizzle-kit` from the schema file (one consolidated baseline, then one file per change; views, functions and the `pg_cron` setup go in custom SQL migrations alongside), applied with `drizzle-kit migrate` and tracked in its migrations table. If you pick `supabase-js` instead, the Supabase CLI (`supabase/migrations/`, `supabase db push`) gives the same discipline. Either way: a `/api/health` or Settings health card that says "database schema is behind" instead of silently degrading. Delete the fallbacks. Move `remove-duplicates.sql` to `supabase/scripts/` with a header explaining when it was used, or delete it.

### Full counts on the de-duplicating view — Low

`getTotalCount` and every filtered page issue `count=exact` on `offers_unique`, a window-function view over the whole table. Cheap today, linear as the table grows.

**Do:** `count=estimated` for the headline number, or cache the total per request; keep `exact` only where the pager needs it.

---

## 3 · Domain and structure

### Knowledge about a board lives in six files — High

To understand what "JustJoin" means you read `lib/sources.ts` (label), `lib/source-list.ts` (label again plus `BOARD_NAMES`), `lib/boards.ts` (host regex, id from link, link cleaning), `lib/scraping/kinds.ts` (default search URL, parser kind), `lib/scraping/parsers.ts` (listing parser), `lib/scrape.ts` (ad-text fetcher and a `BOARDS` set) and `supabase/scraping.sql` (the same defaults as seeds). Adding a board means touching all of them. The names make it worse: `lib/scrape.ts` and `lib/scraping/` are different things (one offer's ad vs. listing runs), and `src`, `source`, `board`, `kind`, `scraper` are used for overlapping ideas.

**Do:** introduce a **board registry** (the strategy pattern, nothing fancier):

```ts
// lib/boards/types.ts
export type Board = {
  id: string;                         // offers.src
  label: string;
  hosts: RegExp[];
  idFromLink(url: URL): string | null;
  cleanLink?(url: URL): URL;
  defaults?: ListingDefaults;          // seed search for Settings
  parseListing(body: string, ctx: Ctx): Parsed;
  fetchAd(copy: Copy): Promise<Scraped>;
};
// lib/boards/justjoin.ts, nofluff.ts, … one file each
// lib/boards/index.ts: const BOARDS = [justjoin, nofluff, …]; byId(), byHost()
```

Generic JSON/HTML/RSS scrapers become three more entries whose `parseListing` reads the config. Seed the database from the registry (a script or first-run insert) so the SQL seeds stop duplicating TypeScript. Rename folders so the two scraping concerns are obvious: `lib/listings/` (runs, filters, store) and `lib/ads/` (full ad text).

### Flat `app/` directory and a 360-line catch-all `actions.ts` — High

Twenty-five files sit directly in `app/`: shell (`header`, `nav`, `tabs`, `auto-refresh`), offers list (`results`, `controls`, `fit-score`, `apply-button`), AI (`ai-controls`, `ai-filter-bar`, `profile-dialog`), and one `actions.ts` that holds login, profiles, AI runs, applications and time zone. A reader cannot tell which files belong together.

**Do:** feature folders, with `app/` reduced to routes:

```
app/                      routes only (page.tsx, layout.tsx, api/)
features/
  offers/                 results, controls, apply-button, actions.ts, queries.ts
  ai/                     filter bar, profile dialog, runs, actions.ts
  applications/           list, sheet, note editor, add/edit form, actions.ts
  scraping/               settings panels, scraper editor, actions.ts
  telegram/
components/ui/            shadcn components (dialog, sheet, tooltip, select, …)
components/               app-level pieces built on them: SearchBox, DateRange, StatusBadge, useConfirm
lib/                      boards/, listings/, ads/, db/, env.ts, dates/, result.ts
server/                   auth, session, withAuth
```

Mark shared (isomorphic) modules by location, e.g. `lib/shared/`, so nobody has to open a file to learn whether it may be imported from a client component.

### Four shapes for "the action's answer", and `requireLogin()` repeated 30 times — Medium

`FormState`, `ActionState`, `{ error?: string }`, `TestResult | { error }`, and `{ app?, fetch?, error? }` all mean "success or an error". Every server action begins with `await requireLogin()` and its own `typeof` checks. Forgetting either is one line away.

**Do:** one discriminated `Result<T> = { ok: true; data: T } | { ok: false; error: string }`, and a higher-order wrapper that combines auth and validation:

```ts
export const action = <I, O>(schema: z.ZodType<I>, fn: (input: I, ctx: Ctx) => Promise<O>) =>
  async (raw: unknown): Promise<Result<O>> => {
    await requireLogin();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return fail(firstIssue(parsed.error));
    try { return ok(await fn(parsed.data, await context())); }
    catch (e) { return fail(message(e)); }
  };
```

Zod schemas replace `normalizeSettings`, `checkScraper`, `readForm` and the ad-hoc guards, and the same schema validates the client form before it is sent.

### Implicit state machines — Medium

Three lifecycles are encoded as scattered `if`s:

- **Application ad content**: `content_status` × `content` × `url` transitions appear in `addApplication`, `updateApplication` (six outcomes in 15 lines) and `saveContent`.
- **AI run**: `dedup → assess`, lock, slices, stale version, in a 95-line `continueRun`.
- **Scrape run**: `runAll` is 130 lines doing fetch, owner de-duplication, ingest, announce selection, outcome persistence, AI tail and Telegram.

**Do:** for the first two, a typed `transition(state, event): state` with an exhaustive `switch` (no library needed). For `runAll`, name the steps as functions with explicit input/output types and compose them: `fetchListings → pickOwners → ingest → selectAnnouncable → recordOutcomes → aiFilter → notify`. Each step becomes independently testable and the orchestration reads like the README diagram.

### Separate "what the data is" from "what the rules are" — Medium

`lib/applications.ts` mixes REST calls with business rules (which copy wins, when the applied date may move, how the key changes on edit). `lib/profiles.ts` decides versioning policy inside the same function that issues the PATCH.

**Do:** a thin repository per table (`lib/db/applications.ts`: get, list, insert, patch) and a service layer that holds the rules and is tested against an in-memory repo. The code already leans this way; make the boundary explicit.

### Naming: `dup_key`, `job_key`, `key`, and three "duplicate" things — Low

`offers.dup_key` is a company+title hash; `job_links.job_key` is the merged group; `Offer.key` and `Application.dup_key` both actually hold the job key. `lib/dedup.ts` (AI merging) and `supabase/remove-duplicates.sql` (a one-off cleanup) share a name but not a purpose.

**Do:** write a glossary (see Documentation) and rename to match: `titleKey` for the hash, `jobId` for the merged group. Rename `dedup.ts` to `ai/merge-duplicates.ts`.

### Single-letter variable names — Medium

There are 182 `const`/`let` declarations with a one-letter name, plus the same habit in arrow-function parameters. The worst offenders are the files that are already the hardest to read: `lib/scraping/run.ts` (34), `lib/scraping/parsers.ts` (34), `app/settings/scrapers.tsx` (32), `app/applied/applied-list.tsx` (27), `lib/scrape.ts` (26). The letters are also overloaded: `s` means settings, scraper, string or source depending on the file; `r` is a result, a run row, a regex match or a response; `d` is a draft, details or a day; `z` is always a time zone but you have to know that; `o`, `x`, `c`, `a`/`b` appear in long bodies where the reader has to scroll up to recover what they are.

```ts
// lib/scraping/run.ts today
const mark = r.ok ? Math.max(s.mark ?? -Infinity, r.maxSort ?? -Infinity, 0) : s.mark;
return saveOutcome(s.id, { ok: r.ok, found: r.found, kept: r.kept.length, added: addedBy.get(s.id) ?? 0, error: r.error, ms: r.ms, mark });

// the same line with names
const mark = result.ok ? Math.max(scraper.mark ?? -Infinity, result.maxSort ?? -Infinity, 0) : scraper.mark;
return saveOutcome(scraper.id, { ok: result.ok, found: result.found, kept: result.kept.length, added: addedBy.get(scraper.id) ?? 0, error: result.error, ms: result.ms, mark });
```

Short names are fine where the scope is one line and the meaning is conventional: `i` in a counting loop, `(a, b)` in a comparator, `e` in a one-line `catch`. Everywhere else the name should say what the value is.

**Do:** rename as each file is touched, and let the linter hold the line: ESLint `id-length` with `min: 2` and an exception list (`i`, `j`, `a`, `b`, `_`), or `@typescript-eslint/naming-convention`. Add the convention to `CONTRIBUTING.md`: `settings`, `scraper`, `offer`, `result`, `zone`, `draft`, `error`, never the first letter of them. Rename `z` to `zone` everywhere in one pass, since it is the most frequent and the least guessable.

---

## 4 · UI code

### Component library: use shadcn/ui — High

Today every control is hand-made: four dialogs, a masked date field with a hidden native picker, a tooltip positioned with `requestAnimationFrame`, native `confirm()`, inline feedback paragraphs, 730 lines of global CSS. That is a lot of UI plumbing to own in a one-developer app, and none of it is what makes Jobwatch useful.

**Pick: shadcn/ui** (Radix primitives + Tailwind v4, components copied into the repo). Reasons, in order:

- **Readable by anyone.** It is the default component vocabulary for Next.js apps; a new developer already knows `<Dialog>`, `<Sheet>`, `<Tooltip>`, `<Tabs>`, `<Select>`. The components live in `components/ui/` as plain TSX you can read and edit, not a black box.
- **It covers exactly what is hand-rolled now.** `Dialog`/`Sheet` for the four modals, `AlertDialog` for the five `confirm()` calls, `Tooltip` for the fit score, `Popover` + `Calendar` (react-day-picker) for the date range, `Tabs` for the top navigation, `Select`/`Switch`/`Checkbox` for Settings, `Badge` for status chips, `Skeleton` for the loaders, `sonner` for "Saved." toasts, `Progress` for AI runs, `Table` for the stage × outcome grid.
- **Accessibility is Radix's job**, which keeps the care already put into aria roles while removing the code that implements it.
- **Theming maps onto the existing tokens.** shadcn defines `--background`, `--foreground`, `--primary`, `--muted`, `--destructive`, `--border` as CSS variables with light and dark values, which is the same idea as the current `:root` block, done once instead of in ten `@media` blocks.
- **It pairs with the rest of the plan.** `lucide-react` is its icon set. For forms use **TanStack Form** (`@tanstack/react-form`) rather than shadcn's default react-hook-form wrapper: it validates with the same Zod schemas through Standard Schema (no resolver package), its `/nextjs` entry runs the same schema inside a server action (`createServerValidate`) so the `action()` wrapper and the form share one definition, and it sits next to TanStack Query, which this review already recommends. shadcn documents the TanStack Form integration; you use its `Label`, `Input`, `Select` and `FieldError` pieces with `form.Field` and skip the `Form` component. React 19 and Next 16 are supported.

**Runner-up: Mantine.** More batteries included (`@mantine/dates`, `@mantine/notifications`, `@mantine/modals`, `@mantine/form`) and no Tailwind, which would keep the current CSS approach. It loses on the first point: it is a framework you adopt wholesale, its styling is its own system, and fewer Next developers know it. Choose it only if you strongly prefer not to introduce Tailwind.

**Not recommended:** MUI or Ant Design (heavy, opinionated look that fights the current compact design), Chakra (in flux between versions), headless-only kits like Base UI or Ark (you would still write all the styling you are trying to stop writing).

**Do:** `npx shadcn@latest init` with Tailwind v4, map the existing palette onto shadcn's variables, then add components as each screen is migrated. The mapping of what exists today to what replaces it:

| Today | Replaced by |
|---|---|
| `ProfileDialog`, `AdModal`, `AddDialog`, `ScraperEditor` (`<dialog>` + `.modal-sheet`) | `Dialog` for the profile, `Sheet` (side panel) for application and scraper editing |
| five `confirm()` calls | `AlertDialog` behind a small `useConfirm()` hook |
| `FitScore` tooltip with rAF placement | `Tooltip` (Radix handles collision and placement) |
| `DateInput` masked text + hidden native picker | `Popover` + `Calendar`, with a text input in dd.mm.yyyy kept for typing |
| `Feedback` paragraphs, `ScrapeButton` result span | `sonner` toasts for transient answers; inline `Alert` only for persistent errors |
| `Tabs` hand-made nav, source and date chips | `Tabs` for the top navigation; `ToggleGroup` for the chips |
| `StatusChip`, `.badge`, `.pill` | `Badge` with variants per outcome |
| `ResultsSkeleton`, `SettingsSkeleton`, ad skeleton | `Skeleton` |
| AI run progress text + `.bar-track` | `Progress` inside a `Card` |
| Settings `useServerForm` + controlled inputs; `ApplicationForm`'s `touched` set; `ScraperEditor`'s draft state | TanStack Form (`useForm` + `form.Field`) with the Zod schema; its per-field `isTouched`/`isDirty` replaces the hand-kept `touched` set that "Fill in from the link" relies on; `Switch` for toggles, `Select` for interval and time zone (`Command` for searching 400 zones) |
| Stage × outcome `<table>`, stat tiles, funnel | `Table`, `Card`; keep the funnel bars as a small custom component |

### God components — High

| File | Lines | Contains |
|---|---:|---|
| `app/applied/applied-list.tsx` | 692 | List, statistics, 300-line sheet with manual polling, note editor with localStorage drafts |
| `app/settings/panels.tsx` | 520 | Three panels, four hooks, cron diagnostics |
| `app/settings/scrapers.tsx` | 486 | List, editor dialog, test result view |
| `lib/scraping/run.ts` | 372 | Fetch, filter, ingest, AI, Telegram |
| `app/actions.ts` | 360 | Five unrelated feature areas |

**Do:** one component per file under its feature folder; `AdModal` alone splits into `ApplicationSheet`, `StatusEditor`, `StatusTimeline`, `AdText`, `NoteEditor`. A soft rule of 200 lines per file keeps this honest once a linter can enforce it.

### Four dialogs, four implementations — Medium

`ProfileDialog`, `AdModal`, `AddDialog` and `ScraperEditor` each call `showModal()` in an effect, handle backdrop clicks with `e.target === dialog.current`, and rebuild the `.modal-sheet` head/scroll/foot structure. Native `confirm()` is used for destructive actions in five places.

**Do:** shadcn's `Dialog` and `Sheet` (with `SheetHeader`, scrollable body, `SheetFooter`) replace all four; a `useConfirm()` hook over `AlertDialog` replaces `confirm()`. Focus trapping, Escape, backdrop clicks and scroll locking stop being your code.

### Polling and autosave implemented with refs — Medium

`AdModal.follow` is a `for(;;)` loop with `sleep` and a generation counter (`run.current++`) used as a cancellation token. `NoteEditor` coordinates `latest`, `saved`, `saving` and `timer` refs. `List` re-triggers `router.refresh()` while any ad is pending. `AiControls` refreshes every 4 s during a run. `AutoRefresh` keeps module-level state across pages. Each is correct and each is hard to read.

**Do:** TanStack Query for the client-side read paths that poll (`useQuery` with `refetchInterval` conditional on `content_status === 'pending'`, or on an open AI run), and a small `useAutosave(value, save, { delay })` hook for the note. Keep server components and server actions for everything else; the library is only for the few places that need client state over time.

### Duplicated small utilities — Medium

- `const message = (e: unknown) => …` defined in 7 files
- `one(sp.x)` search-param reader in 2; the whole q/src/days/from/to parsing block duplicated in `results.tsx` and `ai-filter-bar.tsx`
- `seconds(ms)` in 2 files with different precision
- HTML entity decoding in `scrape.ts` (`ENTITIES`) and `parsers.ts` (`ENT`)
- `Copy` type defined in 3 files; `SearchParams` in 2
- `useAction` and `useSave` in `panels.tsx` are the same hook
- request-origin computation in `settings/page.tsx` and `settings/actions.ts`

**Do:** `lib/errors.ts`, `lib/shared/search-params.ts` with `parseOfferQuery()`, `lib/shared/format.ts`, one `Copy` type next to `Offer`. `useAction`/`useSave` go away once answers are toasts and forms are TanStack Form. A lint rule for duplicate exports will not catch these; a short "where things live" section in the contributing guide will.

### One 730-line global stylesheet — Medium

Class names are generic (`.body`, `.side`, `.title`, `.src`, `.status`, `.meta`) and global, so a new component risks colliding with an existing one. Dark mode is handled by ten separate `@media` blocks with hard-coded colours (`#ff8a80` appears eight times, `#ffb74d` three) instead of tokens. Icons are Unicode glyphs (↻ ✦ ⓘ 📅 ✎ ×) that render differently per platform.

**Do:** Tailwind v4 as installed by shadcn/ui. Map the current palette onto shadcn's variables (`--background`, `--foreground`, `--muted`, `--primary`, `--destructive`, `--border`, plus your own `--success` and `--warning`) in one `@theme` block with a light and a dark set, which retires the ten `@media` blocks and the eight copies of `#ff8a80`. Component styles become utility classes on the element they style, so the collision problem disappears with the global class names. Replace glyphs with `lucide-react`. Keep `globals.css` for the token block, the font stack and the few layout rules (`scrollbar-gutter`, reduced motion).

### Misc code-level items — Low

- `maxDuration = 300` is set on four pages because "Scrape now" is a server action rendered in the header. Move it to `POST /api/scrape` so the budget belongs to the operation, not to whichever page hosts the button.
- Regex HTML parsing (`builtinBody`, `findJobPosting`, `mainText`, RSS `tag()`) alongside `node-html-parser`. Use the parser everywhere, and `fast-xml-parser` for RSS/Atom.
- Hand-written JSON Schema builder (`strictObject`) for OpenAI. The Vercel AI SDK's `generateObject` with a Zod schema gives typed output and retries; optional, but it removes a layer.
- `fit-score.tsx` positions its tooltip with `requestAnimationFrame` measurements. shadcn's `Tooltip` (Radix, Floating UI underneath) does this reliably.
- Errors in `after()` go to `console.error` and vanish on Vercel unless you look at logs. Add a small logger with context (run id, scraper) and consider Sentry.

---

## 5 · UX for someone who did not build it

The app explains itself in prose: the Telegram panel alone carries six paragraphs of conditional help text, and the README is required reading before Settings makes sense. Prose in the UI is usually a sign the model is not visible in the structure.

### No single view of "is everything connected and working?" — High

Whether the database is migrated, Supabase Cron is connected and matches the settings, Telegram is reachable and hooked, an OpenAI key exists, an AI profile is usable, and when the last run happened is scattered over four panels, each with its own wording.

**Do:** a **Health** card at the top of Settings (or a first tab): one row per dependency with a green/amber/red state, the one-line reason, and the single button that fixes it. Move the explanatory paragraphs into a help drawer or tooltips. This is the biggest single improvement for a newcomer.

### Settings mixes preferences with machine status — Medium

The Scraping panel holds the schedule form, the last-runs log, the cron diagnostics and the time zone. Scrapers hold both configuration and per-scraper run results.

**Do:** split into *Settings* (schedule, filters, time zone, Telegram, scrapers) and *Activity* (runs log, per-scraper results, queue, cron calls, AI runs). The run log then has room to become useful: filter by trigger, expand a run to see which scraper added what.

### The AI run model is opaque — Medium

Profiles, versions, "today new", two phases, slices that continue while a tab is open: the user sees a sentence of progress text and a bar. The verdict tooltip is good; the lifecycle around it is not visible.

**Do:** a run card with the two steps named (Duplicates → Assessment), counts per step, the profile version it belongs to, and an explicit "paused, reopen to continue" state until background continuation exists (see Robustness).

### Inconsistent vocabulary — Medium

The UI says source, board, scraper and src for related ideas; key, job, offer and copy for another cluster; stage, state, outcome and status for a third. One outcome label is a Polish vulgar joke ("CV do bazy, ty do dupy") inside an otherwise English interface, with "Talent pool" as its heading.

**Do:** adopt the glossary from Documentation in code identifiers and UI copy alike. Keep the joke as the hint text if you like it; make the label "Talent pool".

### Smaller UX items — Low

- Empty states tell the user what to do, which is good; make them actionable with the button in place (the Applied tab already does this).
- Destructive confirmations via `confirm()` look foreign; use `AlertDialog`.
- The date inputs reinvent a masked field; replace with `Popover` + `Calendar`, keeping a typed dd.mm.yyyy input for keyboard users.
- Switching between two browsers in different time zones rewrites `browserTimeZone` and reschedules cron on every page load. Either make the time zone an explicit setting with the browser's as a suggestion, or store it per browser and only use it for display.

---

## 6 · Robustness

### AI runs depend on an open browser tab — Medium

A run executes in `after()` slices under a lock; the next slice starts when the AI page refreshes (every 4 s via the client). Close the tab and the run stalls until someone opens the page again. The README documents this as a limitation.

**Do, cheapest:** let the existing Supabase Cron knock also call a continuation (`/api/cron/ai` that runs `continueRun` for any stale open run). **Do, cleaner:** a job runner (Inngest, Trigger.dev or Upstash QStash all have free tiers) that owns retries, steps and timeouts; the slices and locks then disappear from your code.

### Last-write-wins on notes — Low

`setNote` PATCHes without a version check; two tabs editing the same note overwrite each other. The localStorage draft mitigates loss but not the conflict.

**Do:** send `note_updated_at` as the expected value and reject if it changed (add it to the update's `where`, check the affected count).

### Tight time budgets — Low

`AI_BUDGET_MS` 150 s plus a batch of up to 120 s inside a 300 s function leaves little margin; `SLICE_MS` has the same shape. These constants are documented in comments but not enforced by a test.

**Do:** derive them from one `FUNCTION_LIMIT_MS` constant and assert the relationship in a test so a future change to one cannot break the other.

---

## 7 · Documentation

### The README is a user manual, an ops guide and an architecture document at once — Medium

**Do:** split it:

- `README.md`: what it is, a diagram, quick start. One screen.
- `docs/ARCHITECTURE.md`: data flow, the tables and which code writes each, the three lifecycles as state diagrams, and a **glossary**: *board* (a site), *scraper* (one search on a board), *offer* (one posting on one board), *job* (the same position across boards), *application* (yours, per job), *stage*/*outcome*, *profile*/*version*, *run* (scrape or AI).
- `docs/OPERATIONS.md`: deploy, env vars, cron, Telegram, recovery.
- `docs/decisions/`: short ADRs for the non-obvious choices already explained in comments (why `first_seen`, why PostgREST directly, why slices in `after()`, why the cookie is an HMAC).
- `CONTRIBUTING.md`: where things live, how to add a board, how to run tests.

---

## Libraries worth adding

The app has six runtime dependencies and that restraint is a virtue. Each entry below replaces hand-written code that is currently a maintenance cost, not a differentiator.

| Library | Replaces | Why | Risk |
|---|---|---|---|
| `vitest` | Nothing (no tests) | Fast, TS-native, works with Next's module resolution. | None |
| `eslint` + `typescript-eslint` + `prettier` | Manual formatting | Catches unused code, enforces consistency. | Initial noise; fix in one commit |
| `zod` | `normalizeSettings`, `checkScraper`, `readForm`, env reads | One schema per input; same validation on client and server; typed `env`. | None |
| `drizzle-orm` + `drizzle-kit` + `postgres` | `lib/supabase.ts`, four quoting helpers, hand-written row types, loose SQL files, several `jw_*` RPCs | Schema in TypeScript, inferred row types, typed joins and transactions, `sql` tag for the view and trigram queries, generated migrations. | Connection pooling in serverless: use the transaction pooler, `max: 1`. A larger refactor; do it per module |
| `@supabase/supabase-js` + Supabase CLI (alternative) | Same as above, minus the RPCs | No connection to manage; works on Edge; generated types. | Queries stay limited to what PostgREST expresses; views and functions stay SQL-only |
| `date-fns` + `@date-fns/tz` | Offset parsing and DST heuristics in `dates.ts`, hour sampling in `cron.ts` | Correct zone arithmetic without reading `formatToParts` output. | Keep the `Zone` facade; swap internals |
| `@tanstack/react-query` | Polling loops in `AdModal`, `List`, `AiControls`, `AutoRefresh` | Declarative refetching and cancellation. | Only for client reads; keep RSC for pages |
| **shadcn/ui** (Radix UI, Tailwind v4, `sonner`, `react-day-picker`) | Four dialogs, `confirm()`, tooltip placement, `DateInput`, `Feedback`, skeletons, chips, most of `globals.css` | The standard Next.js component vocabulary; components live in the repo; accessible by default; tokens map onto the existing palette. | Introduces Tailwind; migrate screen by screen. Runner-up without Tailwind: Mantine |
| `@tanstack/react-form` | `useServerForm`, `useAction`/`useSave`, the `touched` set and draft objects in `ApplicationForm` and `ScraperEditor` | Zod via Standard Schema, same schema validated client-side and in the server action (`createServerValidate`), typed fields, dirty/touched tracking; shares the TanStack ecosystem with Query. | Skip shadcn's react-hook-form `Form` wrapper and compose its field pieces directly, as its TanStack Form guide shows |
| `lucide-react` | Unicode glyph icons | Consistent rendering, accessible labels; shadcn's icon set. | None |
| `fast-xml-parser` | Regex RSS parsing | Handles CDATA, namespaces, Atom correctly. | None |
| `ai` + `@ai-sdk/openai` (optional) | `chat()`, `strictObject` | `generateObject` with a Zod schema, retries, provider swap. | Another abstraction; skip if the current client is stable |
| Inngest / Trigger.dev / QStash (optional) | Slices, locks, tab-driven continuation | Durable background steps with retries. | External service; free tier is enough |

---

## Roadmap

Each phase leaves the app working and deployable. Estimates assume one developer who knows the codebase.

### Phase 0 · Safety net (1–2 days)

- Vitest with tests for `dates`, `match`, `boards`, `stages`, `cron`, `formatNotification`, `htmlToText`; one fixture per board parser.
- ESLint (including `id-length` against single-letter names), Prettier, GitHub Actions (typecheck, lint, test, build).
- `lib/env.ts`; `lib/errors.ts`; `Result<T>`; `action()` wrapper with Zod.

### Phase 1 · Data layer (3–4 days)

- Drizzle schema file mirroring the current tables, a baseline migration generated from it, the view and `jw_*` functions as custom SQL migrations.
- Replace `lib/supabase.ts` with Drizzle queries module by module; delete quoting helpers and the `viewMissing` fallbacks; move the simple RPCs into transactions.
- Repository files per table; services keep the rules.

### Phase 2 · Domain (3–5 days)

- Board registry; one file per board; seeds generated from it.
- `runAll` as named pipeline steps; AI run and ad-content state machines with exhaustive transitions.
- Glossary applied to identifiers (`titleKey`, `jobId`, `outcome`).

### Phase 3 · UI (4–6 days)

- Feature folders; `app/` is routes only.
- shadcn/ui init with Tailwind v4; map the palette onto its tokens; `lucide-react`.
- Replace the four dialogs with `Dialog`/`Sheet`, `confirm()` with `AlertDialog`, the tooltip, date input, chips, skeletons and feedback with their shadcn counterparts; `useConfirm` and `useAutosave` in `components/`; split the three god components.
- Settings, application and scraper forms on TanStack Form with the shared Zod schemas; delete `globals.css` rules as each screen moves over.
- Health card; Settings vs Activity; AI run card.

### Phase 4 · Robustness and docs (2–3 days)

- Background continuation for AI runs; structured logging.
- Optimistic concurrency on notes; estimated counts.
- README split; ARCHITECTURE with glossary and diagrams; ADRs; CONTRIBUTING.

---

## Appendix

### Target architecture at a glance

```mermaid
flowchart LR
  Cron[Supabase Cron] -->|knock| API[/api/cron/scrape]
  API --> Pipeline[listings pipeline: fetch → own → ingest → select → record]
  Pipeline --> Boards[(board registry, one file per board)]
  Pipeline --> DB[(Supabase Postgres, Drizzle schema + migrations)]
  Pipeline --> AI[AI filter state machine]
  AI --> TG[Telegram]
  UI[features/*: offers · ai · applications · scraping] --> Actions[action wrapper: auth + zod + Result]
  Actions --> Services[services: rules] --> Repos[repos: per table] --> DB
```

### Largest files

| File | Lines |
|---|---:|
| app/globals.css | 730 |
| app/applied/applied-list.tsx | 692 |
| supabase/remove-duplicates.sql | 576 |
| app/settings/panels.tsx | 520 |
| app/settings/scrapers.tsx | 486 |
| lib/scraping/parsers.ts | 465 |
| lib/scraping/run.ts | 372 |
| supabase/ai-filter.sql | 367 |
| app/actions.ts | 360 |
| lib/applications.ts | 353 |

### Where "board" knowledge lives today

- `lib/sources.ts`: `SOURCES` labels for the six built-ins
- `lib/source-list.ts`: `BOARD_NAMES` for boards added later; merges with scraper rows
- `lib/boards.ts`: `HOSTS`, `BOARD_SUGGESTIONS`, `boardOf`, `cleanLink`, `boardIdOf`
- `lib/scraping/kinds.ts`: `KINDS` with `src`, label, hint, default URL and headers
- `lib/scraping/parsers.ts`: one listing parser per board
- `lib/scrape.ts`: one ad fetcher per board and a `BOARDS` set
- `supabase/scraping.sql`: seed rows repeating the defaults

### Review method

Every source file was read in full. `tsc --noEmit` was run and passed. No runtime testing was performed; findings about behaviour (time zone flapping, tab-dependent runs, note overwrites) come from reading the code paths and the README's own notes. Line counts are from `wc -l` on tracked files.
