// Time budgets, all derived from the one platform limit, so changing one can't quietly break another
// (test/lib/budgets.test.ts checks the relationships, and that every `maxDuration` matches).

/**
 * How long a function may run (Vercel: `maxDuration`, at most 300 s on the plans this runs on).
 * The `maxDuration` exports themselves stay literal numbers: Next reads them from the source
 * without running it, so `FUNCTION_LIMIT_MS / 1000` there would be ignored.
 */
export const FUNCTION_LIMIT_MS = 300_000;

/** One OpenAI call (an assessment batch or a duplicate check) gives up after this. */
export const OPENAI_TIMEOUT_MS = 120_000;

/** One request for an offer's ad (lib/ads/fetch.ts). */
export const AD_TIMEOUT_MS = 12_000;

/** One page fetched through ScrapingAnt (lib/scraping-ant.ts), all its tries, once its turn comes. */
export const SCRAPING_ANT_TIMEOUT_MS = 25_000;

/**
 * The longest a page waits for its turn at ScrapingAnt (one request at a time): past it, it fails and is
 * tried again later, so a batch's ads still fit in an AI run's lock.
 */
export const SCRAPING_ANT_WAIT_MS = 30_000;

/** After the last AI batch: saving verdicts, Telegram, the run log, unlocking. */
export const WRAP_UP_MS = 30_000;

/**
 * A scrape run's AI check starts no new batch after this much of the run, counted from its start:
 * the last batch, which can take a full OpenAI timeout, and the wrap-up still fit in the function.
 */
export const AI_BUDGET_MS = FUNCTION_LIMIT_MS - OPENAI_TIMEOUT_MS - WRAP_UP_MS;

/** An AI run's slice starts no new round after this; same shape as AI_BUDGET_MS. */
export const SLICE_MS = FUNCTION_LIMIT_MS - OPENAI_TIMEOUT_MS - WRAP_UP_MS;

/**
 * The scrape lock: outlives the last moment a live run can still be in an AI batch, so no second
 * run starts under it, yet a crashed run frees it before the next knock (the shortest interval
 * Settings offers is five minutes).
 */
export const SCRAPE_LOCK_MS = AI_BUDGET_MS + OPENAI_TIMEOUT_MS + 10_000;
export const SCRAPE_LOCK_SECONDS = SCRAPE_LOCK_MS / 1000;

/**
 * An AI run's lock, renewed after every round and again right before each OpenAI call: longer than
 * either part of a round (fetching a batch's ads, a few at once; the OpenAI call), so no second
 * worker starts while a round is still out; a dead worker's run is picked up again a minute or so
 * after it would have finished.
 */
export const AI_RUN_LOCK_MS = OPENAI_TIMEOUT_MS + 60_000;
