'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { withParams } from '@/lib/sources';
import { useNav } from './nav';

const KEPT = ['src', 'days', 'from', 'to'] as const; // other filters survive a no-JS submit

// Updates ?q= as you type (debounced). Without JS it still works as a plain GET form.
export function SearchBox({ query }: { query: URLSearchParams }) {
  const { navigate, path } = useNav();
  const q = query.get('q') ?? '';
  const [value, setValue] = useState(q);
  const lastSent = useRef(q);
  // reads the latest filters/navigate without restarting the debounce on every render
  const search = useEffectEvent((next: string) => navigate(withParams(query, { q: next }, path), { replace: true }));

  // follow the URL when it changes from outside (back/forward, a chip click keeps q)
  useEffect(() => {
    if (q !== lastSent.current) {
      lastSent.current = q;
      setValue(q);
    }
  }, [q]);

  useEffect(() => {
    const next = value.trim();
    if (next === lastSent.current) return;
    const t = setTimeout(() => {
      lastSent.current = next;
      search(next);
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <form className="search" action={path} method="get" role="search" onSubmit={(e) => e.preventDefault()}>
      <SearchIcon />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search title or company…"
        aria-label="Search offers"
        autoComplete="off"
        autoFocus
      />
      {KEPT.map((k) => {
        const v = query.get(k);
        return v ? <input key={k} type="hidden" name={k} value={v} /> : null;
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
