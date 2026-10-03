import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cronSchedule, describeSchedule, utcHours } from '@/lib/listings/cron';

const YEAR = 2026;

describe('utcHours', () => {
  it('the same hour twice is all day', () => {
    expect(utcHours(7, 7, 'Europe/Warsaw', YEAR)).toBe('*');
    expect(utcHours(0, 0, 'UTC', YEAR)).toBe('*');
  });

  it('UTC: the hours themselves, the last one not included', () => {
    expect(utcHours(7, 22, 'UTC', YEAR)).toBe('7-21');
    expect(utcHours(0, 24, 'UTC', YEAR)).toBe('*');
    expect(utcHours(9, 10, 'UTC', YEAR)).toBe('9');
  });

  it('a zone with summer time: both offsets, an hour wider', () => {
    // 7:00–22:00 in Warsaw = 5–20 UTC in summer, 6–21 in winter
    expect(utcHours(7, 22, 'Europe/Warsaw', YEAR)).toBe('5-20');
    expect(utcHours(7, 24, 'Europe/Warsaw', YEAR)).toBe('5-22');
    expect(utcHours(9, 17, 'America/New_York', YEAR)).toBe('13-21');
    // southern hemisphere: summer time in January
    expect(utcHours(7, 22, 'Australia/Sydney', YEAR)).toBe('0-11,20-23');
  });

  it('over midnight', () => {
    expect(utcHours(22, 6, 'UTC', YEAR)).toBe('0-5,22-23');
    expect(utcHours(22, 6, 'Europe/Warsaw', YEAR)).toBe('0-4,20-23');
    expect(utcHours(23, 0, 'UTC', YEAR)).toBe('23');
  });

  it('wraps past midnight UTC when the zone is ahead', () => {
    // 0:00–3:00 in Warsaw = 22–1 / 23–2 UTC
    expect(utcHours(0, 3, 'Europe/Warsaw', YEAR)).toBe('0-1,22-23');
  });

  it('a half-hour zone counts the hour it starts in', () => {
    // 9:00–17:00 in Kolkata (UTC+5:30) = 3:30–11:30 UTC
    expect(utcHours(9, 17, 'Asia/Kolkata', YEAR)).toBe('3-11');
    // UTC+5:45
    expect(utcHours(9, 17, 'Asia/Kathmandu', YEAR)).toBe('3-11');
  });

  it('a window that ends up covering every hour is "*"', () => {
    expect(utcHours(0, 23, 'Europe/Warsaw', YEAR)).toBe('*');
    expect(utcHours(1, 0, 'UTC', YEAR)).toBe('1-23');
  });
});

// cronSchedule and describeSchedule take the offsets of the current year: pin it
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${YEAR}-06-15T12:00:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

describe('cronSchedule', () => {
  const base = { everyMinutes: 10, fromHour: 7, toHour: 22, timeZone: 'Europe/Warsaw', browserTimeZone: '' };

  it('the interval, then the hours in UTC', () => {
    expect(cronSchedule(base)).toBe('*/10 5-20 * * *');
    expect(cronSchedule({ ...base, everyMinutes: 5 })).toBe('*/5 5-20 * * *');
  });

  it('1 h and 2 h intervals run hourly, on the hour', () => {
    expect(cronSchedule({ ...base, everyMinutes: 60 })).toBe('0 5-20 * * *');
    expect(cronSchedule({ ...base, everyMinutes: 120 })).toBe('0 5-20 * * *');
  });

  it("the picked zone, else the browser's, else the default", () => {
    expect(cronSchedule({ ...base, timeZone: 'UTC', browserTimeZone: 'Asia/Kolkata' })).toBe('*/10 7-21 * * *');
    expect(cronSchedule({ ...base, timeZone: '', browserTimeZone: 'UTC' })).toBe('*/10 7-21 * * *');
    expect(cronSchedule({ ...base, timeZone: '', browserTimeZone: '' })).toBe('*/10 5-20 * * *'); // Europe/Warsaw
    expect(cronSchedule({ ...base, fromHour: 0, toHour: 0 })).toBe('*/10 * * * *');
  });
});

describe('describeSchedule', () => {
  it('reads the settings back', () => {
    const schedule = { everyMinutes: 10, fromHour: 7, toHour: 22, timeZone: '', browserTimeZone: 'America/New_York' };
    expect(describeSchedule(schedule)).toBe('every 10 min, 7:00–22:00 (America/New York)');
    expect(describeSchedule({ ...schedule, everyMinutes: 120, fromHour: 5, toHour: 5, timeZone: 'UTC' })).toBe(
      'every 2 h, all day (UTC)',
    );
    expect(describeSchedule({ ...schedule, everyMinutes: 60, timeZone: '', browserTimeZone: '' })).toBe(
      'every 1 h, 7:00–22:00 (Europe/Warsaw)',
    );
  });
});
