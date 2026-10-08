import { zoneOf } from '../dates';
import type { CronStatus } from '../db/repos/cron';
import { describeInterval, effectiveTimeZone, type ScrapeSettings } from './settings';

// Supabase Cron's schedule, made from the settings: the interval, only within the hours, and off
// while scraping is paused. pg_cron runs in UTC, so the hours are the app's time zone's turned
// into UTC for every offset the zone has in a year (summer and winter time): an hour wider than the
// window where clocks change. The app still keeps to the exact hours (checkDue).

type Schedule = Pick<
  ScrapeSettings,
  'everyMinutes' | 'weekendEveryMinutes' | 'fromHour' | 'toHour' | 'timeZone' | 'browserTimeZone'
>;

/** UTC hours ("5-20", "0-2,11-23", "*") covering from:00–to:00 in the zone, all year round. */
export function utcHours(from: number, to: number, tz: string, year = new Date().getUTCFullYear()): string {
  if (from === to) return '*';
  const zone = zoneOf(tz);
  const offsets = new Set<number>();
  for (let month = 0; month < 12; month++)
    for (const dayOfMonth of [1, 15]) offsets.add(zone.offset(Date.UTC(year, month, dayOfMonth, 12)));
  const len = from < to ? to - from : 24 - from + to; // 22–6 runs over night
  const hours = new Set<number>();
  for (const off of offsets) {
    const start = from - off / 60; // a half-hour zone starts mid-hour: that hour counts
    for (let hour = Math.floor(start); hour < Math.ceil(start + len); hour++) hours.add(((hour % 24) + 24) % 24);
  }
  if (hours.size === 24) return '*';
  const list = [...hours].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    ranges.push(i === j ? `${list[i]}` : `${list[i]}-${list[j]}`);
    i = j + 1;
  }
  return ranges.join(',');
}

// The cron line, e.g. every 10th minute of 5:00–20:59 UTC. The 1 h and 2 h intervals call hourly
// (that a run comes every 2 h is checkDue's part). It calls as often as the shorter of the weekday and
// weekend intervals every day (pg_cron's days are UTC's): checkDue keeps to the day's own.
export function cronSchedule(schedule: Schedule): string {
  const every = Math.min(schedule.everyMinutes, schedule.weekendEveryMinutes);
  const minute = every < 60 ? `*/${every}` : '0';
  return `${minute} ${utcHours(schedule.fromHour, schedule.toHour, effectiveTimeZone(schedule))} * * *`;
}

/** "every 10 min (weekends 30 min), 7:00–22:00 (Europe/Warsaw)" */
export function describeSchedule(schedule: Schedule): string {
  const every = describeInterval(schedule.everyMinutes);
  const weekend =
    schedule.weekendEveryMinutes === schedule.everyMinutes
      ? ''
      : ` (weekends ${describeInterval(schedule.weekendEveryMinutes)})`;
  const hours = schedule.fromHour === schedule.toHour ? 'all day' : `${schedule.fromHour}:00–${schedule.toHour}:00`;
  return `every ${every}${weekend}, ${hours} (${effectiveTimeZone(schedule).replaceAll('_', ' ')})`;
}

// ---- the connected job, checked against the settings (Settings' cron box, the Health card) ----

type Connected = Pick<CronStatus, 'url' | 'active' | 'schedule' | 'lastStatus' | 'lastError'>;

/**
 * What's wrong with the connected job, in words (null: nothing). It follows the settings (each change
 * reschedules it); one set up before a change, or switched off in Supabase, doesn't.
 */
export function cronProblem(cron: Connected, settings: Schedule & { enabled: boolean }, endpoint: string) {
  const paused = !settings.enabled;
  if (cron.url && cron.url !== endpoint) return `It calls another address than this app’s (${endpoint}).`;
  if (cron.active === false && !paused) return 'The job is switched off in Supabase.';
  if (cron.schedule !== cronSchedule(settings) || cron.active !== !paused)
    return 'Its schedule isn’t the one the settings make (it was set up before they changed).';
  if (cron.lastStatus === 401)
    return 'The app refused the last call (401): the secret changed (APP_PASSWORD or CRON_SECRET).';
  if (cron.lastError) return `The last call failed: ${cron.lastError}.`;
  return null;
}

/** What the app answered the cron's last call, in words. */
export function lastAnswer(cron: Pick<CronStatus, 'lastResult' | 'lastReason' | 'lastStatus'>) {
  if (cron.lastResult === 'skipped') return `skipped${cron.lastReason ? `, ${cron.lastReason}` : ''}`;
  if (cron.lastResult === 'started') return 'a run started';
  if (cron.lastResult === 'done') return 'a run went through';
  return `answered ${cron.lastStatus}`;
}
