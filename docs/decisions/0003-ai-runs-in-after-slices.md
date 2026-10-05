# 3. AI runs work in `after()` slices under a lock, continued by the AI tab and by Supabase Cron

- Status: accepted (2026-10-03)
- Context: [ARCHITECTURE.md → AI run](../ARCHITECTURE.md#ai-run)

## Context

An AI run can mean hundreds of OpenAI calls (each up to two minutes) plus fetching every job's ad. The app
runs on Vercel functions, which stop at `maxDuration` (300 s here), and has no queue or worker of its own.
A run whose work only the AI tab started would stall as soon as the tab closed.

## Decision

- A run is a row in `ai_runs` (phase, progress, `lock_until`). The work happens in `after()`, after the
  response, in **slices**: no new round after `SLICE_MS`, so the last OpenAI call and the wrap-up still fit in
  the function (`lib/budgets.ts` derives every budget from `FUNCTION_LIMIT_MS`, and a test checks them).
- A slice takes the run's **lock** (`takeLock`, one statement: of two callers only one gets it) and renews it
  before every OpenAI call. A dead worker's lock runs out (`AI_RUN_LOCK_MS`) and the next slice continues.
- What a slice does next is a **state machine** (`lib/ai/run-state.ts`): load, transition, perform, save. Every
  round is saved, so a slice can stop anywhere.
- Slices are started by whatever comes first: the AI tab (every render while a run is open) or **Supabase
  Cron's** next call to `/api/cron/scrape`, which after its scrape continues every waiting run in its remaining
  time (`continueWaitingRuns`).

A queue service (Inngest, Trigger.dev, QStash) was the alternative: durable steps and retries, but another
service, account and secret for a one-user app. Supabase Cron already calls the app every few minutes.

## Consequences

- No tab needs to stay open while scraping is on and Supabase Cron is connected. With scraping paused or the
  cron not connected, a run only goes on while the AI tab is open.
- A run is "paused" between slices; the run card says so, and the next knock continues it.
- Progress and verdicts are saved after every round, keyed by profile version and job: a slice that dies loses
  at most its current round, and the next one sends only what is still unjudged.
- The scrape's own AI filter uses the same `assessJobs` within the scrape's `AI_BUDGET_MS`, without a run;
  what it doesn't finish waits in the Telegram queue for the next run.
