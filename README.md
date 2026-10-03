# Jobwatch

Job offers from several boards, newest first, with search, filters, an AI filter and application tracking.
The app scrapes the boards itself and sends new offers to Telegram. Changing it, or adding a board:
[CONTRIBUTING.md](CONTRIBUTING.md).

```
Supabase Cron ─as in Settings→ /api/cron/scrape (Vercel) ─→ scrapers → filters → Supabase (offers)
"↻ Scrape now" ───────────────────────────────────────────┘                    └→ Telegram (new jobs)
Telegram /mute /send /status ─→ /api/telegram
```

"Newest" means `first_seen`, the time an offer was first scraped. It's the only timestamp all boards share.

## 1. Supabase

1. Create a project at supabase.com (the free tier is enough), or add Supabase from the Vercel Marketplace.
2. **Connect → Connection string → Session pooler**: copy the URI, replace `[YOUR-PASSWORD]` with the database
   password, and put it in `.env` as `SUPABASE_DB_URL`. Then `npm install` and **`npm run db:migrate`**: it creates
   the tables, the `offers_unique` view, the functions, the six scrapers with the default settings, and turns on
   `pg_cron` + `pg_net` for Supabase Cron (see [Database and migrations](#database-and-migrations)).
   The app talks to that database directly (Drizzle ORM over Postgres, server-side only); `SUPABASE_DB_URL` is the
   only database setting. RLS is on with no policies, so Supabase's public/anon key can't read anything.

## 2. Scraping (Settings tab)

All of it is set up in **Settings**:

- **Scraping:** ⏸ Pause / ▶ Resume at the top (paused, nothing runs on its own; "Scrape now" still does), every
  5–120 min, between which hours. The last runs with what they found, and the errors per board.
- **Time zone** (under the hours): the app's, for those hours and every day and time it shows (lists, date filters,
  "applied on", Telegram). By default _this browser's_: it follows the browser you open the app in (the cron and
  Telegram use the one last seen; Europe/Warsaw until then). Or pick a fixed one.
- **Filters:** keywords (searched on every board through `{keyword}` in the links, and required in the offer's
  title or skills), cities ("warszaw" matches Warszawa and Warszawie), remote OK, titles to skip, and titles to save
  without a Telegram message (by default `.net, dotnet, go, golang, java`).
- **Telegram:** mute / unmute (new offers wait in a queue meanwhile), send the queue, a test message, and the chat
  commands `/mute /resume /send /scrape /status`.
- **AI filter for Telegram** (on by default): new offers are checked against the active AI profile right after
  scraping, the way the AI tab does it (the verdicts show up there too). The message lists only the matches, with
  their fit; when nothing matches it just says how many new offers there are, with a link to the rejected ones.
  While OpenAI doesn't answer, the offers wait; after 20 minutes they're sent anyway, marked "not checked". Without a
  usable profile or `OPENAI_API_KEY`, everything is sent as before. "Scrape now" doesn't wait for the AI: the check
  and the message follow in the background.
- **Scrapers:** the six built-in boards, each with its own parser (an offer keeps its id and link, so nothing gets
  duplicated), and LinkedIn's public job search (no login; two searches: Warszawa, and remote in
  Poland). LinkedIn's search isn't sorted by date, so its searches take what was posted in the last hour
  (`f_TPR=r3600`), two pages each (`{start}` in a link + Pages in the scraper: 0, 10, 20…; `{page}`: 1, 2, 3…). LinkedIn's cards have no skills, so its keyword check looks at the title only: untick it in the scraper to
  get everything LinkedIn's search finds (it also matches descriptions). LinkedIn doesn't allow scraping in its terms
  and may refuse requests from servers; the scraper then shows the error. Each can be switched off, edited (link, headers, keyword / city check) or copied,
  e.g. a second JustJoin search. Add your own: **JSON** (any API, or the JSON inside a page: `__NEXT_DATA__`,
  JSON-LD, a `<script id>`), **HTML** (CSS selectors) or **RSS/Atom**. **Test** shows what a scraper finds, which of
  it is new, and the first offer's raw JSON/HTML to find the paths or selectors. Nothing is saved by a test.

How a run decides what to send: an offer is new if its board + id isn't in the
database; it's announced if it's also newer than anything that scraper saw before (bumped old offers aren't), the
same job (company + title) isn't already known from another board, and its title isn't muted. A scraper's first run
only saves, so a new or changed scraper doesn't flood Telegram.

**Setup:**

1. `npm run db:migrate` (step 1.2 above: the tables, the six scrapers and the default settings, and `pg_cron` +
   `pg_net` for Supabase Cron).
2. Vercel → Settings → Environment Variables: `TELEGRAM_BOT_TOKEN` (@BotFather → /mybots → API Token) and
   `TELEGRAM_CHAT_ID` (write to the bot, then copy `message.chat.id` from `api.telegram.org/bot<token>/getUpdates`; a
   group's starts with `-`). Redeploy.
3. Open Settings → **↻ Scrape now** at the top. Check that every board shows ✓ (sites can block Vercel's servers;
   the error says so).
4. Settings → **Connect Supabase Cron**: Supabase calls `/api/cron/scrape` on the schedule from Settings (the
   interval, only within the hours, none while paused; in UTC, an hour wider where clocks change) and the app checks
   again whether a run is due. Changing the interval, hours, time zone or pause reschedules it. Vercel's own cron
   can't do this on the free plan: Hobby allows one run a day.
5. Settings → Telegram → **Connect commands** (a bot gets commands by webhook or by polling, not both).

The cron sends `Authorization: Bearer <secret>`: `CRON_SECRET` if set, otherwise derived from `APP_PASSWORD`
(changing the password changes it: reconnect Supabase Cron then). By hand, `?force=1` runs even if not due and
`?wait=1` answers with the result.

## 3. Vercel

```bash
npm install
cp .env.example .env         # fill in SUPABASE_DB_URL (the rest is optional)
npm run dev                  # http://localhost:3000
npm test                     # unit tests (Vitest)
npm run test:db              # + the database tests, on a throwaway Docker Postgres (never yours)
npm run typecheck            # tsc --noEmit
npm run lint                 # ESLint (Next, typescript-eslint strict type-checked)
npm run format               # Prettier, writes; `npm run format:check` only checks
```

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, format:check, test and build on every push
and pull request, with the Node version from `.nvmrc`, and the database tests in a second job, against a
`supabase/postgres` service container. The build needs no env vars.

To deploy, push this folder to a GitHub repo, then **Vercel → Add New → Project → import it**.
Add the same env vars under **Settings → Environment Variables**, and deploy. On Vercel, `SUPABASE_DB_URL` is the
**Transaction pooler** URI (Supabase → Connect → Transaction pooler, port **6543**), not the Session pooler one in
your `.env`: serverless functions open many short connections, and the transaction pooler is made for that.
Alternatively, run `npx vercel` from this folder.

## 4. Password and AI filter

1. **Database:** `npm run db:migrate` (step 1.2) has already added what the AI filter needs:
   - `offers.dup_key` (the same job on any board) and the `offers_unique` view: both tabs show each job once,
     with links to every board it was posted on;
   - `job_links` and `ai_dup_pairs`: duplicates the AI confirmed, and every pair it was asked about;
   - `ai_profiles`, `ai_runs`, `ai_verdicts` and `offer_details` (the scraped ad text, cached per offer).
2. **Vercel → Settings → Environment Variables**, the same as in `.env`:
   - `APP_PASSWORD`: required. Without it every page in production answers 503, so the CV can't end up public.
     Log in once per browser; the cookie lasts 400 days.
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL=gpt-6-luna`, `OPENAI_ASSESS_EFFORT=high`, `OPENAI_DEDUP_EFFORT=low` (these are also the defaults).
     `OPENAI_ASSESS_MODEL` / `OPENAI_DEDUP_MODEL` can set a different model for each job.
   - `OPENAI_BASE_URL`: optional, for a proxy or Azure-compatible endpoint.
3. Locally, without `APP_PASSWORD`, `npm run dev` stays open with no login.

How the **AI filter** tab works:

- **Profiles:** each one has a name, criteria text and an optional CV (PDF / TXT / MD). Pick or create one in the
  dropdown in the modal. The most recently used profile is the active one.
- **Runs are manual:** "Check today", or "Check <range>" for the dates picked in the filter row. A run only sends jobs
  this profile hasn't judged yet, so running "today" again costs nothing.
- **Duplicates, step 1 of every run:** the database proposes pairs the plain key misses: same company, or one name
  a prefix of the other ("EPAM" / "EPAM Systems"), similar titles (pg_trgm), at most 45 days apart. So today's offer
  is compared with last month's. The AI (low effort) decides each pair; when unsure it keeps them apart.
  Decisions are stored and never asked twice. Same pairs become one job (`job_links`), the earliest copy leads,
  and verdicts move with it.
- **Assessment, step 2:** each remaining job is compared with the profile (high effort).
- **When verdicts are reused:** they're stored per profile version and per job. Editing a profile's text or file starts
  a new version, so its offers get re-checked. Renaming or switching profiles keeps what's already checked.
  The same job on two boards is judged once.
- **Ad text:** before judging, each offer's full ad is fetched once and cached. Sources: schema.org JobPosting on
  JustJoin, Eldorado, Bulldog and Solid.jobs, NoFluff's public API, and Built In's ad body.
  If an ad can't be read, the offer is judged on its title, and the tooltip says so.
- **What you see per offer:** match yes/no, a 0–100 % skills fit and a ✓/✗ checklist of key requirements in the
  ⓘ tooltip. "show N rejected" lists what didn't match.
- **Background work:** runs execute in `after()` in slices of about 3 minutes under a lock (Vercel's 300 s limit).
  While a run is open, the page refreshes and starts the next slice, so a long run continues as long as the tab
  stays open.

## 5. Applied offers

- **Mark applied** on any offer (All offers or AI filter) records that you applied. The mark is per job, so all its
  boards show it. It keeps a snapshot of title, company and link, and in the background saves the **complete ad
  text** plus what the board publishes about the job: salary per contract type, contract, location / remote, posted,
  valid until. The ad stays readable after the board takes it down.
- Sources: JustJoin and NoFluff from their public offer APIs (formatted text, skills, salary in the offer's own
  currency); Eldorado, Bulldog and Solid.jobs from the page's JobPosting; Built In from the page body.
  If the clicked copy can't be read, the job's other boards are tried.
- **Applied tab:** your applications, newest first, with search (title, company and your note). Click one for a
  window with the status, your note, the saved ad and its details, "Open original", "Fetch again" (if fetching
  failed) and "Unmark applied". The window opens at once with what the list has; only the ad text loads.
- **Add application** (button next to the search): one you sent elsewhere. Paste the link and **✦ Fill in from the
  link** reads the page (JustJoin, NoFluff and LinkedIn through their APIs, any other page by its text) and the AI
  (`OPENAI_EXTRACT_MODEL` / `OPENAI_EXTRACT_EFFORT`, default the luna model at low effort) fills in title, company,
  salary, contract and location; everything stays editable, with the board, the day you applied and the status. A
  link the scrapers already have joins that offer (the lists show it as applied). Without ad text, it's fetched from
  the link after saving.
- **✎ Edit** in an application's window: the same form, filled in (title, company, link, board, the day you applied,
  salary, contract, location, ad text). "Fill in from the link" fills only the empty fields there. A link the
  scrapers have joins that offer, as when adding; a job that already has an application is refused. The status and
  the note are set in the window itself.
- **Note:** free text per application (recruiter, salary you asked for, interview questions, next steps…), up to
  10 000 characters. It saves itself as you type and when you close the window. Until it's saved it's also kept in
  the browser, so a dropped connection doesn't lose it. The list shows its first line.
- **Status:** every application starts as _Submitted · In progress_.
  - Stages: Submitted → Initial contact (they got back to you) → Screening / online test → Technical interview →
    HR interview → Offer. Reaching a later stage counts the earlier contact as made.
  - Each stage's outcome: In progress, Passed, Rejected, Ghosted, and _CV do bazy, ty do dupy_ (the talent pool:
    "we'll keep your CV"). An offer has its own: Received, Accepted, Rejected (an accepted offer isn't "in
    progress", one you turned down isn't a rejection).
  - Set both in the window; every change goes into the history with its date. A step clicked by mistake goes with
    its × (shown on hover), together with every step after it; the status goes back to the step before. The first
    step, applying, stays.
  - No news for 30 days since the last change (or since applying): it becomes _Ghosted_ by itself, at the same
    stage (in progress, or passed and waiting for the next step; not a rejection, the talent pool or an offer).
    The step says "(auto)".
- **Statistics** at the top of the tab:
  - Everything goes by each application's last status (a stage you went back from doesn't count).
  - Tiles: sent, positive replies (the last status is past Submitted), offers, in progress, rejected, ghosted,
    talent pool.
  - Bars: how many are at each stage now, as % of all sent.
  - A stage × outcome table.
  - Click a tile, a funnel bar or a number to filter the list.
- The table is `applications`, created by `npm run db:migrate`. When the AI merges duplicates, the mark, its
  status and the note move with the job (if both copies were marked, the notes are joined).

## Database and migrations

The tables are declared in [`lib/db/schema.ts`](lib/db/schema.ts) (Drizzle ORM); [`drizzle/`](drizzle) holds the
migrations, applied in order and recorded in the database (`drizzle.__drizzle_migrations`), so each runs once.
What Drizzle can't declare (extensions, the `offers_unique` view, the `jw_*` / `ai_*` functions, grants, `pg_cron`,
the seed rows) is in its custom migrations, `0000_extensions`, `0002_functions` and `0003_seed`. Why Drizzle:
[docs/decisions/0001-drizzle-over-postgrest.md](docs/decisions/0001-drizzle-over-postgrest.md).

```bash
npm run db:migrate    # apply the pending migrations to SUPABASE_DB_URL (the shell's, else .env's; DOTENV=0: not .env)
npm run db:generate   # after editing lib/db/schema.ts: write the migration for it, then read it and commit it
npm run db:generate -- --custom --name=what   # an empty migration for SQL Drizzle can't express (a view, a function)
npm run db:check      # the migration files are consistent with each other
npm run db:verify     # the checks below, on two throwaway Docker databases (never yours)
scripts/db-reset-local.sh postgresql://postgres:pw@localhost:5432/postgres   # wipe a LOCAL database and migrate it
```

- **Never `drizzle-kit push`.** It changes the database straight from `schema.ts`, without a migration file and
  without a record of it, and it doesn't know about the view, the functions or the grants (they're not in
  `schema.ts`), so it may try to drop or alter what they depend on. Change `schema.ts`, `npm run db:generate`,
  read the file, `npm run db:migrate`.
- **`npm run db:migrate`** ([`scripts/db-migrate.ts`](scripts/db-migrate.ts)) is drizzle-orm's migrator, the one
  `drizzle-kit migrate` uses, run directly because drizzle-kit exits without saying why when a statement fails.
  All pending migrations run in one transaction: if one fails, nothing changes.
- **Which URL:** `npm run db:migrate` wants the **Session pooler** URI (port 5432; the migrator uses prepared
  statements, which the transaction pooler doesn't keep). The app on Vercel uses the **Transaction pooler** (6543).
  Both are under Supabase → Connect. TLS is added on its own (`sslmode=require`) for anything that isn't localhost;
  that encrypts the connection but doesn't verify the server's certificate (add `sslmode=verify-full` and
  `sslrootcert` to the URL for that).
- **Is the database up to date?** `GET /api/health` (logged in) answers
  `{ "db": "ok" | "behind" | "unreachable", "pending": ["0004_…"] }`, with status 503 unless it's "ok". "behind"
  lists the migrations this deployment has and the database hasn't run. After a deploy with a new migration, run
  `npm run db:migrate`.
- **`npm run db:verify`** ([`scripts/db-verify-migrations.sh`](scripts/db-verify-migrations.sh)) starts two
  `supabase/postgres` containers and checks that (a) a database set up by the SQL files used before Drizzle, then
  used a little (offers, a merged job, an application, a profile, edited scrapers, Supabase Cron connected), is left
  exactly as it was by `npm run db:migrate` (schema, and the rows in `public` and `cron`); (b) an empty database gets
  the same schema from the migrations alone, every migration can run twice, and a view built on `offers_unique`
  makes the migration fail and roll back instead of being dropped; (c) `schema.ts` and the migrations agree. With
  `--from-dump file.sql`, (a) starts from a dump of production instead (next section). It refuses any database that
  isn't on localhost (`bash scripts/lib-local-db.sh` tests that guard). It reads the old SQL files from git, so it
  needs the full history (`git fetch --unshallow` in a shallow clone). Run it after changing a migration.
- **Queries** live in [`lib/db/repos/`](lib/db/repos), one file per table (get, list, insert, patch…); the rules on
  top of them (which copy an application keeps, when its date may move, profile versions…) stay in `lib/*.ts`.
  Most are plain Drizzle. What is SQL by nature is called with the `sql` tag: the `offers_unique` view (queried
  like a table), `ai_dup_candidates` (trigram similarity), `jw_ingest_offers`, `jw_merge_jobs`, `jw_dup_key` and
  the Supabase Cron functions. `jw_set_application_status`, `jw_ghost_stale_applications`, `jw_scrape_lock`,
  `jw_source_counts`, `ai_results`, `ai_pending` and `ai_range_stats` are no longer called (those queries are in
  TypeScript now) but are still in the database; a later migration drops them.
- **Timeouts:** each connection asks for `statement_timeout` 30 s and `lock_timeout` 10 s. Supabase's
  transaction pooler may not pass those on (see the ADR); check with `show statement_timeout` through the
  6543 URI, and if it says `0`, set them on the database role instead (the ADR has the two statements).
- **Timestamps** come back as ISO 8601 strings with microseconds (`2026-10-03T12:34:56.123456+00:00`), as
  PostgREST gave them, so they go to the browser as they are.
- **`npm run test:db`** ([`scripts/test-db.sh`](scripts/test-db.sh)) starts a `supabase/postgres` container on
  localhost, migrates it with `npm run db:migrate` (with `DOTENV=0`, so `.env` isn't read), runs the database
  tests (`test/db/`) against it and removes it. The tests run only when `TEST_DATABASE_URL` is set, and refuse
  anything that isn't localhost: they empty the tables.
- [`supabase/scripts/remove-duplicates.sql`](supabase/scripts/remove-duplicates.sql) is a one-off cleanup from
  before the app de-duplicated jobs; kept for reference, not to be run.

### Upgrading a database set up before Drizzle (once)

Until now the schema came from `supabase/*.sql`, applied by `scripts/db-migrate.sh`. The migrations up to
`0003_seed` are written to be no-ops on a database those files built, and `npm run db:verify` checks that on a copy
built from the files. Your production database has its own history, though, so check it before migrating it.
The commands below use `SUPABASE_DB_URL` from `.env` (the **Session pooler** URI, as the old scripts used):
`set -a; . ./.env; set +a` first.

1. **Back it up.** The dump holds your data, CV included: keep it out of git (`data/` is ignored).

   ```bash
   mkdir -p data
   docker run --rm postgres:17-alpine pg_dump "$SUPABASE_DB_URL" -Fc > data/backup-before-drizzle.dump
   ```

2. **Pre-flight checks** (read-only; every row should say PASS):

   ```bash
   docker run --rm -i postgres:17-alpine psql "$SUPABASE_DB_URL" -X -q < scripts/db-preflight.sql
   ```

   [`scripts/db-preflight.sql`](scripts/db-preflight.sql) checks that the old files' last version ran (the
   LinkedIn seed is recorded, the settings row exists, no `ai_filter` table from the first AI filter,
   `ai_verdicts` keyed by job), that no migration ran yet (no `drizzle` schema), and that nothing but the app's
   four functions is built on `offers_unique` (`0002_functions` drops and re-creates the view; anything else on
   it, such as a view you made in the SQL Editor, would make the migration fail). A FAIL says what to do.

3. **Optionally, rehearse on a copy:** dump the `public` schema and let `db:verify` start from it.

   ```bash
   docker run --rm postgres:17-alpine pg_dump "$SUPABASE_DB_URL" --schema=public > data/prod-public.sql
   npm run db:verify -- --from-dump data/prod-public.sql
   ```

4. **Quiet the app while it runs:** Settings → ⏸ Pause scraping, and don't start AI checks. The migration
   re-creates the `offers_unique` view and its functions, which takes locks those would wait on (or hold).
5. **Vercel → Settings → Environment Variables:** add `SUPABASE_DB_URL` = the **Transaction pooler** URI
   (Supabase → Connect → Transaction pooler, port **6543**, with the database password). Don't deploy yet: this
   version reads and writes the database only through that URL, and expects the migrations to have run.
6. **`npm run db:migrate`**, once, locally. Everything runs in one transaction: if any statement fails, it prints
   why and rolls back, and the database is as it was. On success it records the four migrations, so later ones
   run normally. The version still deployed keeps working meanwhile: the migrations change nothing it uses.
7. **Now deploy** (push, or redeploy in Vercel), open `/api/health` (it should say `"db": "ok"`), check that the
   offers, Applied and Settings load, and resume scraping in Settings.
8. **Remove `SUPABASE_URL` and `SUPABASE_SECRET_KEY`** from Vercel and from your `.env`: nothing reads them any
   more. The secret key itself can then be deleted in Supabase (Project Settings → API Keys), since the app no
   longer uses Supabase's REST API.

## Notes

- **Search:** each word must appear in the title or the company (`senior react` matches
  "Senior Frontend Developer (React)"). Case-insensitive, updates as you type.
- **Duplicates across sources:** the database keeps every board's copy, and `offers_unique` shows each job once.
  Telegram gets a job once, whichever board had it first.
- **Privacy:** the whole app is behind `APP_PASSWORD` (see step 4), and pages are also set to `noindex`.
- **Size:** a row is ~300 bytes, so Supabase's 500 MB free tier lasts a very long time. The run log keeps two weeks,
  Supabase Cron's own log a week.
