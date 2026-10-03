import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  dateToDay,
  dayToDate,
  DEFAULT_TZ,
  describeRange,
  deviceTimeZone,
  formatDay,
  isTimeZone,
  parseDay,
  timeZones,
  validDay,
  zoneOf,
} from '@/lib/dates';

const at = (iso: string) => new Date(iso).getTime();
const iso = (date: Date) => date.toISOString();

describe('calendar days', () => {
  it('validDay keeps real dates from 2000 on', () => {
    expect(validDay('2026-10-01')).toBe('2026-10-01');
    expect(validDay('2024-02-29')).toBe('2024-02-29');
    expect(validDay('2000-01-01')).toBe('2000-01-01');
  });

  it('validDay rejects impossible, old or malformed dates', () => {
    for (const bad of [
      '2026-02-29',
      '2026-13-01',
      '2026-04-31',
      '1999-12-31',
      '2026-1-01',
      ' 2026-10-01',
      '01.10.2026',
      '',
      null,
      undefined,
    ]) {
      expect(validDay(bad)).toBe('');
    }
  });

  it('addDays crosses months, years and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-01', 0)).toBe('2026-10-01');
    // calendar days, so a DST change in between doesn't matter
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('formatDay and parseDay go between ISO and dd.mm.yyyy', () => {
    expect(formatDay('2026-10-02')).toBe('02.10.2026');
    expect(formatDay('2026-02-30')).toBe('');
    expect(formatDay(undefined)).toBe('');
    expect(parseDay('02.10.2026')).toBe('2026-10-02');
    expect(parseDay('2.10.2026')).toBe('2026-10-02');
    expect(parseDay(' 02/10/2026 ')).toBe('2026-10-02');
    expect(parseDay('02-10-2026')).toBe('2026-10-02');
    expect(parseDay('31.02.2026')).toBe('');
    expect(parseDay('2026-10-02')).toBe('');
    expect(parseDay('02.10.26')).toBe('');
  });

  it('describeRange names a preset or a range', () => {
    expect(describeRange({ days: '1' })).toBe('today');
    expect(describeRange({ days: 'yesterday' })).toBe('yesterday');
    expect(describeRange({ days: '7' })).toBe('last 7 days');
    expect(describeRange({ from: '2026-09-20', to: '2026-09-28' })).toBe('20.09.2026 – 28.09.2026');
    expect(describeRange({ from: '2026-09-28', to: '2026-09-20' })).toBe('20.09.2026 – 28.09.2026');
    expect(describeRange({ from: '2026-09-20', to: '2026-09-20' })).toBe('20.09.2026');
    expect(describeRange({ from: '2026-09-20' })).toBe('since 20.09.2026');
    expect(describeRange({ to: '2026-09-28' })).toBe('until 28.09.2026');
    expect(describeRange({ from: 'nope', to: '2026-02-30' })).toBe('');
    expect(describeRange({})).toBe('');
  });
});

describe('time zone names', () => {
  afterEach(() => vi.restoreAllMocks());

  it('isTimeZone accepts the zones this runtime knows', () => {
    expect(isTimeZone('Europe/Warsaw')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(isTimeZone(120)).toBe(false);
    expect(isTimeZone(null)).toBe(false);
    expect(isTimeZone(`Europe/${'x'.repeat(64)}`)).toBe(false);
  });

  it('timeZones lists UTC first, once', () => {
    const all = timeZones();
    expect(all[0]).toBe('UTC');
    expect(all.filter((name) => name === 'UTC')).toHaveLength(1);
    expect(all).toContain('Europe/Warsaw');
  });

  it('deviceTimeZone falls back to DEFAULT_TZ when the device reports nonsense', () => {
    expect(isTimeZone(deviceTimeZone())).toBe(true);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Nowhere/Land',
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(deviceTimeZone()).toBe(DEFAULT_TZ);
  });
});

describe('zoneOf()', () => {
  const warsaw = zoneOf('Europe/Warsaw');

  it('caches one set of helpers per zone; an unknown zone gets DEFAULT_TZ', () => {
    expect(zoneOf('Europe/Warsaw')).toBe(warsaw);
    expect(zoneOf('Nowhere/Land').tz).toBe(DEFAULT_TZ);
    expect(zoneOf('UTC').tz).toBe('UTC');
  });

  it('day is the calendar day there, not in UTC', () => {
    expect(warsaw.day(at('2026-10-01T21:59:59Z'))).toBe('2026-10-01');
    expect(warsaw.day(at('2026-10-01T22:00:00Z'))).toBe('2026-10-02'); // midnight in summer time (UTC+2)
    expect(warsaw.day(at('2026-01-01T22:59:59Z'))).toBe('2026-01-01');
    expect(warsaw.day(at('2026-01-01T23:00:00Z'))).toBe('2026-01-02'); // midnight in winter time (UTC+1)
    expect(zoneOf('America/New_York').day('2026-10-02T03:00:00Z')).toBe('2026-10-01');
    expect(zoneOf('UTC').day(new Date('2026-10-02T00:00:00Z'))).toBe('2026-10-02');
  });

  it('formats times, days and weekdays there', () => {
    const instant = at('2026-10-01T12:35:00Z');
    expect(warsaw.formatTime(instant)).toBe('14:35');
    expect(warsaw.formatDayOf(instant)).toBe('01.10.2026');
    expect(warsaw.formatDateTime(instant)).toBe('01.10.2026 14:35');
    expect(warsaw.weekday(instant)).toBe('Thu');
    expect(warsaw.hour(instant)).toBe(14);
    expect(warsaw.hour(at('2026-10-01T22:00:00Z'))).toBe(0); // midnight is 0, not 24
    expect(warsaw.formatTime(at('2026-10-01T22:05:00Z'))).toBe('00:05');
  });

  it('offset follows summer and winter time, and odd offsets', () => {
    expect(warsaw.offset(at('2026-07-01T12:00:00Z'))).toBe(120);
    expect(warsaw.offset(at('2026-01-01T12:00:00Z'))).toBe(60);
    expect(zoneOf('UTC').offset(at('2026-07-01T12:00:00Z'))).toBe(0);
    expect(zoneOf('America/New_York').offset(at('2026-07-01T12:00:00Z'))).toBe(-240);
    expect(zoneOf('America/New_York').offset(at('2026-01-01T12:00:00Z'))).toBe(-300);
    expect(zoneOf('Asia/Kolkata').offset(at('2026-07-01T12:00:00Z'))).toBe(330);
    expect(zoneOf('Asia/Kathmandu').offset(at('2026-07-01T12:00:00Z'))).toBe(345);
    expect(zoneOf('Pacific/Chatham').offset(at('2026-01-01T12:00:00Z'))).toBe(825); // +13:45
    // the instant the clocks change (Warsaw, 29 Mar 2026 01:00 UTC)
    expect(warsaw.offset(at('2026-03-29T00:59:59Z'))).toBe(60);
    expect(warsaw.offset(at('2026-03-29T01:00:00Z'))).toBe(120);
  });

  it('startOfDay is 00:00 there', () => {
    expect(iso(warsaw.startOfDay('2026-10-02'))).toBe('2026-10-01T22:00:00.000Z');
    expect(iso(warsaw.startOfDay('2026-01-02'))).toBe('2026-01-01T23:00:00.000Z');
    // the days the clocks change (at 02:00 / 03:00, so midnight keeps the day before's offset)
    expect(iso(warsaw.startOfDay('2026-03-29'))).toBe('2026-03-28T23:00:00.000Z');
    expect(iso(warsaw.startOfDay('2026-03-30'))).toBe('2026-03-29T22:00:00.000Z');
    expect(iso(warsaw.startOfDay('2026-10-25'))).toBe('2026-10-24T22:00:00.000Z');
    expect(iso(warsaw.startOfDay('2026-10-26'))).toBe('2026-10-25T23:00:00.000Z');
    expect(iso(zoneOf('UTC').startOfDay('2026-10-02'))).toBe('2026-10-02T00:00:00.000Z');
    expect(iso(zoneOf('Asia/Kolkata').startOfDay('2026-10-02'))).toBe('2026-10-01T18:30:00.000Z');
    expect(iso(zoneOf('America/New_York').startOfDay('2026-11-01'))).toBe('2026-11-01T04:00:00.000Z');
  });

  it('startOfDay where the clocks change at midnight: the day starts at the jump', () => {
    // Santiago skips 00:00–01:00 on 6 Sep 2026 (UTC-4 -> UTC-3): the day starts at 01:00 = 04:00 UTC
    const santiago = zoneOf('America/Santiago');
    expect(iso(santiago.startOfDay('2026-09-06'))).toBe('2026-09-06T04:00:00.000Z');
    expect(santiago.formatTime(santiago.startOfDay('2026-09-06'))).toBe('01:00');
    // and repeats 23:00–24:00 on 4 Apr 2026 (UTC-3 -> UTC-4): 5 Apr starts once, at 04:00 UTC
    expect(iso(santiago.startOfDay('2026-04-05'))).toBe('2026-04-05T04:00:00.000Z');
  });

  it('startOfDay is on the day and one millisecond earlier is the day before, every day of the year', () => {
    for (const tz of [
      'Europe/Warsaw',
      'America/New_York',
      'America/Santiago',
      'America/Havana',
      'Asia/Beirut',
      'Australia/Lord_Howe',
      'Asia/Kathmandu',
    ]) {
      const zone = zoneOf(tz);
      for (let day = '2026-01-01'; day < '2027-01-01'; day = addDays(day, 1)) {
        const start = zone.startOfDay(day).getTime();
        expect(zone.day(start), `${tz} ${day}`).toBe(day);
        expect(zone.day(start - 1), `${tz} ${day}`).toBe(addDays(day, -1));
      }
    }
  });

  describe('resolveRange', () => {
    const now = at('2026-10-02T08:00:00Z'); // 10:00 on 2 Oct in Warsaw

    it('today, the last n days and yesterday', () => {
      expect(warsaw.resolveRange({ days: '1' }, now)).toEqual({ gte: '2026-10-01T22:00:00.000Z' });
      expect(warsaw.resolveRange({ days: '7' }, now)).toEqual({ gte: '2026-09-25T22:00:00.000Z' });
      expect(warsaw.resolveRange({ days: 'yesterday' }, now)).toEqual({
        gte: '2026-09-30T22:00:00.000Z',
        lt: '2026-10-01T22:00:00.000Z',
      });
    });

    it('"today" depends on the zone: at 23:30 UTC it is already tomorrow in Warsaw', () => {
      const late = at('2026-10-01T23:30:00Z');
      expect(warsaw.resolveRange({ days: '1' }, late)).toEqual({ gte: '2026-10-01T22:00:00.000Z' });
      expect(zoneOf('UTC').resolveRange({ days: '1' }, late)).toEqual({ gte: '2026-10-01T00:00:00.000Z' });
    });

    it('the last n days over a DST change start at local midnight', () => {
      // 31 Mar (summer time) back to 25 Mar (winter time)
      expect(warsaw.resolveRange({ days: '7' }, at('2026-03-31T10:00:00Z'))).toEqual({
        gte: '2026-03-24T23:00:00.000Z',
      });
      // yesterday = 29 Mar, a 23-hour day
      expect(warsaw.resolveRange({ days: 'yesterday' }, at('2026-03-30T10:00:00Z'))).toEqual({
        gte: '2026-03-28T23:00:00.000Z',
        lt: '2026-03-29T22:00:00.000Z',
      });
    });

    it('a from–to range is half-open and includes the whole last day; reversed is swapped', () => {
      const range = { gte: '2026-09-19T22:00:00.000Z', lt: '2026-09-28T22:00:00.000Z' };
      expect(warsaw.resolveRange({ from: '2026-09-20', to: '2026-09-28' }, now)).toEqual(range);
      expect(warsaw.resolveRange({ from: '2026-09-28', to: '2026-09-20' }, now)).toEqual(range);
      expect(warsaw.resolveRange({ from: '2026-09-20' }, now)).toEqual({
        gte: '2026-09-19T22:00:00.000Z',
        lt: undefined,
      });
      expect(warsaw.resolveRange({ to: '2026-09-28' }, now)).toEqual({
        gte: undefined,
        lt: '2026-09-28T22:00:00.000Z',
      });
    });

    it('ignores bad input', () => {
      expect(warsaw.resolveRange({ days: '0' }, now)).toEqual({});
      expect(warsaw.resolveRange({ days: '367' }, now)).toEqual({});
      expect(warsaw.resolveRange({ days: '2.5' }, now)).toEqual({});
      expect(warsaw.resolveRange({ from: '2026-02-30', to: 'x' }, now)).toEqual({});
      // a bad preset falls back to the dates
      expect(warsaw.resolveRange({ days: 'abc', from: '2026-09-20' }, now)).toEqual({
        gte: '2026-09-19T22:00:00.000Z',
      });
    });
  });
});

// The date picker works with Dates on the device's clock: a day must come back as the same day in any
// device zone, also on the days the clocks change (America/Santiago skips 00:00 when summer time starts).
describe('days in the date picker', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  const zones = ['Europe/Warsaw', 'America/Santiago', 'America/New_York', 'Pacific/Kiritimati', 'UTC'];
  const changeDays = ['2026-03-29', '2026-10-25', '2026-04-05', '2026-09-06', '2026-03-08', '2026-11-01'];

  it('dayToDate is noon of that day on the device, dateToDay reads the day back', () => {
    // the device zone does follow process.env.TZ here (else these tests would only ever see one zone)
    process.env.TZ = 'Europe/Warsaw';
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
    for (const zone of zones) {
      process.env.TZ = zone;
      for (const day of changeDays) {
        const date = dayToDate(day);
        expect(date?.getHours(), `${zone} ${day}`).toBe(12);
        expect(date && dateToDay(date), `${zone} ${day}`).toBe(day);
      }
    }
  });

  it('every day of a year goes there and back unchanged, whatever the device zone', () => {
    for (const zone of zones) {
      process.env.TZ = zone;
      for (let day = '2026-01-01'; day < '2027-01-01'; day = addDays(day, 1)) {
        const date = dayToDate(day);
        if (!date || dateToDay(date) !== day) expect.fail(`${zone}: ${day} came back as ${date && dateToDay(date)}`);
      }
    }
  });

  it("a day picked at the device's midnight is that day, also where midnight is skipped", () => {
    process.env.TZ = 'America/Santiago';
    // 6 Sep 2026: clocks go from 24:00 to 01:00, so "midnight" is 01:00
    expect(dateToDay(new Date(2026, 8, 6))).toBe('2026-09-06');
    process.env.TZ = 'Europe/Warsaw';
    expect(dateToDay(new Date(2026, 2, 29))).toBe('2026-03-29');
    expect(dateToDay(new Date(2026, 9, 25))).toBe('2026-10-25');
  });

  it('rejects what is not a real date', () => {
    expect(dayToDate('2026-02-30')).toBeUndefined();
    expect(dayToDate('')).toBeUndefined();
    expect(dateToDay(new Date(1999, 11, 31, 12))).toBe('');
  });
});
