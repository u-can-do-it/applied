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

## Notes

- **Search:** each word must appear in the title or the company (`senior react` matches
  "Senior Frontend Developer (React)"). Case-insensitive, updates as you type.
- **Duplicates across sources:** the same job listed on two boards shows up twice, once per source,
  because the database stores every source's copy (`store_notifications` only skips the duplicate for Telegram).
- **Privacy:** the Vercel production URL is public. The page is set to `noindex`, but anyone with the
  link can see the list. On the free plan, Vercel's Deployment Protection covers only preview URLs, so
  hiding production would need a password check in the app.
- **Size:** the database isn't capped at 10,000 like the flow context is. A row is ~300 bytes,
  so Supabase's 500 MB free tier lasts a very long time.
