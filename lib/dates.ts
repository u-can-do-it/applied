// Calendar days and clock times are in the app's time zone (Settings → Scraping; by default the
// browser's), whatever the server's (UTC on Vercel) or the device's own is: "1 Oct" means 1 Oct
// 00:00 to 2 Oct 00:00 there. zoneOf(tz) has the helpers that depend on it; the rest here doesn't.

/** Until the app knows the browser's: the zone it always had. */
export const DEFAULT_TZ = 'Europe/Warsaw';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const parts = (day: string) => day.split('-').map(Number) as [number, number, number];

/** "2026-10-01" if it's a real date from 2000 on, otherwise "" */
export function validDay(value: string | undefined | null): string {
  if (!value || !ISO_DAY.test(value)) return '';
  const [year, month, dayOfMonth] = parts(value);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return year >= 2000 && date.getUTCMonth() === month - 1 && date.getUTCDate() === dayOfMonth ? value : '';
}

export function addDays(day: string, count: number): string {
  const [year, month, dayOfMonth] = parts(day);
  return new Date(Date.UTC(year, month - 1, dayOfMonth + count)).toISOString().slice(0, 10);
}

export type DateFilter = { days?: string; from?: string; to?: string };

/** "2026-10-02" -> "02.10.2026" ('' if not a real date) */
export function formatDay(day: string | undefined | null): string {
  const valid = validDay(day);
  if (!valid) return '';
  const [year, month, dayOfMonth] = valid.split('-');
  return `${dayOfMonth}.${month}.${year}`;
}

/** "02.10.2026", "2.10.2026", "02/10/2026" or "02-10-2026" -> "2026-10-02" ('' if not a real date) */
export function parseDay(text: string): string {
  const match = text.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return match ? validDay(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`) : '';
}

/** "today", "last 7 days", "20.09.2026 – 28.09.2026", "since 20.09.2026", "until 28.09.2026", "" (no range) */
export function describeRange({ days, from, to }: DateFilter): string {
  const fmt = formatDay;
  if (days === '1') return 'today';
  if (days === 'yesterday') return 'yesterday';
  if (days) return `last ${days} days`;
  const fromDay = validDay(from),
    toDay = validDay(to);
  if (fromDay && toDay) {
    const [first, last] = fromDay <= toDay ? [fromDay, toDay] : [toDay, fromDay];
    return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
  }
  if (fromDay) return `since ${fmt(fromDay)}`;
  if (toDay) return `until ${fmt(toDay)}`;
  return '';
}

// ---- time zones ----------------------------------------------------------------------

/** A zone name this runtime knows ("Europe/Warsaw", "UTC"). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Every zone, for a picker: UTC, then by name. */
export function timeZones(): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [DEFAULT_TZ];
  return ['UTC', ...all.filter((name) => name !== 'UTC')];
}

/** This device's zone (in the browser: the browser's). */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(tz) ? tz : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

type Instant = string | number | Date;

export type Zone = {
  tz: string;
  /** YYYY-MM-DD of an instant (now if none) */
  day: (at?: Instant) => string;
  /** "02.10.2026" */
  formatDayOf: (at: Instant) => string;
  /** "14:35" */
  formatTime: (at: Instant) => string;
  /** "02.10.2026 14:35" */
  formatDateTime: (at: Instant) => string;
  /** "Thu" */
  weekday: (at: Instant) => string;
  /** 0–23 */
  hour: (at: Instant) => number;
  /** minutes ahead of UTC at that instant (120 for Warsaw in summer) */
  offset: (at: Instant) => number;
  /** The instant of 00:00 there on that day */
  startOfDay: (day: string) => Date;
  /** URL filter -> half-open UTC range [gte, lt) on first_seen. Bad input is ignored, a reversed range is swapped. */
  resolveRange: (filter: DateFilter, now?: number) => { gte?: string; lt?: string };
};

function makeZone(tz: string): Zone {
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); // -> YYYY-MM-DD
  const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
  const weekdayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });

  // the zone's UTC offset at an instant, in ms ("GMT+02:00"; plain "GMT" is UTC)
  const offsetMs = (utcMs: number) => {
    const name = offsetFmt.formatToParts(utcMs).find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : 0;
  };
  const day = (at: Instant = Date.now()) => dayFmt.format(new Date(at));
  const startOfDay = (isoDay: string) => {
    const [year, month, dayOfMonth] = parts(isoDay);
    const utcMidnight = Date.UTC(year, month - 1, dayOfMonth);
    // midnight there at the offset around it; where clocks change at midnight one of the two
    // guesses lands on the day before, and where 00:00 is skipped the day starts at the jump
    const a = utcMidnight - offsetMs(utcMidnight);
    const b = utcMidnight - offsetMs(a);
    const onDay = [a, b].filter((guess) => day(guess) === isoDay);
    return new Date(onDay.length ? Math.min(...onDay) : a);
  };
  const formatTime = (at: Instant) => timeFmt.format(new Date(at));
  const formatDayOf = (at: Instant) => formatDay(day(at));

  return {
    tz,
    day,
    formatDayOf,
    formatTime,
    formatDateTime: (at) => `${formatDayOf(at)} ${formatTime(at)}`,
    weekday: (at) => weekdayFmt.format(new Date(at)),
    hour: (at) => Number(hourFmt.format(new Date(at))) % 24,
    offset: (at) => offsetMs(new Date(at).getTime()) / 60_000,
    startOfDay,
    resolveRange: ({ days, from, to }, now = Date.now()) => {
      if (days === 'yesterday') {
        const today = day(now);
        return { gte: startOfDay(addDays(today, -1)).toISOString(), lt: startOfDay(today).toISOString() };
      }
      const dayCount = Number(days);
      if (Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 366)
        return { gte: startOfDay(addDays(day(now), -(dayCount - 1))).toISOString() };
      let fromDay = validDay(from);
      let toDay = validDay(to);
      if (fromDay && toDay && fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
      return {
        gte: fromDay ? startOfDay(fromDay).toISOString() : undefined,
        lt: toDay ? startOfDay(addDays(toDay, 1)).toISOString() : undefined,
      };
    },
  };
}

const zones = new Map<string, Zone>();

/** The helpers for one zone (an unknown name gets DEFAULT_TZ's). */
export function zoneOf(tz: string): Zone {
  let zone = zones.get(tz);
  if (!zone) {
    if (!isTimeZone(tz)) return tz === DEFAULT_TZ ? makeZone('UTC') : zoneOf(DEFAULT_TZ);
    zone = makeZone(tz);
    zones.set(tz, zone);
  }
  return zone;
}
