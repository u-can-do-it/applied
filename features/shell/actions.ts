'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { isTimeZone } from '@/lib/dates';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { syncCron } from '@/lib/listings/schedule';
import { browserTimeZoneSchema } from '@/lib/shared/schemas/settings';

/**
 * The browser says which zone it's in. Kept as the zone that "the browser's" (the default) means,
 * so the cron and Telegram use it too; the page shows it at once if that's what the app follows.
 */
export const reportBrowserTimeZoneAction = action(browserTimeZoneSchema, async ({ tz }) => {
  if (!isTimeZone(tz)) return;
  // not appSettings(): the page refreshed below is rendered in this same request, and it must
  // read the settings as saved here, not as cached from before
  const settings = await settingsRepo.get().catch(() => null);
  if (!settings || settings.browserTimeZone === tz) return;
  const next = { ...settings, browserTimeZone: tz };
  await settingsRepo.save(next);
  if (settings.timeZone) return; // a zone of its own is picked: nothing that shows or runs changes
  await syncCron(next); // the hours are this zone's now (if that fails, Settings shows it)
  refresh();
});
