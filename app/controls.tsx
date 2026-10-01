'use client';

import { href, SOURCES } from '@/lib/sources';
import { NavLink, useNav } from './nav';
import { SearchBox, SearchIcon } from './search-box';

function Chips({ q, src }: { q: string; src: string }) {
  return (
    <nav className="chips" aria-label="Filter by source">
      <NavLink className="chip" aria-current={!src ? 'true' : undefined} href={href({ q })}>
        All
      </NavLink>
      {Object.entries(SOURCES).map(([key, name]) => (
        <NavLink key={key} className="chip" aria-current={src === key ? 'true' : undefined} href={href({ q, src: key })}>
          {name}
        </NavLink>
      ))}
    </nav>
  );
}

export function Controls() {
  const { query } = useNav(); // optimistic: the chip lights up on the click frame
  const q = query.get('q') ?? '';
  const raw = query.get('src') ?? '';
  const src = raw in SOURCES ? raw : '';
  return (
    <>
      <SearchBox q={q} src={src} />
      <Chips q={q} src={src} />
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
    </>
  );
}
