'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { href, SOURCES } from '@/lib/sources';
import { SearchBox, SearchIcon } from './search-box';

function Chips({ q, src }: { q: string; src: string }) {
  return (
    <nav className="chips" aria-label="Filter by source">
      <Link className="chip" aria-current={!src ? 'true' : undefined} href={href({ q })} scroll={false}>
        All
      </Link>
      {Object.entries(SOURCES).map(([key, name]) => (
        <Link
          key={key}
          className="chip"
          aria-current={src === key ? 'true' : undefined}
          href={href({ q, src: key })}
          scroll={false}
        >
          {name}
        </Link>
      ))}
    </nav>
  );
}

export function Controls() {
  const sp = useSearchParams();
  const q = sp.get('q') ?? '';
  const raw = sp.get('src') ?? '';
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
