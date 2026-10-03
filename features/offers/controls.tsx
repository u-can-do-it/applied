'use client';

import { use } from 'react';
import { CalendarIcon, SearchIcon, XIcon } from 'lucide-react';
import { DateInput } from '@/components/date-input';
import { searchBox, searchInput } from '@/components/search-field';
import { TimeZone } from '@/components/time-zone';
import { Input } from '@/components/ui/input';
import { toggleVariants } from '@/components/ui/toggle';
import { validDay } from '@/lib/dates';
import { cn } from '@/lib/shared/cn';
import type { BoardOption } from '@/lib/listings/board-filter';
import { DAY_PRESETS, withParams } from '@/lib/shared/search-params';
import { NavLink, useNav } from './nav';
import { SearchBox } from './search-box';

// The board and date chips: links that change the list's filter in the URL (NavLink: prefetched, middle-click
// opens a new tab, without JS a plain link; navigate() lights the chip up on the click frame), in a <nav>
// with aria-current on the one in use. Drawn as shadcn toggles; they are not a ToggleGroup, whose radio
// buttons would lose all of that.
const CHIPS = 'flex flex-wrap gap-1.5';
const CHIP = cn(
  toggleVariants(),
  'h-auto min-w-0 rounded-full border bg-card px-2.5 py-1 text-[13px] font-normal text-muted-foreground no-underline hover:bg-card hover:text-foreground aria-[current=true]:border-foreground aria-[current=true]:bg-foreground aria-[current=true]:text-background',
);

function BoardChips({ query, path, boards }: { query: URLSearchParams; path: string; boards: BoardOption[] }) {
  const raw = query.get('src') ?? '';
  const src = boards.some((board) => board.id === raw) ? raw : '';
  return (
    <nav className={cn(CHIPS, 'mt-3 mb-2')} aria-label="Filter by board">
      <NavLink className={CHIP} aria-current={!src ? 'true' : undefined} href={withParams(query, { src: null }, path)}>
        All
      </NavLink>
      {boards.map(({ id: board, label: name }) => (
        <NavLink
          key={board}
          className={CHIP}
          aria-current={src === board ? 'true' : undefined}
          href={withParams(query, { src: board }, path)}
        >
          {name}
        </NavLink>
      ))}
    </nav>
  );
}

function DateFilter({ query, path }: { query: URLSearchParams; path: string }) {
  const { navigate } = useNav();
  const days = query.get('days') ?? '';
  const from = validDay(query.get('from'));
  const to = validDay(query.get('to'));
  const custom = !days && Boolean(from || to);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <nav className={CHIPS} aria-label="Filter by date">
        {DAY_PRESETS.map((preset) => (
          <NavLink
            key={preset.label}
            className={CHIP}
            aria-current={!custom && days === preset.days ? 'true' : undefined}
            // a preset replaces any custom range
            href={withParams(query, { days: preset.days, from: null, to: null }, path)}
          >
            {preset.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {/* a custom date replaces the preset */}
        <DateInput
          label="From"
          value={from}
          max={to || undefined}
          highlighted={custom}
          onCommit={(day) => navigate(withParams(query, { from: day, days: null }, path))}
        />
        <DateInput
          label="to"
          value={to}
          min={from || undefined}
          highlighted={custom}
          onCommit={(day) => navigate(withParams(query, { to: day, days: null }, path))}
        />
        {custom && (
          <NavLink
            className="px-1 text-lg leading-none text-muted-foreground no-underline hover:text-foreground"
            href={withParams(query, { from: null, to: null }, path)}
            aria-label="Clear date range"
          >
            <XIcon />
          </NavLink>
        )}
      </div>
    </div>
  );
}

export function Controls({ boards, tz }: { boards: Promise<BoardOption[]>; tz: Promise<string> }) {
  const { query, path } = useNav(); // optimistic: chips light up on the click frame
  return (
    <>
      <SearchBox query={query} />
      <BoardChips query={query} path={path} boards={use(boards)} />
      <TimeZone tz={use(tz)}>
        <DateFilter query={query} path={path} />
      </TimeZone>
    </>
  );
}

// Static-shell version for the very first HTML, before the URL is known
/** `labels`: the boards the filters show from the start */
export function ControlsFallback({ labels }: { labels: string[] }) {
  return (
    <>
      <div className={searchBox} aria-hidden="true">
        <SearchIcon className="size-4.5" />
        <input disabled placeholder="Search title or company…" className={searchInput} />
      </div>
      <div className="mt-3 mb-2 flex flex-wrap gap-1.5" aria-hidden="true">
        {['All', ...labels].map((name) => (
          <span key={name} className={CHIP}>
            {name}
          </span>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2" aria-hidden="true">
        <div className="flex flex-wrap gap-1.5">
          {DAY_PRESETS.map((preset) => (
            <span key={preset.label} className={CHIP}>
              {preset.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {['From', 'to'].map((label) => (
            <span key={label} className="flex items-center gap-1.5">
              <span>{label}</span>
              <span className="relative inline-flex items-center">
                <Input
                  disabled
                  placeholder="dd.mm.rrrr"
                  className="h-7 w-[calc(10ch+3rem)] rounded-full bg-card pr-8 text-[13px] disabled:opacity-100 md:text-[13px] dark:bg-card"
                />
                <CalendarIcon className="absolute right-2.5" />
              </span>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
