# Jobwatch

Job offers from several boards, newest first, with search, filters, an AI filter and application tracking.
The app scrapes the boards itself (it used to be a Node-RED flow) and sends new offers to Telegram.

```
Supabase Cron ──every 5 min──→ /api/cron/scrape (Vercel) ─→ scrapers → filters → Supabase (offers)
"↻ Scrape now" ───────────────────────────────────────────┘                    └→ Telegram (new jobs)
Telegram /mute /send /status ─→ /api/telegram
```

"Newest" means `first_seen`, the time an offer was first scraped. It's the only timestamp all boards share.

## 1. Supabase

1. Create a project at supabase.com (the free tier is enough), or add Supabase from the Vercel Marketplace.
2. **SQL Editor** → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. **Project Settings → API Keys**: copy the project URL and a **secret** key (`sb_secret_…`).
   A legacy `service_role` key also works.

RLS is on with no policies, so the public/anon key can't read anything. Only the secret key can, and it's used only server-side.

## 2. Scraping (Settings tab)

Everything Node-RED had in its nodes is in **Settings** now:

- **Scraping:** on/off, every 5–120 min, between which hours (Warsaw time). The last runs with what they found,
  and the errors per board.
- **Filters:** keywords (searched on every board through `{keyword}` in the links, and required in the offer's
  title or skills), cities ("warszaw" matches Warszawa and Warszawie), remote OK, titles to skip, and titles to save
  without a Telegram message (Node-RED's `.net, dotnet, go, golang, java`).
- **Telegram:** mute / unmute (new offers wait in a queue meanwhile), send the queue, a test message, and the chat
  commands `/mute /resume /send /scrape /status`.
- **AI filter for Telegram** (on by default): new offers are checked against the active AI profile right after
  scraping, the way the AI tab does it (the verdicts show up there too). The message lists only the matches, with
  their fit; when nothing matches it just says how many new offers there are, with a link to the rejected ones.
  While OpenAI doesn't answer, the offers wait; after 20 minutes they're sent anyway, marked "not checked". Without a
  usable profile or `OPENAI_API_KEY`, everything is sent as before. "Scrape now" doesn't wait for the AI: the check
  and the message follow in the background.
- **Scrapers:** the six boards with Node-RED's links, parsers and filters (they give the same offers, ids and links,
  so nothing gets duplicated), and LinkedIn's public job search (no login; two searches: Warszawa, and remote in
  Poland). LinkedIn's search isn't sorted by date, so its searches take what was posted in the last hour
  (`f_TPR=r3600`), two pages each (`{start}` in a link + Pages in the scraper: 0, 10, 20…; `{page}`: 1, 2, 3…). LinkedIn's cards have no skills, so its keyword check looks at the title only: untick it in the scraper to
  get everything LinkedIn's search finds (it also matches descriptions). LinkedIn doesn't allow scraping in its terms
  and may refuse requests from servers; the scraper then shows the error. Each can be switched off, edited (link, headers, keyword / city check) or copied,
  e.g. a second JustJoin search. Add your own: **JSON** (any API, or the JSON inside a page: `__NEXT_DATA__`,
  JSON-LD, a `<script id>`), **HTML** (CSS selectors) or **RSS/Atom**. **Test** shows what a scraper finds, which of
  it is new, and the first offer's raw JSON/HTML to find the paths or selectors. Nothing is saved by a test.

How a run decides what to send, like `store_notifications` did: an offer is new if its board + id isn't in the
database; it's announced if it's also newer than anything that scraper saw before (bumped old offers aren't), the
same job (company + title) isn't already known from another board, and its title isn't muted. A scraper's first run
only saves, so a new or changed scraper doesn't flood Telegram.

**Setup:**

1. `scripts/db-migrate.sh` (adds the tables, the six scrapers and the default settings, and turns on `pg_cron` +
   `pg_net` for Supabase Cron).
2. Vercel → Settings → Environment Variables: `TELEGRAM_BOT_TOKEN` (@BotFather → /mybots → API Token) and
   `TELEGRAM_CHAT_ID` (the `chatId` in Node-RED's `flush_queue`). Redeploy.
3. Open Settings → **↻ Scrape now** at the top. Check that every board shows ✓ (sites can block Vercel's servers;
   the error says so).
4. **Stop Node-RED**, or it sends its own messages for the same offers.
5. Settings → **Connect Supabase Cron**: Supabase calls `/api/cron/scrape` every 5 minutes, the app decides if a
   run is due (interval, hours, on/off). Vercel's own cron can't do this on the free plan: Hobby allows one run a day.
6. Settings → Telegram → **Connect commands** (after Node-RED is off: a bot gets commands by webhook or by
   polling, not both).

Any other scheduler works too (Node-RED's inject node, cron-job.org, Vercel Cron on Pro): `GET /api/cron/scrape`
with `Authorization: Bearer <secret>`, shown in Settings. The secret is `CRON_SECRET` if set, otherwise derived from
`APP_PASSWORD` (changing the password changes it: reconnect Supabase Cron then). `?force=1` runs even if not due,
`?wait=1` answers with the result.

The old flow is still in [`node-red/`](node-red/) for reference.

## 3. Vercel

```bash
npm install
cp .env.example .env.local   # fill in SUPABASE_URL + SUPABASE_SECRET_KEY (the rest is optional)
npm run dev                  # http://localhost:3000
```

To deploy, push this folder to a GitHub repo, then **Vercel → Add New → Project → import it**.
Add the same two env vars under **Settings → Environment Variables**, and deploy.
Alternatively, run `npx vercel` from this folder.

## 4. Password and AI filter

1. **Database:** run `scripts/db-migrate.sh`, which applies [`supabase/ai-filter.sql`](supabase/ai-filter.sql) and
   [`supabase/scraping.sql`](supabase/scraping.sql) using `SUPABASE_DB_URL` from `.env`. You can also paste the file into Supabase → SQL Editor. Either way is safe to re-run.
   It adds:
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
- **Note:** free text per application (recruiter, salary you asked for, interview questions, next steps…), up to
  10 000 characters. It saves itself as you type and when you close the window. Until it's saved it's also kept in
  the browser, so a dropped connection doesn't lose it. The list shows its first line.
- **Status:** every application starts as *Submitted · In progress*.
  - Stages: Submitted → Initial contact (they got back to you) → Screening / online test → Technical interview →
    HR interview → Offer. Reaching a later stage counts the earlier contact as made.
  - Each stage's outcome: In progress, Passed, Rejected, Ghosted.
  - Set both in the window; every change goes into the history with its date. A step clicked by mistake goes with
    its ×.
  - No news for 30 days since the last change (or since applying): it becomes *Ghosted* by itself, at the same
    stage (in progress, or passed and waiting for the next step; not an accepted offer). The step says "(auto)".
- **Statistics** at the top of the tab:
  - Tiles: sent, positive replies, offers, in progress, rejected, ghosted.
  - A funnel of how many reached each stage, as % of all sent. It's not "% of the previous stage", because technical
    and HR come in either order.
  - A stage × outcome table.
  - Click a tile, a funnel bar or a number to filter the list.
- The table is `applications`, created by `scripts/db-migrate.sh`. When the AI merges duplicates, the mark, its
  status and the note move with the job (if both copies were marked, the notes are joined).

## Notes

- **Search:** each word must appear in the title or the company (`senior react` matches
  "Senior Frontend Developer (React)"). Case-insensitive, updates as you type.
- **Duplicates across sources:** the database keeps every board's copy, and `offers_unique` shows each job once.
  Telegram gets a job once, whichever board had it first.
- **Privacy:** the whole app is behind `APP_PASSWORD` (see step 4), and pages are also set to `noindex`.
- **Size:** a row is ~300 bytes, so Supabase's 500 MB free tier lasts a very long time. The run log keeps two weeks,
  Supabase Cron's own log a week.
