// Calendar days are Warsaw days: "1 Oct" means 1 Oct 00:00 to 2 Oct 00:00 Europe/Warsaw,
// whatever the server's (UTC on Vercel) or the browser's timezone is.
export const TZ = 'Europe/Warsaw';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }); // -> YYYY-MM-DD
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });

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

export const todayInWarsaw = (now = Date.now()) => dayFmt.format(now);

// Warsaw's UTC offset at a given instant, in ms (+1h in winter, +2h in summer)
function offsetMs(utcMs: number): number {
  const name = offsetFmt.formatToParts(utcMs).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
}

/** The UTC instant of 00:00 Warsaw time on that day. DST switches at 02:00/03:00, so midnight's offset is the day's. */
export function startOfDay(day: string): Date {
  const [y, m, d] = parts(day);
  const utcMidnight = Date.UTC(y, m - 1, d);
  return new Date(utcMidnight - offsetMs(utcMidnight));
}

export type DateFilter = { days?: string; from?: string; to?: string };

/** URL filter -> half-open UTC range [gte, lt) on first_seen. Bad input is ignored, a reversed range is swapped. */
export function resolveRange({ days, from, to }: DateFilter, now = Date.now()): { gte?: string; lt?: string } {
  if (days === 'yesterday') {
    const today = todayInWarsaw(now);
    return { gte: startOfDay(addDays(today, -1)).toISOString(), lt: startOfDay(today).toISOString() };
  }
  const n = Number(days);
  if (Number.isInteger(n) && n >= 1 && n <= 366) {
    return { gte: startOfDay(addDays(todayInWarsaw(now), -(n - 1))).toISOString() };
  }
  let f = validDay(from);
  let t = validDay(to);
  if (f && t && f > t) [f, t] = [t, f];
  return {
    gte: f ? startOfDay(f).toISOString() : undefined,
    lt: t ? startOfDay(addDays(t, 1)).toISOString() : undefined,
  };
}

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
