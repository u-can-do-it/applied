# Jobwatch

A list of the job offers the Node-RED `scrap-offers` flow collects, newest first, with search by title or company and a filter by source.

```
cronplus → scrapers → parsers → store_notifications ─┬─→ flush_queue → Telegram   (unchanged)
                                                     └─→ to_db → write_db → check_db
                                                                    │
                                                         Supabase (Postgres) ← Vercel app
```

"Newest" means `first_seen`, the time Node-RED first saw the offer. It's the only timestamp all six sources share.
(For eldorado, builtin and bulldog, `sortVal` is just an id counter, not a date.)

## 1. Supabase

1. Create a project at supabase.com (the free tier is enough), or add Supabase from the Vercel Marketplace.
2. **SQL Editor** → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. **Project Settings → API Keys**: copy the project URL and a **secret** key (`sb_secret_…`).
   A legacy `service_role` key also works.

RLS is on with no policies, so the public/anon key can't read anything. Only the secret key can, and it's used only server-side.

## 2. Node-RED

1. Make the secret available to Node-RED as env vars `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
   You can set them in the systemd unit / docker `-e` / `.bashrc` of the process running Node-RED,
   or open the `scrap-offers` tab → **Edit flow → Environment variables**. Note that tab env vars end up in flow exports.
2. Open the `scrap-offers` tab, then **Import** [`node-red/db-nodes.json`](node-red/db-nodes.json).
   When it reports a conflict on `store_notifications`, choose **Replace**. The import adds:
   - `store_notifications`: same logic, plus a 2nd output carrying every newly stored offer
     (seeding runs and excluded stacks included, muted or not)
   - `to_db` → `write_db` (http request) → `check_db`: upsert on `(src, id)`, duplicates ignored
   - `backfill (click once)` → `backfill_db`: pushes the offers already in flow context, 500 per request
3. **Deploy**, then click the `backfill` inject node once. `check_db` should turn green with `saved N`.

**Replace** on import needs Node-RED 3.1+. On older versions, don't delete `store_notifications`, because that drops
the wires coming from the six parsers. Instead, paste [`node-red/store_notifications.js`](node-red/store_notifications.js)
into it, set **Outputs** to 2, then import the file and delete the duplicate `store_notifications` it creates.
Finally, wire output 2 to `to_db`.

If you'd rather edit by hand, the function bodies are in `node-red/*.js`.
Rebuild the import file from them with `node scripts/build-flow.mjs`.

## 3. Vercel

```bash
npm install
cp .env.example .env.local   # fill in SUPABASE_URL + SUPABASE_SECRET_KEY
npm run dev                  # http://localhost:3000
```

To deploy, push this folder to a GitHub repo, then **Vercel → Add New → Project → import it**.
Add the same two env vars under **Settings → Environment Variables**, and deploy.
Alternatively, run `npx vercel` from this folder.

## 4. Password and AI filter

1. **Database:** run `scripts/db-migrate.sh`, which applies [`supabase/ai-filter.sql`](supabase/ai-filter.sql) using
   `SUPABASE_DB_URL` from `.env`. You can also paste the file into Supabase → SQL Editor. Either way is safe to re-run.
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
- **Applied tab:** your applications, newest first, with search. Click one for a window with the saved ad, its
  details, "Open original", "Fetch again" (if fetching failed) and "Unmark applied".
- The table is `applications`, created by `scripts/db-migrate.sh`. When the AI merges duplicates, the mark
  moves with the job.

## Notes

- **Search:** each word must appear in the title or the company (`senior react` matches
  "Senior Frontend Developer (React)"). Case-insensitive, updates as you type.
- **Duplicates across sources:** the database keeps every board's copy, and `offers_unique` shows each job once.
  `store_notifications` uses the same rules to skip duplicates on Telegram.
- **Privacy:** the whole app is behind `APP_PASSWORD` (see step 4), and pages are also set to `noindex`.
- **Size:** the database isn't capped at 10,000 like the flow context is. A row is ~300 bytes,
  so Supabase's 500 MB free tier lasts a very long time.
