'use client';

import { use } from 'react';
import { CalendarIcon, SearchIcon, XIcon } from 'lucide-react';
import { DateInput } from '@/components/date-input';
import { validDay } from '@/lib/dates';
import type { BoardOption } from '@/lib/listings/board-filter';
import { DAY_PRESETS, withParams } from '@/lib/shared/search-params';
import { NavLink, useNav } from './nav';
import { SearchBox } from './search-box';

function BoardChips({ query, path, boards }: { query: URLSearchParams; path: string; boards: BoardOption[] }) {
  const raw = query.get('src') ?? '';
  const src = boards.some((board) => board.id === raw) ? raw : '';
  return (
    <nav className="chips" aria-label="Filter by source">
      <NavLink className="chip" aria-current={!src ? 'true' : undefined} href={withParams(query, { src: null }, path)}>
        All
      </NavLink>
      {boards.map(({ id: board, label: name }) => (
        <NavLink
          key={board}
          className="chip"
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
    <div className="dates">
      <nav className="chips" aria-label="Filter by date">
        {DAY_PRESETS.map((preset) => (
          <NavLink
            key={preset.label}
            className="chip"
            aria-current={!custom && days === preset.days ? 'true' : undefined}
            // a preset replaces any custom range
            href={withParams(query, { days: preset.days, from: null, to: null }, path)}
          >
            {preset.label}
          </NavLink>
        ))}
      </nav>
      <div className={`range${custom ? ' active' : ''}`}>
        {/* a custom date replaces the preset */}
        <DateInput
          label="From"
          value={from}
          max={to || undefined}
          onCommit={(day) => navigate(withParams(query, { from: day, days: null }, path))}
        />
        <DateInput
          label="to"
          value={to}
          min={from || undefined}
          onCommit={(day) => navigate(withParams(query, { to: day, days: null }, path))}
        />
        {custom && (
          <NavLink
            className="clear"
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

export function Controls({ boards }: { boards: Promise<BoardOption[]> }) {
  const { query, path } = useNav(); // optimistic: chips light up on the click frame
  return (
    <>
      <SearchBox query={query} />
      <BoardChips query={query} path={path} boards={use(boards)} />
      <DateFilter query={query} path={path} />
    </>
  );
}

// Static-shell version for the very first HTML, before the URL is known
/** `labels`: the boards the filters show from the start */
export function ControlsFallback({ labels }: { labels: string[] }) {
  return (
    <>
      <div className="search" aria-hidden="true">
        <SearchIcon className="size-4.5" />
        <input disabled placeholder="Search title or company…" />
      </div>
      <nav className="chips" aria-hidden="true">
        {['All', ...labels].map((name) => (
          <span key={name} className="chip">
            {name}
          </span>
        ))}
      </nav>
      <div className="dates" aria-hidden="true">
        <nav className="chips">
          {DAY_PRESETS.map((preset) => (
            <span key={preset.label} className="chip">
              {preset.label}
            </span>
          ))}
        </nav>
        <div className="range">
          {['From', 'to'].map((label) => (
            <label key={label} className="date-field">
              <span>{label}</span>
              <span className="date-box">
                <input type="text" disabled placeholder="dd.mm.rrrr" />
                <span className="cal" aria-hidden="true">
                  <CalendarIcon />
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
