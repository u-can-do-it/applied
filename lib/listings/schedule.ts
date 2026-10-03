import 'server-only';
import { headers } from 'next/headers';
import { hmac, sameString } from '../auth';
import * as cronRepo from '../db/repos/cron';
import * as settingsRepo from '../db/repos/scrape-settings';
import * as stateRepo from '../db/repos/scrape-state';
import { zone } from '../dates';
import { env } from '../env';
import { message } from '../shared/errors';
import { cronSchedule } from './cron';
import { effectiveTimeZone, type ScrapeSettings } from './settings';

// Who may call /api/cron/scrape, and whether a run is due when it's called. Supabase Cron just
// knocks every few minutes; interval, hours and the pause live in Settings.

/** CRON_SECRET if set, else derived from APP_PASSWORD. */
export async function cronSecret(): Promise<string | null> {
  if (env.CRON_SECRET) return env.CRON_SECRET;
  if (env.APP_PASSWORD) return hmac(env.APP_PASSWORD, 'jobwatch-cron-v1');
  return null;
}

/** Authorization: Bearer <secret>. Without any secret only a local dev server lets it through. */
export async function isCronRequest(req: Request) {
  const secret = await cronSecret();
  if (!secret) return env.NODE_ENV !== 'production';
  return sameString(req.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/** from..to in whole hours; 22..6 runs over night; equal = all day */
export const inHours = (h: number, from: number, to: number) =>
  from === to || (from < to ? h >= from && h < to : h >= from || h < to);

export async function checkDue(now = new Date()): Promise<{ due: boolean; reason?: string }> {
  const [settings, state] = await Promise.all([settingsRepo.get(), stateRepo.get(), stateRepo.markCall()]);
  if (!settings.enabled) return { due: false, reason: 'scraping is paused in Settings' };
  const z = zone(effectiveTimeZone(settings)); // the hours are the app's time zone's
  if (!inHours(z.hour(now), settings.fromHour, settings.toHour)) {
    return { due: false, reason: `outside ${settings.fromHour}:00–${settings.toHour}:00 ${z.tz} time` };
  }
  // a minute of slack: calls every N min aren't exactly N min apart
  const since = now.getTime() - (state.lastRunAt ? Date.parse(state.lastRunAt) : 0);
  if (since < settings.everyMinutes * 60_000 - 60_000)
    return { due: false, reason: `the last run was less than ${settings.everyMinutes} min ago` };
  return { due: true };
}

/**
 * Gives Supabase Cron the schedule the settings make (and switches it off while paused). Nothing to
 * do if it isn't connected. null = done; else what went wrong, for the answer to the change.
 */
export async function syncCron(s: ScrapeSettings): Promise<string | null> {
  try {
    const r = await cronRepo.reschedule(cronSchedule(s), s.enabled);
    return r === 'ok' || r === 'not connected' ? null : r;
  } catch (e) {
    return message(e);
  }
}

/** This deployment's public address, for Supabase Cron and the Telegram webhook. */
function appOrigin(host?: string | null, proto?: string | null) {
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return host ? `${proto ?? 'https'}://${host}` : 'http://localhost:3000';
}

/** This app's address as the browser reached it (behind Vercel's proxy too), or the production one. */
export async function requestOrigin() {
  const request = await headers();
  return appOrigin(request.get('x-forwarded-host') ?? request.get('host'), request.get('x-forwarded-proto'));
}
