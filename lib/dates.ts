// Calendar days and clock times are in the app's time zone (Settings → Scraping; by default the
// browser's), whatever the server's (UTC on Vercel) or the device's own is: "1 Oct" means 1 Oct
// 00:00 to 2 Oct 00:00 there. zone(tz) has the helpers that depend on it; the rest here doesn't.

/** Until the app knows the browser's: the zone it always had. */
export const DEFAULT_TZ = 'Europe/Warsaw';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const parts = (day: string) => day.split('-').map(Number) as [number, number, number];

/** "2026-10-01" if it's a real date from 2000 on, otherwise "" */
export function validDay(s: string | undefined | null): string {
  if (!s || !ISO_DAY.test(s)) return '';
  const [y, m, d] = parts(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : '';
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type DateFilter = { days?: string; from?: string; to?: string };

/** "2026-10-02" -> "02.10.2026" ('' if not a real date) */
export function formatDay(day: string | undefined | null): string {
  const v = validDay(day);
  if (!v) return '';
  const [y, m, d] = v.split('-');
  return `${d}.${m}.${y}`;
}

/** "02.10.2026", "2.10.2026", "02/10/2026" or "02-10-2026" -> "2026-10-02" ('' if not a real date) */
export function parseDay(text: string): string {
  const m = text.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return m ? validDay(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`) : '';
}

/** "today", "last 7 days", "20.09.2026 – 28.09.2026", "since 20.09.2026", "until 28.09.2026", "" (no range) */
export function describeRange({ days, from, to }: DateFilter): string {
  const fmt = formatDay;
  if (days === '1') return 'today';
  if (days === 'yesterday') return 'yesterday';
  if (days) return `last ${days} days`;
  const f = validDay(from), t = validDay(to);
  if (f && t) {
    const [a, b] = f <= t ? [f, t] : [t, f];
    return a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`;
  }
  if (f) return `since ${fmt(f)}`;
  if (t) return `until ${fmt(t)}`;
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
  return ['UTC', ...all.filter((z) => z !== 'UTC')];
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
  const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
  const weekdayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' });

  // the zone's UTC offset at an instant, in ms ("GMT+02:00"; plain "GMT" is UTC)
  const offsetMs = (utcMs: number) => {
    const name = offsetFmt.formatToParts(utcMs).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
  };
  const day = (at: Instant = Date.now()) => dayFmt.format(new Date(at));
  const startOfDay = (d: string) => {
    const [y, m, dd] = parts(d);
    const utcMidnight = Date.UTC(y, m - 1, dd);
    // midnight there at the offset around it; where clocks change at midnight one of the two
    // guesses lands on the day before, and where 00:00 is skipped the day starts at the jump
    const a = utcMidnight - offsetMs(utcMidnight);
    const b = utcMidnight - offsetMs(a);
    const onDay = [a, b].filter((t) => day(t) === d);
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
      const n = Number(days);
      if (Number.isInteger(n) && n >= 1 && n <= 366) return { gte: startOfDay(addDays(day(now), -(n - 1))).toISOString() };
      let f = validDay(from);
      let t = validDay(to);
      if (f && t && f > t) [f, t] = [t, f];
      return {
        gte: f ? startOfDay(f).toISOString() : undefined,
        lt: t ? startOfDay(addDays(t, 1)).toISOString() : undefined,
      };
    },
  };
}

const zones = new Map<string, Zone>();

/** The helpers for one zone (an unknown name gets DEFAULT_TZ's). */
export function zone(tz: string): Zone {
  let z = zones.get(tz);
  if (!z) {
    if (!isTimeZone(tz)) return tz === DEFAULT_TZ ? makeZone('UTC') : zone(DEFAULT_TZ);
    z = makeZone(tz);
    zones.set(tz, z);
  }
  return z;
}
