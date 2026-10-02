import 'server-only';
import { hmac, sameString } from '../auth';
import { getSettings, getState, markCall } from './store';

// Who may call /api/cron/scrape, and whether a run is due when it's called. The caller (Supabase
// Cron, Node-RED, anything) just knocks every few minutes; interval and hours live in Settings.

/** CRON_SECRET if set (Vercel Cron sends that one by itself), else derived from APP_PASSWORD. */
export async function cronSecret(): Promise<string | null> {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  if (process.env.APP_PASSWORD) return hmac(process.env.APP_PASSWORD, 'jobwatch-cron-v1');
  return null;
}

/** Authorization: Bearer <secret>. Without any secret only a local dev server lets it through. */
export async function isCronRequest(req: Request) {
  const secret = await cronSecret();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return sameString(req.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: 'numeric', hourCycle: 'h23' });
export const warsawHour = (d: Date) => Number(hourFormat.format(d));
/** from..to in whole hours; 22..6 runs over night; equal = all day */
export const inHours = (h: number, from: number, to: number) => from === to || (from < to ? h >= from && h < to : h >= from || h < to);

export async function checkDue(now = new Date()): Promise<{ due: boolean; reason?: string }> {
  const [settings, state] = await Promise.all([getSettings(), getState(), markCall()]);
  if (!settings.enabled) return { due: false, reason: 'scraping is paused in Settings' };
  if (!inHours(warsawHour(now), settings.fromHour, settings.toHour)) {
    return { due: false, reason: `outside ${settings.fromHour}:00–${settings.toHour}:00 Warsaw time` };
  }
  // a minute of slack: a caller every 5 min isn't exactly 300 s apart
  const since = now.getTime() - (state.last_run_at ? Date.parse(state.last_run_at) : 0);
  if (since < settings.everyMinutes * 60_000 - 60_000) return { due: false, reason: `the last run was less than ${settings.everyMinutes} min ago` };
  return { due: true };
}

/** This deployment's public address, for Supabase Cron and the Telegram webhook. */
export function appOrigin(host?: string | null, proto?: string | null) {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return host ? `${proto ?? 'https'}://${host}` : 'http://localhost:3000';
}
