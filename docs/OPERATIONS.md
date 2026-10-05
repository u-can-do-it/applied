# Operations

Deploying and running Jobwatch: where it runs, what it needs, how to tell it's healthy and what to do when it
isn't. How it works inside: [ARCHITECTURE.md](ARCHITECTURE.md).

- [Deploy on Vercel](#deploy-on-vercel)
- [Environment variables](#environment-variables)
- [Database](#database) (set-up, migrations, [a local database](#a-local-database))
- [Supabase Cron](#supabase-cron) · [Notifications](#notifications) ([push on Android](#push-notifications-on-android), [Telegram](#telegram)) · [OpenAI](#openai)
- [Health](#health) · [Logs](#logs) · [SSRF policy](#ssrf-policy)
- [Recovery](#recovery) · [Timeouts and the pooler](#timeouts-and-the-pooler)

## Deploy on Vercel

1. **Supabase:** create a project at supabase.com (the free tier is enough), or add Supabase from the Vercel
   Marketplace. Under **Connect** you'll need one URI, with `[YOUR-PASSWORD]` replaced by the database
   password: the **Session pooler** (port 5432), for migrations and the app alike. Not the **Transaction
   pooler** (6543): the app's pages hang through it ([the connection](#timeouts-and-the-pooler)).
2. **Migrate it** from your machine (Node from `.nvmrc`): put the Session pooler URI in `.env` as
   `SUPABASE_DB_URL`, then `npm install` and `npm run db:migrate`. That creates the tables, the view, the
   functions, the default settings and the boards' scrapers, and turns on `pg_cron` + `pg_net`.
3. **Vercel:** push the repo to GitHub, then **Add New → Project → import it** (or `npx vercel` from the
   folder). Under **Settings → Environment Variables** add at least `SUPABASE_DB_URL` (the same **Session
   pooler** URI) and `APP_PASSWORD`; the rest is optional ([below](#environment-variables)). Deploy. The
   build needs no variables: nothing reads the database or the env while building. The functions run in
   `fra1` (Frankfurt, `vercel.json`), next to a Supabase project in Zurich (`eu-central-2`) or Frankfurt
   (`eu-central-1`): a page makes a dozen queries, and from Vercel's default `iad1` each crosses the Atlantic.
   A project elsewhere wants the Vercel region nearest it there.
4. **Open the app**, log in, and check the [Health card](#health) at the top of Settings. Then
   **Scrape now**, and on the Activity tab check that every scraper shows a check mark (a board may block
   Vercel's servers; the error says so). LinkedIn's terms don't allow scraping, and it may refuse requests from
   servers: its scrapers are seeded but can be switched off in Settings. Adzuna's needs `ADZUNA_APP_ID` and
   `ADZUNA_APP_KEY`; without them it says so: set them or switch it off.
5. **Connect Supabase Cron** ([below](#supabase-cron)), then the [notifications](#notifications): push on your
   phone, Telegram, or both.

A change to an environment variable on Vercel takes effect with the next deploy (**Redeploy**). A deploy that
brings a new migration needs `npm run db:migrate` too: until then the Health card and `/api/health` say the
database is behind.

## Environment variables

Every variable the app reads is in [`lib/env.ts`](../lib/env.ts), parsed with Zod on first use (on every use
in development, so an edited `.env` counts without a restart). A missing or malformed one fails where it's
read, with its name, so the parts that don't need it keep working. Locally they come from `.env`
(`.env.example` lists them, with comments); on Vercel from **Settings → Environment Variables**. An empty value
(`VAR=`) counts as not set.

| Variable                        | Required             | Default                     | What for                                                                                                                                                                                                                                                                                          |
| ------------------------------- | -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL`               | yes                  |                             | The database, a `postgres://` / `postgresql://` URI. The Session pooler (5432), on Vercel and for `npm run db:migrate` alike; not the Transaction pooler (6543). Server-side only, never `NEXT_PUBLIC_`.                                                                                          |
| `APP_PASSWORD`                  | in production        |                             | The login. Without it, production answers 503 everywhere (`proxy.ts`); a dev server stays open. Pages are also `noindex` (`app/layout.tsx`).                                                                                                                                                      |
| `CRON_SECRET`                   | no                   | derived from `APP_PASSWORD` | The bearer token Supabase Cron sends to `/api/cron/scrape`. Without it and without `APP_PASSWORD`, only a dev server accepts cron calls.                                                                                                                                                          |
| `OPENAI_API_KEY`                | no                   |                             | The AI filter, AI runs and "Fill in from the link". Without it the app runs without them.                                                                                                                                                                                                         |
| `OPENAI_MODEL`                  | no                   | `gpt-6-luna`                | The model for every AI job unless one below is set.                                                                                                                                                                                                                                               |
| `OPENAI_ASSESS_MODEL`           | no                   | `OPENAI_MODEL`              | Judging jobs against a profile.                                                                                                                                                                                                                                                                   |
| `OPENAI_DEDUP_MODEL`            | no                   | `OPENAI_MODEL`              | Deciding whether two jobs are the same.                                                                                                                                                                                                                                                           |
| `OPENAI_EXTRACT_MODEL`          | no                   | `OPENAI_MODEL`              | "Fill in from the link" reading a page.                                                                                                                                                                                                                                                           |
| `OPENAI_ASSESS_EFFORT`          | no                   | `high`                      | Reasoning effort: `none`, `low`, `medium` or `high`. Dropped automatically when the model refuses it.                                                                                                                                                                                             |
| `OPENAI_DEDUP_EFFORT`           | no                   | `low`                       | Same, for duplicates.                                                                                                                                                                                                                                                                             |
| `OPENAI_EXTRACT_EFFORT`         | no                   | `low`                       | Same, for "Fill in from the link".                                                                                                                                                                                                                                                                |
| `OPENAI_BASE_URL`               | no                   | `https://api.openai.com/v1` | Another OpenAI-compatible endpoint (a proxy, Azure-compatible). An http(s) URL; trailing slashes are trimmed.                                                                                                                                                                                     |
| `TELEGRAM_BOT_TOKEN`            | no (both or neither) |                             | The bot that sends new offers and takes commands. Without both, no Telegram (push may still send).                                                                                                                                                                                                |
| `TELEGRAM_CHAT_ID`              | no (both or neither) |                             | Your chat with the bot; the only chat whose commands count. A group's starts with `-`.                                                                                                                                                                                                            |
| `TELEGRAM_API_URL`              | no                   | `https://api.telegram.org`  | Another Bot API server (a local one, or a stand-in for tests).                                                                                                                                                                                                                                    |
| `VAPID_PUBLIC_KEY`              | no (all three)       |                             | Push notifications ([below](#push-notifications-on-android)): the public key of the pair `npx web-push generate-vapid-keys` makes (base64url). Without all three, push is off.                                                                                                                    |
| `VAPID_PRIVATE_KEY`             | no (all three)       |                             | Its private key. A secret: server-side only, never `NEXT_PUBLIC_`, never logged.                                                                                                                                                                                                                  |
| `VAPID_SUBJECT`                 | no (all three)       |                             | How a push service can reach you: `mailto:you@example.com` or an `https://` URL.                                                                                                                                                                                                                  |
| `ADZUNA_APP_ID`                 | no (both or neither) |                             | Adzuna's API ([developer.adzuna.com](https://developer.adzuna.com), free): its scraper adds the keys to each request, so they're never in the link, Settings or a run's results. Without them it fails saying so.                                                                                 |
| `ADZUNA_APP_KEY`                | no (both or neither) |                             | Its key. A secret. The free plan allows 250 calls a day and 2,500 a month, hence the schedule makes one Adzuna call an hour between its scrapers (one scraper of one page: hourly; Settings shows when each runs again). "Scrape now" and `/scrape` run them any time, and each such call counts. |
| `VERCEL_PROJECT_PRODUCTION_URL` | set by Vercel        |                             | The production domain: links in Telegram, and the address Supabase Cron and the Telegram webhook are given. Locally the request's own address is used.                                                                                                                                            |
| `NODE_ENV`                      | set by Next          | `development`               | `production` turns on the login requirement and the [SSRF checks](#ssrf-policy).                                                                                                                                                                                                                  |

Read only by the scripts and tests, not by the app: `DOTENV=0` (`npm run db:migrate` ignores `.env`),
`TEST_DATABASE_URL` (the database tests' local database), `SUPABASE_IMAGE` (`scripts/test-db.sh`'s and
`scripts/db-verify-migrations.sh`'s image) and `PG_IMAGE` (the `psql` / `pg_dump` image in
`scripts/lib-local-db.sh`).

## Database

The tables are declared in [`lib/db/schema.ts`](../lib/db/schema.ts) (Drizzle ORM); [`drizzle/`](../drizzle)
holds the migrations, applied in order and recorded in the database (`drizzle.__drizzle_migrations`), so each
runs once. What Drizzle can't declare (extensions, the `offers_unique` view, the `jw_*` / `ai_*` functions,
grants, `pg_cron`, the seed rows) is in custom migrations: `0000_extensions`, `0002_functions`, `0003_seed`,
`0004_board_seeds`, `0005_drop_unused_functions`; `0006_push_subscriptions` adds the push devices' table, `0007_seen_jobs` the jobs you opened, `0008_archived_jobs` the jobs you archived. Every
migration is idempotent. Why Drizzle:
[ADR 0001](decisions/0001-drizzle-over-postgrest.md).

```bash
npm run db:migrate    # apply the pending migrations to SUPABASE_DB_URL (the shell's, else .env's; DOTENV=0: not .env)
npm run db:generate   # after editing lib/db/schema.ts: write the migration for it, then read it and commit it
npm run db:generate -- --custom --name=what   # an empty migration for SQL Drizzle can't express (a view, a function)
npm run db:check      # the migration files are consistent with each other
npm run db:verify     # the migrations against two throwaway Docker databases (never yours)
scripts/db-reset-local.sh postgresql://postgres:local@localhost:5432/postgres   # wipe a LOCAL database and migrate it
```

- **`npm run db:migrate`** ([`scripts/db-migrate.ts`](../scripts/db-migrate.ts)) is drizzle-orm's migrator,
  the one `drizzle-kit migrate` uses, run directly because drizzle-kit exits without saying why when a
  statement fails. All pending migrations run in one transaction: if one fails, it prints why and nothing
  changes. Then it adds the scrapers of any board not seeded yet (`lib/db/seed.ts`), in a second transaction;
  if that fails, run it again.
- **Never `drizzle-kit push`.** It changes the database straight from `schema.ts`, without a migration file
  and without a record of it, and it doesn't know about the view, the functions or the grants, so it may try to
  drop or alter what they depend on.
- **Which URL:** the **Session pooler** (5432) for both: the migrator uses prepared statements, which the
  Transaction pooler (6543) doesn't keep, and the app's pages hang through it
  ([the connection](#timeouts-and-the-pooler)). TLS is added on its own
  (`sslmode=require`) for anything that isn't localhost; that encrypts the connection but doesn't verify the
  server's certificate (add `sslmode=verify-full` and `sslrootcert` to the URL for that).
- **`npm run db:verify`** ([`scripts/db-verify-migrations.sh`](../scripts/db-verify-migrations.sh)) starts two
  `supabase/postgres` containers and checks that (a) a database built by the pre-Drizzle SQL files (read from
  git at `a290945`), then used a little, is left as it was by `npm run db:migrate` (but for what `0004` and
  `0005` change, and the tables `0006` onwards add); (b) an empty database gets the same schema from the
  migrations alone, every migration can run twice, and a view built on `offers_unique` makes the migration
  fail and roll back instead of being dropped; (c) `schema.ts` and the migrations agree. With
  `--from-dump file.sql`, (a) starts from a dump of a database's `public` schema instead. It refuses any
  database that isn't on localhost (`bash scripts/lib-local-db.sh` tests that guard) and needs the full git
  history (`git fetch --unshallow` in a shallow clone). Run it after changing a migration.
- **RLS** is on for every table with no policies, so Supabase's public/anon key can't read anything.
- **Retention:** the scrape run log keeps two weeks, Supabase Cron's own log (`cron.job_run_details`) a week.

### A local database

The migrations grant to Supabase's roles and enable `pg_cron` and `pg_net`, so use Supabase's image, not plain
Postgres:

```bash
docker run -d --name jobwatch-db -e POSTGRES_PASSWORD=local -p 127.0.0.1:5432:5432 supabase/postgres:17.4.1.054
# give it ~20 s: the image restarts Postgres once after its init scripts
SUPABASE_DB_URL=postgresql://postgres:local@localhost:5432/postgres npm run db:migrate
```

Put the same URL in `.env` for `npm run dev`. `scripts/db-reset-local.sh <url>` wipes such a database and
migrates it again. Supabase Cron can't call a dev server on localhost; use "Scrape now".

## Supabase Cron

Supabase Cron (`pg_cron` + `pg_net`, both on every Supabase plan) calls `/api/cron/scrape` on the schedule
Settings makes: the interval, only within the hours (in UTC, an hour wider where clocks change), none while
paused. The app then checks again whether a run is due. Vercel's own cron can't do this on the free plan
(Hobby allows one run a day).

- **Connect:** Settings → **Connect Supabase Cron**, from the deployed app (the job is given this
  deployment's address, `VERCEL_PROJECT_PRODUCTION_URL`, and the [cron secret](#environment-variables)). If it
  says `pg_cron` or `pg_net` isn't enabled: Supabase → Integrations → Cron, or Database → Extensions, then
  `npm run db:migrate` again.
- **Changing** the interval, hours, time zone or pause reschedules the job by itself.
- **Reconnect** when the Health card says so: the job calls another address (a new domain), its schedule isn't
  the settings' (it was switched off or edited in Supabase), or the app refused its last call with 401 (the
  secret changed: `APP_PASSWORD` or `CRON_SECRET`).
- **By hand:** `curl -H 'Authorization: Bearer <cron secret>' 'https://<app>/api/cron/scrape?force=1&wait=1'`
  runs even if not due (`force=1`) and answers with the result (`wait=1`). Every answer has `"jobwatch"` in it.
- **Disconnect** removes both jobs (`jobwatch-scrape`, and the daily cleanup that keeps a week of its log).
- Activity → "Supabase Cron" shows its last calls and what the app answered.

## Notifications

New offers go to every channel that's set up: **push notifications** on the devices you enabled, and
**Telegram**. Both get the same batch after each run (the AI filter's matches, or everything without it); one
failing doesn't stop the other, and an offer that no channel could deliver waits in the queue for the next try.
**Settings → Notifications** holds what applies to both: this device's push (enable, test, disable), sending on
or off, mute and unmute, "Send the N now" (the queue), "Scrape now", and the AI filter switch. With no channel
set up, new offers are saved but not queued.

### Push notifications on Android

1. **The keys**, once, on your machine (no account anywhere):

   ```bash
   npx web-push generate-vapid-keys
   ```

   It prints a public and a private key. Keep the private one secret; changing the pair later means every device
   has to enable notifications again.

2. **Vercel → Settings → Environment Variables:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
   (`mailto:` your address); redeploy. The deploy that brings push has a migration: run `npm run db:migrate`
   ([Database](#database)), or the Health card says the database is behind and no device can be saved.
3. **Install the app** on the phone: open the app's address in **Chrome**, log in, then the menu (⋮) →
   **Add to Home screen** (or **Install app**). It opens in its own window from then on (`app/manifest.ts`,
   `public/sw.js`). The manifest, the icons and the service worker are served without the login (`proxy.ts`), as
   the browser fetches them without the cookie; the pages stay behind it.
4. **Enable it:** in the installed app, Settings → Notifications → **Enable notifications on this device**,
   and allow notifications when Chrome asks. **Send a test notification** checks the whole way. "Blocked" means
   notifications were refused for the site: Android Settings → Apps → the app (or Chrome → site settings) →
   Notifications → Allow, then reload.

One notification per scrape run ("5 new offers", the first offers named); tapping it opens the offers list on
`/?new=1`: only what the latest run that brought new jobs brought. The lists mark those offers **new** anyway.
A device whose subscription expired (the app uninstalled, the site's data cleared) is removed the next time the
push service says so (404 / 410). Enable each device you want on its own; **Disable on this device** removes it.
The Health card's **Push** row says whether the keys are set and how many devices are subscribed.

A push service is Google's (Chrome), Mozilla's (Firefox)…: the server sends to the address the browser got from
it. That address comes from the browser, so it is checked like any outside URL ([SSRF policy](#ssrf-policy)):
https on a known push service only (`fcm.googleapis.com`, `updates.push.services.mozilla.com`,
`*.notify.windows.com`, `web.push.apple.com`), and in production connected only to an address the guard allows.
A send gives up after 10 s. When one channel fails and another delivers, Settings says "Sent N; …" as a
warning, and the run log has a warning, not an error.

### Telegram

1. **A bot:** in Telegram, @BotFather → `/newbot`; its API token is `TELEGRAM_BOT_TOKEN`.
2. **Your chat id:** write anything to the bot, then open `https://api.telegram.org/bot<token>/getUpdates` and
   copy `message.chat.id` (a group's starts with `-`). Do this before connecting the commands: `getUpdates`
   doesn't answer while a webhook is set.
3. **Vercel → Settings → Environment Variables:** `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; redeploy.
4. **Settings → Telegram:** **Test message** sends one; **Connect commands** sets the webhook to
   `/api/telegram` (a bot gets updates by webhook or by polling, not both). Telegram sends back a secret
   derived from the token; only `TELEGRAM_CHAT_ID` may give commands, everyone else is ignored.

Commands: `/mute` (also `/pause`, `/stop`: new offers wait in the queue, for every channel), `/resume`
(`/unmute`, `/start`: and send what waited), `/send` (`/flush`), `/scrape` (`/run`), `/status`. The same
switches are in Settings → Notifications. With the AI filter on, a message lists only the matches; an offer the
AI couldn't check for 20 minutes is sent anyway, marked "not checked".

**Send to Telegram** (Settings → Telegram, on by default) switches Telegram off without removing the bot, the
webhook or the variables: no messages about new offers (they're queued only while push can still send them),
**Test message** is disabled, and commands are answered 200 to Telegram but get no reply and run nothing. The
Health card's Telegram row says "Off in Settings". **Disconnect** removes the webhook, if you want that too.

## OpenAI

`OPENAI_API_KEY` (platform.openai.com → API keys) turns on three jobs, each with its own model and effort
([the variables](#environment-variables)): **assess** (a job against a profile, high effort), **dedup**
(are two jobs the same, low effort) and **extract** ("Fill in from the link", low effort). Each call gives up
after 120 s. Without the key: no AI runs, the AI filter lets everything through to the notifications, and "Fill in from
the link" fills in only what the page says plainly. `OPENAI_BASE_URL` points it at another compatible endpoint.

## Health

- **The Health card** at the top of Settings has one row per dependency, green, amber or red, with the reason and
  the fix (a button, a page, or a command): **Database** (reachable, every migration applied), **Scraping**
  (on with its schedule, or paused), **Supabase Cron** (connected, following the settings, its last answer),
  **Last run** (finished, which scrapers failed), **Telegram** (configured, reachable, commands connected, or off in Settings),
  **Push** (the VAPID keys set and well-formed, how many devices are subscribed),
  **OpenAI** (key set), **AI profile** (one exists, with criteria or a CV). A check that throws is a red row
  saying why; the others still show.
- **`GET /api/health`** (logged in) answers `{ "db": "ok" | "behind" | "unreachable", "pending": ["0005_…"] }`,
  with status 503 unless it's `ok`. `behind` lists the migrations this deployment has and the database hasn't
  run: run `npm run db:migrate`. `unreachable`: check `SUPABASE_DB_URL` (and the logs for why).

## Logs

The server writes one JSON line per event ([`lib/log.ts`](../lib/log.ts): `ts`, `level`, `msg`, and what it's
about: `runId`, `scrapeRunId`, `scraper`, `jobId`, `route`…), on stdout for `info` and stderr for `warn` /
`error`. On Vercel they're in the project's **Logs** (runtime logs: filter by level, or search for a `runId`),
kept for a short while on the free plan. That's where to look for what failed after an answer was sent
(`after()`: the AI check and the notifications after a scrape, an AI run's slice, an ad text being fetched) and for each
scraper's failure.

**Redaction:** a log line never has a secret in it. Values under keys like `token`, `secret`, `password`,
`cookie` or `authorization`, a push subscription's `endpoint`, `p256dh` and `auth` (push logs name the push
service's host only), the configured secrets themselves (`SUPABASE_DB_URL` and its password, `APP_PASSWORD`,
`CRON_SECRET`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `VAPID_PRIVATE_KEY`, also percent-encoded), a URL's password
and its token-like query parameters, bearer tokens, OpenAI keys and bot tokens in free text are replaced with
`[redacted]`. A failed query is logged by its cause, never its SQL or its values. Supabase Cron's functions
rethrow the database's words only, since their arguments include the cron secret.

## SSRF policy

Everything the server fetches from a link it didn't choose (scrapers' pages, offers' ads, "Fill in from the
link") goes through `fetchOutbound()` ([`lib/outbound.ts`](../lib/outbound.ts),
[ADR 0008](decisions/0008-ssrf-policy-connect-time-checks.md)). Push notifications go out through `web-push`
instead, to an allowlist of push services, over a connection with the same address check
([ADR 0009](decisions/0009-notification-channels-and-push.md)). In production:

- only http(s), never `localhost`;
- the host is resolved and refused if any address is private, loopback, link-local (the cloud metadata
  service), CGNAT, multicast, unspecified or reserved, IPv6 forms that embed such an IPv4 address included
  (`[::ffff:7f00:1]`; decimal, hex and octal IPv4 are normalised first);
- redirects are followed by the app, at most 5 hops, each checked the same way; an `Authorization` or
  `Cookie` header isn't sent on to another site;
- the connection itself only goes to an address that passed the check, so a name that answers differently
  the second time (DNS rebinding) is refused too;
- a response body is read up to 8 MB.

A dev server (`npm run dev`) may read localhost. A refused link fails with "Private addresses are not
allowed"; a scraper shows it as its error.

## Recovery

- **A scrape that won't start** ("Another run is still going", or the cron answers `busy`): the run lock
  (`scrape_state.locked_until`) is held. A crashed run's lock runs out by itself after `SCRAPE_LOCK_MS`
  (280 s), before the next knock. If it doesn't, and no run is going (Activity, and the logs), clear it in the
  Supabase SQL Editor: `update public.scrape_state set locked_until = null;`. A run whose function died stays
  "didn't finish" in the run log; the next run is unaffected.
- **An AI run that doesn't move:** between slices a run is paused, and the AI tab or Supabase Cron's next call
  continues it; a dead worker's lock runs out after `AI_RUN_LOCK_MS` (3 min). With scraping paused or the cron
  not connected, only the AI tab continues it: open it. A run whose OpenAI calls keep failing ends as `failed`
  after three rounds (the logs say why). To stop one, edit the profile's text or file (a new version: the next
  slice cancels the run), or in the SQL Editor:
  `update public.ai_runs set status = 'cancelled', finished_at = now(), lock_until = null where status = 'running';`
- **A migration fails:** nothing changed (one transaction). `npm run db:migrate` prints the database's error,
  its detail and hint. `2BP01` means something of yours is built on what the migration replaces: see check 6
  of `scripts/db-preflight.sql`, drop or move it, and run it again. If only adding the boards' scrapers failed,
  the migrations did run: run it again. Rehearse a risky one with `npm run db:verify -- --from-dump` first;
  never fix it with `drizzle-kit push`.
- **Rotating `APP_PASSWORD`:** change it on Vercel (and `.env`), redeploy. Every browser is logged out. Without
  `CRON_SECRET`, the cron's secret changes with it: Settings → Supabase Cron → **Reconnect** (the Health card
  shows 401 until then).
- **Rotating `CRON_SECRET`:** change it, redeploy, then **Reconnect** Supabase Cron (the job stores the
  secret).
- **Rotating the bot token:** @BotFather → `/revoke`, set the new `TELEGRAM_BOT_TOKEN`, redeploy,
  then Settings → Telegram → **Connect commands**: the webhook's secret is derived from the token.
- **Rotating the VAPID keys:** `npx web-push generate-vapid-keys`, set both on Vercel, redeploy. The push
  services refuse the new key for the old subscriptions: enable notifications again on each device (the old
  subscriptions are removed as their pushes fail, or with **Disable on this device**).
- **Rotating the database password:** Supabase → Project Settings → Database, then the new password in
  `SUPABASE_DB_URL` on Vercel and in `.env` (both the Session pooler); redeploy.

## Timeouts and the pooler

All the time budgets derive from one platform limit in [`lib/budgets.ts`](../lib/budgets.ts) (a test checks
their relationships and that every `maxDuration` matches):

| Budget              | Value | What                                                                                                     |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `FUNCTION_LIMIT_MS` | 300 s | A function's `maxDuration` (the routes and pages that start work).                                       |
| `OPENAI_TIMEOUT_MS` | 120 s | One OpenAI call.                                                                                         |
| `WRAP_UP_MS`        | 30 s  | After the last AI batch: verdicts, notifications, the run log, unlocking.                                |
| `AI_BUDGET_MS`      | 150 s | A scrape's AI check starts no new batch after this, counted from the run's start.                        |
| `SLICE_MS`          | 150 s | An AI run's slice starts no new round after this.                                                        |
| `SCRAPE_LOCK_MS`    | 280 s | The scrape lock: outlives a live run's last AI batch, frees a crashed one before the next knock (5 min). |
| `AI_RUN_LOCK_MS`    | 180 s | An AI run's lock, renewed after every round and before each OpenAI call.                                 |
| `AD_TIMEOUT_MS`     | 12 s  | One request for an offer's ad.                                                                           |

Elsewhere: a listing page 20 s (`lib/listings/pipeline/fetch.ts`), a Telegram call 15 s, a push 10 s, Supabase Cron's call
20 s (the app answers at once and scrapes after the response).

**The connection** ([`lib/db/client.ts`](../lib/db/client.ts),
[ADR 0001](decisions/0001-drizzle-over-postgrest.md)): postgres.js through Supabase's Session pooler (5432),
at most 3 connections per function instance (each holds a real database connection while open), 10 s to
connect, idle ones closed after 20 s, `prepare: false`. Not the Transaction pooler (6543): through it, with
postgres.js, queries sent back to back on one connection lose their answers, and a page sends a dozen at
once, so pages hang until the function's time limit.

Each connection sends `statement_timeout` 30 s and `lock_timeout` 10 s (and `application_name` `jobwatch`)
as startup parameters, but the Session pooler (Supavisor) doesn't pass them on: the connections run with the
role's `statement_timeout` (2 min), no `lock_timeout` and `application_name` `Supavisor` (`show
statement_timeout` says which). For 30 s and 10 s, set them on the role the app connects as:

```sql
alter role <app role> set statement_timeout = '30s';
alter role <app role> set lock_timeout = '10s';
```

(Better on a role of the app's own than on `postgres`, which migrations and the SQL Editor use too.)
