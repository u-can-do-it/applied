'use client';

import { lazy, Suspense, useEffect, useEffectEvent, useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dateToDay, dayToDate, formatDay, parseDay } from '@/lib/dates';
import { cn } from '@/lib/shared/cn';
import { useZone } from './time-zone';

// A day as dd.mm.rrrr text, typed with the dots filled in automatically, or picked in a calendar
// (the button). A native <input type="date"> would show the browser's own format (mm/dd/yyyy in an
// English browser), which a page can't change. The URL keeps ISO dates (2026-10-02).
// The calendar (react-day-picker with date-fns, ~30 kB gzipped) loads when it's first wanted: pointing at
// or focusing the button starts the download, so it's usually in by the time the popover opens.
const loadCalendar = () => import('@/components/ui/calendar');
const Calendar = lazy(() => loadCalendar().then((module) => ({ default: module.Calendar })));

const mask = (text: string) => {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return (
    digits.slice(0, 2) +
    (digits.length > 2 ? '.' + digits.slice(2, 4) : '') +
    (digits.length > 4 ? '.' + digits.slice(4) : '')
  );
};

export function DateInput({
  label,
  value,
  min,
  max,
  highlighted = false,
  onCommit,
}: {
  label: string;
  value: string; // ISO day or ''
  min?: string;
  max?: string;
  /** drawn as the filter in use (the custom range) */
  highlighted?: boolean;
  onCommit: (day: string) => void;
}) {
  const [text, setText] = useState(formatDay(value));
  const [picking, setPicking] = useState(false);
  const zone = useZone();
  const commit = useEffectEvent(onCommit);

  // follow the URL (presets, back/forward); adjusted while rendering, not in an effect
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(formatDay(value));
  }

  // navigate once the typed text is a real date (or emptied) and typing pauses
  useEffect(() => {
    const iso = text === '' ? '' : parseDay(text);
    if (iso === value || (text !== '' && !iso)) return; // unchanged, or half-typed
    const timer = setTimeout(() => commit(iso), 400);
    return () => clearTimeout(timer);
  }, [text, value]);

  const iso = parseDay(text);
  const invalid = text.length === 10 && !iso;
  const selected = dayToDate(iso || value);
  const before = min ? dayToDate(min) : undefined;
  const after = max ? dayToDate(max) : undefined;

  return (
    <label className="flex items-center gap-1.5">
      <span>{label}</span>
      <span className="relative inline-flex items-center">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="dd.mm.rrrr"
          aria-label={`${label} (dd.mm.yyyy)`}
          aria-invalid={invalid || undefined}
          maxLength={10}
          value={text}
          onChange={(event) => setText(mask(event.target.value))}
          className={cn(
            'h-7 w-[calc(10ch+3rem)] rounded-full bg-card pr-8 text-[13px] text-foreground tabular-nums md:text-[13px] dark:bg-card',
            highlighted && 'border-foreground',
          )}
        />
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 rounded-full text-muted-foreground"
              aria-label={`Pick the ${label.toLowerCase()} date`}
              onPointerEnter={() => void loadCalendar()}
              onFocus={() => void loadCalendar()}
            >
              <CalendarIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Suspense fallback={<div className="h-[280px] w-[212px]" aria-busy="true" />}>
              <Calendar
                mode="single"
                weekStartsOn={1}
                // today in the app's time zone, not the device's
                today={dayToDate(zone.day())}
                selected={selected}
                defaultMonth={selected ?? after}
                disabled={[...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]}
                onSelect={(date) => {
                  const day = date ? dateToDay(date) : '';
                  if (!day) return; // the selected day clicked again: keep it
                  setText(formatDay(day));
                  setPicking(false);
                  if (day !== value) onCommit(day); // picked: no need to wait as for typing
                }}
              />
            </Suspense>
          </PopoverContent>
        </Popover>
      </span>
    </label>
  );
}
