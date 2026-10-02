'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { validDay } from '@/lib/dates';
import { DAY_PRESETS, SOURCES, withParams } from '@/lib/sources';
import { NavLink, useNav } from './nav';
import { SearchBox, SearchIcon } from './search-box';

function SourceChips({ query }: { query: URLSearchParams }) {
  const raw = query.get('src') ?? '';
  const src = raw in SOURCES ? raw : '';
  return (
    <nav className="chips" aria-label="Filter by source">
      <NavLink className="chip" aria-current={!src ? 'true' : undefined} href={withParams(query, { src: null })}>
        All
      </NavLink>
      {Object.entries(SOURCES).map(([key, name]) => (
        <NavLink
          key={key}
          className="chip"
          aria-current={src === key ? 'true' : undefined}
          href={withParams(query, { src: key })}
        >
          {name}
        </NavLink>
      ))}
    </nav>
  );
}

// <input type="date"> fires a change for every typed segment (0002, 0020, 0202, 2026),
// so keep the value locally and only navigate once it's a real date and typing pauses.
function DateInput({ label, value, min, max, onCommit }: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onCommit: (day: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = useEffectEvent(onCommit);

  useEffect(() => setDraft(value), [value]); // follow the URL (presets, back/forward)

  useEffect(() => {
    if (draft === value) return;
    if (draft !== '' && !validDay(draft)) return; // half-typed
    const t = setTimeout(() => commit(draft), 400);
    return () => clearTimeout(t);
  }, [draft, value]);

  return (
    <label className="date-field">
      <span>{label}</span>
      <input type="date" value={draft} min={min} max={max} onChange={(e) => setDraft(e.target.value)} />
    </label>
  );
}

function DateFilter({ query }: { query: URLSearchParams }) {
  const { navigate } = useNav();
  const days = query.get('days') ?? '';
  const from = validDay(query.get('from'));
  const to = validDay(query.get('to'));
  const custom = !days && Boolean(from || to);

  return (
    <div className="dates">
      <nav className="chips" aria-label="Filter by date">
        {DAY_PRESETS.map((p) => (
          <NavLink
            key={p.label}
            className="chip"
            aria-current={!custom && days === p.days ? 'true' : undefined}
            // a preset replaces any custom range
            href={withParams(query, { days: p.days, from: null, to: null })}
          >
            {p.label}
          </NavLink>
        ))}
      </nav>
      <div className={`range${custom ? ' active' : ''}`}>
        {/* a custom date replaces the preset */}
        <DateInput label="From" value={from} max={to || undefined} onCommit={(d) => navigate(withParams(query, { from: d, days: null }))} />
        <DateInput label="to" value={to} min={from || undefined} onCommit={(d) => navigate(withParams(query, { to: d, days: null }))} />
        {custom && (
          <NavLink className="clear" href={withParams(query, { from: null, to: null })} aria-label="Clear date range">
            ×
          </NavLink>
        )}
      </div>
    </div>
  );
}

export function Controls() {
  const { query } = useNav(); // optimistic: chips light up on the click frame
  return (
    <>
      <SearchBox query={query} />
      <SourceChips query={query} />
      <DateFilter query={query} />
    </>
  );
}

// Static-shell version for the very first HTML, before the URL is known
export function ControlsFallback() {
  return (
    <>
      <div className="search" aria-hidden="true">
        <SearchIcon />
        <input disabled placeholder="Search title or company…" />
      </div>
      <nav className="chips" aria-hidden="true">
        {['All', ...Object.values(SOURCES)].map((name) => (
          <span key={name} className="chip">
            {name}
          </span>
        ))}
      </nav>
      <div className="dates" aria-hidden="true">
        <nav className="chips">
          {DAY_PRESETS.map((p) => (
            <span key={p.label} className="chip">
              {p.label}
            </span>
          ))}
        </nav>
        <div className="range">
          <label className="date-field">
            <span>From</span>
            <input type="date" disabled />
          </label>
          <label className="date-field">
            <span>to</span>
            <input type="date" disabled />
          </label>
        </div>
      </div>
    </>
  );
}
