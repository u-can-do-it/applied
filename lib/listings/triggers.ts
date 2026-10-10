// What starts a scrape run (scrape_runs.trigger), and its name in the UI: the Health card, the run log
// and its filter all say it the same way. Older runs may say `bookmarklet` (from a browser, before
// ScrapingAnt fetched Eldorado for the server): shown as stored, under All.

export const TRIGGERS = {
  cron: 'Cron',
  manual: 'Scrape now',
  telegram: 'Telegram',
} as const;

export type Trigger = keyof typeof TRIGGERS;

/** A trigger's name; one this version doesn't know, as stored. */
export const triggerLabel = (trigger: string) => (TRIGGERS as Record<string, string>)[trigger] ?? trigger;
