'use client';

import { lazy, Suspense, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addDays, dateToDay, dayToDate, describeRange } from '@/lib/dates';
import { cn } from '@/lib/shared/cn';
import { useZone } from './time-zone';

// A range of days picked in one calendar (shadcn's date range picker): the first click is the first day,
// the second the last (or the same day again: just that day). The range is committed once both ends are
// in; closing the calendar half-way leaves the dates as they were. The URL keeps ISO dates (2026-10-02).
// The calendar loads when it's first wanted, as in DateInput.
const loadCalendar = () => import('@/components/ui/calendar');
const Calendar = lazy(() => loadCalendar().then((module) => ({ default: module.Calendar })));

export const RANGE_PLACEHOLDER = 'Pick dates';

export function DateRangePicker({
  label,
  from,
  to,
  highlighted = false,
  onCommit,
}: {
  /** what the dates filter, for the button's name ("Applied") */
  label: string;
  from: string; // ISO day or ''
  to: string;
  /** drawn as the filter in use (the custom range) */
  highlighted?: boolean;
  onCommit: (range: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const zone = useZone();
  const today = zone.day(); // in the app's time zone, not the device's
  const todayDate = dayToDate(today);

  const shown = describeRange({ from, to });
  const start = dayToDate(from);
  const end = dayToDate(to);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(start || end ? { from: start ?? end, to: start ? end : undefined } : undefined);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${label} dates: ${shown || 'any'}`}
          onPointerEnter={() => void loadCalendar()}
          onFocus={() => void loadCalendar()}
          className={cn(
            'gap-1.5 rounded-full bg-card text-[13px] font-normal tabular-nums dark:bg-card',
            shown ? 'text-foreground' : 'text-muted-foreground',
            highlighted && 'border-foreground',
          )}
        >
          <CalendarIcon className="text-muted-foreground" />
          {shown || RANGE_PLACEHOLDER}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Suspense fallback={<div className="h-[280px] w-[436px] max-md:w-[212px]" aria-busy="true" />}>
          <Calendar
            mode="range"
            resetOnSelect // a click on a whole range starts a new one
            numberOfMonths={2}
            showOutsideDays={false} // two months: a day once
            weekStartsOn={1}
            today={todayDate}
            selected={draft}
            // the range's months; with none, this month on the right
            defaultMonth={draft?.from ?? dayToDate(addDays(today.slice(0, 8) + '01', -1))}
            endMonth={todayDate}
            disabled={todayDate && { after: todayDate }}
            onSelect={(range) => {
              setDraft(range);
              if (!range?.from || !range.to) return; // the first day: wait for the last
              const next = { from: dateToDay(range.from), to: dateToDay(range.to) };
              setOpen(false);
              if (next.from !== from || next.to !== to) onCommit(next);
            }}
          />
          <p className="m-0 px-3 pb-2.5 text-xs text-muted-foreground" aria-live="polite">
            {draft?.from && !draft.to ? 'Now pick the last day' : 'Pick the first day, then the last'}
          </p>
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
