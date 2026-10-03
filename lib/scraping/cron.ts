import { zone } from '../dates';
import { effectiveTimeZone, type ScrapeSettings } from './kinds';

// Supabase Cron's schedule, made from the settings: the interval, only within the hours, and off
// while scraping is paused. pg_cron runs in UTC, so the hours are the app's time zone's turned
// into UTC for every offset the zone has in a year (summer and winter time): an hour wider than the
// window where clocks change. The app still keeps to the exact hours (checkDue).

type Schedule = Pick<ScrapeSettings, 'everyMinutes' | 'fromHour' | 'toHour' | 'timeZone' | 'browserTimeZone'>;

/** UTC hours ("5-20", "0-2,11-23", "*") covering from:00–to:00 in the zone, all year round. */
export function utcHours(from: number, to: number, tz: string, year = new Date().getUTCFullYear()): string {
  if (from === to) return '*';
  const z = zone(tz);
  const offsets = new Set<number>();
  for (let m = 0; m < 12; m++) for (const d of [1, 15]) offsets.add(z.offset(Date.UTC(year, m, d, 12)));
  const len = from < to ? to - from : 24 - from + to; // 22–6 runs over night
  const hours = new Set<number>();
  for (const off of offsets) {
    const start = from - off / 60; // a half-hour zone starts mid-hour: that hour counts
    for (let h = Math.floor(start); h < Math.ceil(start + len); h++) hours.add(((h % 24) + 24) % 24);
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
// (that a run comes every 2 h is checkDue's part).
export function cronSchedule(s: Schedule): string {
  const minute = s.everyMinutes < 60 ? `*/${s.everyMinutes}` : '0';
  return `${minute} ${utcHours(s.fromHour, s.toHour, effectiveTimeZone(s))} * * *`;
}

/** "every 10 min, 7:00–22:00 (Europe/Warsaw)" */
export function describeSchedule(s: Schedule): string {
  const every = s.everyMinutes < 60 ? `${s.everyMinutes} min` : `${s.everyMinutes / 60} h`;
  const hours = s.fromHour === s.toHour ? 'all day' : `${s.fromHour}:00–${s.toHour}:00`;
  return `every ${every}, ${hours} (${effectiveTimeZone(s).replaceAll('_', ' ')})`;
}
