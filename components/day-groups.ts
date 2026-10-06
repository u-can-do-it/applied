import { addDays, type Zone } from '@/lib/dates';

// The lists grouped by day (offers by first seen, applications by the day you applied): a sticky
// heading per day, "Today", "Yesterday", then "Thu 02.10.2026", in the app's time zone, with how
// many the list has that day ("Yesterday 15").

export const DAY_HEADING =
  'sticky top-0 z-1 mt-6 mb-0 bg-background py-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase';
/** the day's count after the heading's label */
export const DAY_COUNT = 'ml-1.5 font-normal tabular-nums';
// no overflow-hidden: it would clip the fit tooltip; the rows have no background of their own
export const DAY_LIST = 'm-0 list-none divide-y rounded-[10px] border bg-card p-0';

/** Consecutive items of the same day together, in their order (newest first, as the lists are). */
export function groupByDay<T>(items: readonly T[], at: (item: T) => string, zone: Zone) {
  const today = zone.day();
  const yesterday = addDays(today, -1);
  const groups: { day: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const when = at(item);
    const day = zone.day(when);
    let group = groups.at(-1);
    if (!group || group.day !== day) {
      const label =
        day === today ? 'Today' : day === yesterday ? 'Yesterday' : `${zone.weekday(when)} ${zone.formatDayOf(when)}`;
      group = { day, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
