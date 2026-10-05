# Jobwatch

Job offers from several boards in one list, newest first, with search, filters, an AI filter that judges
each job against your profile, and tracking of the applications you send. Jobwatch scrapes the boards itself
on a schedule and sends new offers as push notifications to your phone (it installs as an app) and to
Telegram. One user, one password; a Next.js app on Vercel with a Supabase Postgres database.

```
Supabase Cron ─(schedule from Settings)─→ /api/cron/scrape ─┐
"Scrape now" ───────────────────────────→ /api/scrape ──────┼─→ scrape pipeline ─→ Postgres (offers)
Telegram /scrape ───────────────────────→ /api/telegram ────┘   (boards → filters)  └→ AI filter ─→ Telegram, push
AI tab ─→ AI runs (duplicates → assessment, OpenAI) ─→ verdicts      Applied tab ─→ applications + ad text
```

## Quick start

Node from `.nvmrc` and Docker. A local database (Supabase's image: the migrations need its roles and `pg_cron`):

```bash
docker run -d --name jobwatch-db -e POSTGRES_PASSWORD=local -p 127.0.0.1:5432:5432 supabase/postgres:17.4.1.054
npm install                  # meanwhile the database starts (it restarts once after its init scripts)
cp -n .env.example .env      # set SUPABASE_DB_URL=postgresql://postgres:local@localhost:5432/postgres
npm run db:migrate           # tables, view, functions, default settings and scrapers
npm run dev                  # http://localhost:3000 (no login without APP_PASSWORD)
```

Then Settings → **Scrape now**. `npm test` runs the unit tests, `npm run test:db` the database tests on a
throwaway container.

To deploy (Supabase, Vercel, Supabase Cron, push notifications, Telegram, OpenAI): [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data flow, tables, lifecycles, module map, glossary.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): deploy, environment variables, database and migrations, cron,
  notifications (push on Android, Telegram), health, logs, recovery.
- [CONTRIBUTING.md](CONTRIBUTING.md): where things live, adding a board, conventions, tests, CI.
- [docs/decisions/](docs/decisions): why it's built this way (ADRs).
