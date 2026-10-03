# Contributing

Before you push: `npm run typecheck && npm run lint && npm test` (and `npm run test:db` when you touched the
database code or the migrations; it needs Docker).

## Where things live

- **`app/`: routes only.** Pages, layouts, `error.tsx`, and `api/*/route.ts`. A page puts features together;
  what it renders lives in `features/`. A page's `maxDuration` covers its server actions and their `after()`
  work, so it's set where those need longer (the literal `300`: `test/lib/budgets.test.ts`). An operation that
  needs the time on its own is a route with its own `maxDuration`, like `POST /api/scrape` ("Scrape now").
- **`features/<feature>/`: one area of the app**, its components and its server actions (`actions.ts`, starting
  with `'use server'`, every action built with `action()` / `formAction()` from `server/action.ts`).
  `offers` (the lists, filters, Mark applied's button), `ai` (profiles, AI runs), `applications` (the Applied
  tab, applying, the add/edit form), `scraping` (Settings: schedule, filters, scrapers, Supabase Cron, the
  "Scrape now" button), `telegram` (its Settings panel), `login`, and `shell` (the header, tabs, auto-refresh,
  telling the server the browser's time zone). A feature imports another's module by its `@/features/…` path.
- **`components/`: pieces more than one feature uses** (`DateInput`, `TimeZone` / `useZone`, `useAction` for
  a button or a toggle, `useAppForm` for a form (below), `useConfirm()` for "are you sure?", `useReturnFocus()` for a dialog opened from code, `useAutosave()` for a
  field that saves itself, `useRefreshWhile()` for a page that refreshes while the server works, `Field` /
  `CheckField` / `Code`, `LoadError`, the search box's classes, `QueryProvider`). They import nothing from `features/`. **`components/ui/`** holds the shadcn/ui components,
  added with `npx shadcn@latest add <name>` (`components.json` says where things go) and then the repo's own
  code: edit them like any other file.
- **One component per file**, named after it, about 200 lines at most; a hook or helper that only it uses
  stays in its file. ESLint's `max-lines` (300, blank lines and comments not counted) stops a file growing
  into a god component.
- **Reading data:** server components, and server actions for every change. A read the browser repeats on
  its own (an application's ad text while it's fetched, AutoRefresh's "anything new?") is a TanStack Query
  `useQuery` with its `refetchInterval`; a page whose server-rendered data moves while the server works
  (pending ad texts in the list, an AI run) uses `useRefreshWhile()` instead, since the refresh is what
  brings that data.
- **Forms** are TanStack Form: `useAppForm` (`components/form.tsx`) with its fields
  (`<form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>`, which wire the
  label, the hint, the error, `aria-invalid` and `aria-describedby`), checked with the schema of the action it
  calls (`validators: { onDynamic: formSchema(schema) }`, `validationLogic: checkOnSubmit`: on Save, then on
  every change).
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
- **`server/`: the request's gate.** The login cookie (`auth.ts`), `requireLogin()` (`session.ts`) and the
  action wrapper (`action.ts`).
- **`lib/`: what the app knows, without the UI.** Boards, listings and the scrape pipeline, ads, AI, the
  database (`lib/db/`: schema and one repo per table), dates, Telegram. Server-only modules start with
  `import 'server-only'`.
- **`lib/shared/`: what client components may import, guaranteed** (errors, `Result`, formatting, URL filters,
  the Zod schemas the actions and their forms check the input with, `cn()` for class names). Nothing in it
  reads the database or a secret. The schemas are `zod/mini` (`import * as z from 'zod/mini'`: functions, not
  methods, so a page gets only what it uses, ~16 kB gzipped instead of zod's ~90 kB); import one from a form,
  and where only a message is wanted, the message (`application-messages.ts`). Other
  `lib/` modules without `import 'server-only'` (e.g. `lib/dates.ts`, `lib/stages.ts`) may be imported by client
  components too; check that line first.
- **Imports:** `app/`, `features/`, `components/` and `server/` use `@/…`, except between files of the same
  folder (`./…`). `lib/` uses relative paths within itself (`../db/…`), and `.ts` in them where a script runs
  the module in plain Node. Client components start with `'use client'`.
- **Styling:** Tailwind v4 and shadcn/ui. The colours are tokens in `app/globals.css` (shadcn's names:
  `background`, `foreground`, `card`, `primary`, `muted`, `destructive`, `border`, `ring`…, plus the app's own
  `brand`, `success`, `warning`, `pool`), one light set and one dark set that follows the system: use
  `bg-card`, `text-muted-foreground`, `text-destructive` and the like, never a colour of its own and never a
  `dark:` colour. Styling is utility classes on the element; `globals.css` keeps only the tokens, the base
  rules and the page's column (`.wrap`). A success ("Saved.") is a `sonner` toast (`toast`, or `useAction`);
  what went wrong, which you have to read or act on, is an inline `Alert` next to the control (`useAction` and
  `<ActionError>`) until the next try. A destructive step asks with `useConfirm()`, never `confirm()`. A window
  is a shadcn `Dialog` (short forms) or `Sheet` (a long form or a page about one thing), with
  `onInteractOutside={keepOpenOnToast}` (`components/toasts.ts`) so a click on a toast doesn't close it. Icons
  are `lucide-react` (`<CheckIcon />`): an icon is hidden from screen readers unless you give it an
  `aria-label`, and an icon-only button needs one.

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
