'use client';

import { use, useEffect, useEffectEvent, useRef, useState } from 'react';
import { formatDay, parseDay, validDay } from '@/lib/dates';
import { DAY_PRESETS, SOURCES, withParams } from '@/lib/sources';
import type { SourceOption } from '@/lib/source-list';
import { NavLink, useNav } from './nav';
import { SearchBox, SearchIcon } from './search-box';

function SourceChips({ query, path, sources }: { query: URLSearchParams; path: string; sources: SourceOption[] }) {
  const raw = query.get('src') ?? '';
  const src = sources.some((s) => s.id === raw) ? raw : '';
  return (
    <nav className="chips" aria-label="Filter by source">
      <NavLink className="chip" aria-current={!src ? 'true' : undefined} href={withParams(query, { src: null }, path)}>
        All
      </NavLink>
      {sources.map(({ id: key, label: name }) => (
        <NavLink
          key={key}
          className="chip"
          aria-current={src === key ? 'true' : undefined}
          href={withParams(query, { src: key }, path)}
        >
          {name}
        </NavLink>
      ))}
    </nav>
  );
}

// A native <input type="date"> shows the browser's own format (mm/dd/yyyy in an English
// browser) and a page can't change that. So the visible field is text in dd.mm.rrrr, typed
// with the dots filled in automatically; the 📅 button opens the browser's calendar through a
// hidden date input. The URL keeps ISO dates (2026-10-02).
const mask = (text: string) => {
  const d = text.replace(/\D/g, '').slice(0, 8);
  return d.slice(0, 2) + (d.length > 2 ? '.' + d.slice(2, 4) : '') + (d.length > 4 ? '.' + d.slice(4) : '');
};

export function DateInput({ label, value, min, max, onCommit }: {
  label: string;
  value: string; // ISO day or ''
  min?: string;
  max?: string;
  onCommit: (day: string) => void;
}) {
  const [text, setText] = useState(formatDay(value));
  const picker = useRef<HTMLInputElement>(null);
  const commit = useEffectEvent(onCommit);

  useEffect(() => setText(formatDay(value)), [value]); // follow the URL (presets, back/forward)

  // navigate once the typed text is a real date (or emptied) and typing pauses
  useEffect(() => {
    const iso = text === '' ? '' : parseDay(text);
    if (iso === value || (text !== '' && !iso)) return; // unchanged, or half-typed
    const t = setTimeout(() => commit(iso), 400);
    return () => clearTimeout(t);
  }, [text, value]);

  const iso = parseDay(text);
  const invalid = text.length === 10 && !iso;

  return (
    <label className="date-field">
      <span>{label}</span>
      <span className={`date-box${invalid ? ' invalid' : ''}`}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="dd.mm.rrrr"
          aria-label={`${label} (dd.mm.yyyy)`}
          aria-invalid={invalid || undefined}
          maxLength={10}
          value={text}
          onChange={(e) => setText(mask(e.target.value))}
        />
        <button
          type="button"
          className="cal"
          aria-label={`Pick the ${label.toLowerCase()} date`}
          onClick={() => {
            try {
              picker.current?.showPicker();
            } catch {
              picker.current?.focus(); // older browsers: focusing the input opens its picker
            }
          }}
        >
          📅
        </button>
        <input
          ref={picker}
          type="date"
          className="picker"
          tabIndex={-1}
          aria-hidden="true"
          value={iso || value}
          min={min}
          max={max}
          onChange={(e) => setText(formatDay(e.target.value))}
        />
      </span>
    </label>
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
        {DAY_PRESETS.map((p) => (
          <NavLink
            key={p.label}
            className="chip"
            aria-current={!custom && days === p.days ? 'true' : undefined}
            // a preset replaces any custom range
            href={withParams(query, { days: p.days, from: null, to: null }, path)}
          >
            {p.label}
          </NavLink>
        ))}
      </nav>
      <div className={`range${custom ? ' active' : ''}`}>
        {/* a custom date replaces the preset */}
        <DateInput label="From" value={from} max={to || undefined} onCommit={(d) => navigate(withParams(query, { from: d, days: null }, path))} />
        <DateInput label="to" value={to} min={from || undefined} onCommit={(d) => navigate(withParams(query, { to: d, days: null }, path))} />
        {custom && (
          <NavLink className="clear" href={withParams(query, { from: null, to: null }, path)} aria-label="Clear date range">
            ×
          </NavLink>
        )}
      </div>
    </div>
  );
}

export function Controls({ sources }: { sources: Promise<SourceOption[]> }) {
  const { query, path } = useNav(); // optimistic: chips light up on the click frame
  return (
    <>
      <SearchBox query={query} />
      <SourceChips query={query} path={path} sources={use(sources)} />
      <DateFilter query={query} path={path} />
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
          {['From', 'to'].map((l) => (
            <label key={l} className="date-field">
              <span>{l}</span>
              <span className="date-box">
                <input type="text" disabled placeholder="dd.mm.rrrr" />
                <span className="cal" aria-hidden="true">📅</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
