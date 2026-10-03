'use server';

import { refresh } from 'next/cache';
import { action } from '@/lib/action';
import { cronSchedule } from '@/lib/scraping/cron';
import type { ScrapeSettings } from '@/lib/scraping/kinds';
import { notify, runAll, scrape, type PageResult } from '@/lib/scraping/run';
import { cronSecret, requestOrigin, syncCron } from '@/lib/scraping/schedule';
import * as cronRepo from '@/lib/db/repos/cron';
import * as offersRepo from '@/lib/db/repos/offers';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import { message } from '@/lib/shared/errors';
import { noInput } from '@/lib/shared/schemas/common';
import { scraperIdSchema, scraperSchema, toggleScraperSchema } from '@/lib/shared/schemas/scrapers';
import {
  filtersSchema,
  mutedSchema,
  pausedSchema,
  scheduleSchema,
  switchSchema,
  timeZoneSchema,
} from '@/lib/shared/schemas/settings';
import { connectWebhook, disconnectWebhook, sendMessage, telegramReady } from '@/lib/telegram';

// The answers that say something ("Saved.") are their data; the rest answer with nothing.

// ---- runs -------------------------------------------------------------------------------

/** The "Scrape now" button: a full run, whatever the schedule says. The AI check and Telegram
 * continue after the answer, so the button doesn't wait for OpenAI. */
export const scrapeNowAction = action(noInput, async () => {
  const summary = await runAll('manual', { background: true });
  refresh();
  return summary;
});

// ---- settings -----------------------------------------------------------------------------

/** Saves settings that make Supabase Cron's schedule, and gives it the new one (if it's connected). */
async function saveSchedule(next: ScrapeSettings) {
  await settingsRepo.save(next);
  const cronError = await syncCron(next);
  refresh();
  return cronError ? `Saved, but Supabase Cron kept its old schedule: ${cronError}` : 'Saved.';
}

/** The app's time zone: '' = the browser's (`browser`: the one it's in now), or a fixed one. */
export const setTimeZoneAction = action(timeZoneSchema, async ({ tz, browser }) => {
  const settings = await settingsRepo.get();
  return saveSchedule({ ...settings, timeZone: tz, browserTimeZone: browser ?? settings.browserTimeZone });
});

/** Pause / resume the scheduled runs ("Scrape now" works either way); paused, Supabase Cron is off too. */
export const setScrapingPausedAction = action(pausedSchema, async ({ paused }) =>
  saveSchedule({ ...(await settingsRepo.get()), enabled: !paused }),
);

export const saveScheduleAction = action(scheduleSchema, async (schedule) =>
  saveSchedule({ ...(await settingsRepo.get()), ...schedule }),
);

export const saveFiltersAction = action(filtersSchema, async (filters) => {
  if (!filters.keywords.length) {
    const uses = (await scrapersRepo.list()).find(
      (scraper) => scraper.enabled && /\{keyword(_slug)?\}/.test(scraper.config.url),
    );
    if (uses) throw new Error(`Add at least one keyword: ${uses.name}'s link has {keyword} in it.`);
  }
  await settingsRepo.save({ ...(await settingsRepo.get()), ...filters });
  refresh();
  return 'Saved. The next run uses them.';
});

export const setNotifyAction = action(switchSchema, async ({ on }) => {
  await settingsRepo.save({ ...(await settingsRepo.get()), notify: on });
  refresh();
});

export const setAiFilterAction = action(switchSchema, async ({ on }) => {
  await settingsRepo.save({ ...(await settingsRepo.get()), aiFilter: on });
  refresh();
});

// ---- scrapers -----------------------------------------------------------------------------

/** Answers with the scraper's id (a new one's, when added). */
export const saveScraperAction = action(scraperSchema, async ({ id, scraper }) => {
  if (id) {
    const old = await scrapersRepo.get(id);
    if (!old) throw new Error('This scraper no longer exists.');
    // a different search: its first run only saves, so Telegram isn't flooded with "new" old offers
    const changed = old.kind !== scraper.kind || old.src !== scraper.src || old.config.url !== scraper.config.url;
    await scrapersRepo.update(id, scraper, changed);
    refresh();
    return id;
  }
  const all = await scrapersRepo.list();
  const added = await scrapersRepo.insert({
    ...scraper,
    position: Math.max(0, ...all.map((existing) => existing.position)) + 1,
  });
  refresh();
  return added;
});

export const toggleScraperAction = action(toggleScraperSchema, async ({ id, enabled }) => {
  await scrapersRepo.update(id, { enabled });
  refresh();
});

export const deleteScraperAction = action(scraperIdSchema, async ({ id }) => {
  await scrapersRepo.remove(id);
  refresh();
});

export type TestOffer = {
  id: string;
  title: string;
  company: string | null;
  url: string;
  remote: boolean;
  locations: string[];
  seniority: string | null;
  known: boolean;
};
export type TestResult = {
  ok: boolean;
  error: string | null;
  found: number;
  kept: number;
  fresh: number;
  skipped: { keyword: number; area: number; ignored: number };
  pages: PageResult[];
  offers: TestOffer[];
  sample?: string;
  ms: number;
};

/** Fetches with the form's current values; nothing is saved. */
export const testScraperAction = action(scraperSchema, async ({ scraper }): Promise<TestResult> => {
  const result = await scrape(scraper, await settingsRepo.get());
  const known = await offersRepo
    .knownIds(
      scraper.src,
      result.kept.slice(0, 200).map((offer) => offer.id),
    )
    .catch(() => new Set<string>());
  return {
    ok: result.ok,
    error: result.error,
    found: result.found,
    kept: result.kept.length,
    fresh: result.kept.slice(0, 200).filter((offer) => !known.has(offer.id)).length,
    skipped: result.skipped,
    pages: result.pages,
    offers: result.kept.slice(0, 25).map((offer) => ({
      id: offer.id,
      title: offer.title,
      company: offer.company,
      url: offer.url,
      remote: offer.remote,
      locations: offer.locations.slice(0, 3),
      seniority: offer.seniority,
      known: known.has(offer.id),
    })),
    sample: result.sample,
    ms: result.ms,
  };
});

// ---- Telegram -------------------------------------------------------------------------------

/** Unmuting sends what waited right away (not after the answer), so the page shows an empty queue. */
export const setMutedAction = action(mutedSchema, async ({ muted }) => {
  await stateRepo.setMuted(muted);
  const sent: { sent: number; error?: string } =
    !muted && telegramReady()
      ? await notify({ manual: true }).catch((e: unknown) => ({ sent: 0, error: message(e) }))
      : { sent: 0 };
  refresh();
  if (sent.error) throw new Error(`Unmuted, but: ${sent.error}`);
  return muted ? 'Muted: new offers wait in the queue.' : sent.sent ? `Unmuted, sent ${sent.sent}.` : 'Unmuted.';
});

export const sendQueueAction = action(noInput, async () => {
  const sent = await notify({ manual: true });
  refresh();
  if (sent.error) throw new Error(sent.error);
  return sent.sent
    ? `Sent ${sent.sent}.`
    : sent.matched === 0
      ? 'Sent: none of them matched the AI profile.'
      : 'Nothing to send yet.';
});

export const telegramTestAction = action(noInput, async () => {
  await sendMessage('✅ Jobwatch can write to this chat.');
  return 'Sent – check Telegram.';
});

export const telegramConnectAction = action(noInput, async () => {
  await connectWebhook(`${await requestOrigin()}/api/telegram`);
  refresh();
  return 'Connected. Try /status in the chat.';
});

export const telegramDisconnectAction = action(noInput, async () => {
  await disconnectWebhook();
  refresh();
  return 'Disconnected.';
});

// ---- Supabase Cron ------------------------------------------------------------------------

export const cronConnectAction = action(noInput, async () => {
  const secret = await cronSecret();
  if (!secret) throw new Error('Set APP_PASSWORD (or CRON_SECRET) first: the endpoint needs a secret.');
  const settings = await settingsRepo.get();
  const connected = await cronRepo.connect(
    `${await requestOrigin()}/api/cron/scrape`,
    secret,
    cronSchedule(settings),
    settings.enabled,
  );
  refresh();
  // the box above says when it calls; that changes with the settings, this answer wouldn't
  if (connected !== 'ok') throw new Error(connected);
  return 'Connected.';
});

export const cronDisconnectAction = action(noInput, async () => {
  const stopped = await cronRepo.disconnect();
  refresh();
  if (stopped !== 'ok') throw new Error(stopped);
  return 'Stopped.';
});
