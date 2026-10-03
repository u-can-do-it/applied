'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { withParams } from '@/lib/shared/search-params';
import { useNav } from './nav';

const KEPT = ['src', 'days', 'from', 'to'] as const; // other filters survive a no-JS submit

// Updates ?q= as you type (debounced). Without JS it still works as a plain GET form.
export function SearchBox({ query }: { query: URLSearchParams }) {
  const { navigate, path } = useNav();
  const queryText = query.get('q') ?? '';
  const [value, setValue] = useState(queryText);
  const lastSent = useRef(queryText);
  // reads the latest filters/navigate without restarting the debounce on every render
  const search = useEffectEvent((next: string) => navigate(withParams(query, { q: next }, path), { replace: true }));

  // follow the URL when it changes from outside (back/forward, a chip click keeps q)
  useEffect(() => {
    if (queryText !== lastSent.current) {
      lastSent.current = queryText;
      setValue(queryText);
    }
  }, [queryText]);

  useEffect(() => {
    const next = value.trim();
    if (next === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = next;
      search(next);
    }, 250);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <form className="search" action={path} method="get" role="search" onSubmit={(event) => event.preventDefault()}>
      <SearchIcon />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search title or company…"
        aria-label="Search offers"
        autoComplete="off"
        autoFocus
      />
      {KEPT.map((name) => {
        const kept = query.get(name);
        return kept ? <input key={name} type="hidden" name={name} value={kept} /> : null;
      })}
    </form>
  );
}

export function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
