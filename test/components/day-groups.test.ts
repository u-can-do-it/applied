import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupByDay } from '@/components/day-groups';
import { zoneOf } from '@/lib/dates';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const at = (item: { at: string }) => item.at;

describe('groupByDay', () => {
  it('puts the items of each day together under Today, Yesterday or the weekday and date', () => {
    const items = [
      { id: 1, at: '2026-10-05T09:00:00Z' },
      { id: 2, at: '2026-10-05T07:00:00Z' },
      { id: 3, at: '2026-10-04T12:00:00Z' },
      { id: 4, at: '2026-10-01T12:00:00Z' },
    ];
    expect(
      groupByDay(items, at, zoneOf('UTC')).map((group) => [group.label, group.items.map((item) => item.id)]),
    ).toEqual([
      ['Today', [1, 2]],
      ['Yesterday', [3]],
      ['Thu 01.10.2026', [4]],
    ]);
  });

  it("takes the days in the app's time zone", () => {
    // 22:30 UTC on the 4th is already the 5th in Warsaw
    const [group] = groupByDay([{ at: '2026-10-04T22:30:00Z' }], at, zoneOf('Europe/Warsaw'));
    expect(group).toMatchObject({ day: '2026-10-05', label: 'Today' });
  });
});
