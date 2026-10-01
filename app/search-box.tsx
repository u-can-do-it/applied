'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { href } from '@/lib/sources';

// Updates ?q= as you type (debounced). Without JS it still works as a plain GET form.
export function SearchBox({ q, src }: { q: string; src: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const lastSent = useRef(q);

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
      router.replace(href({ q: next, src }), { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [value, src, router]);

  return (
    <form className="search" action="/" method="get" role="search" onSubmit={(e) => e.preventDefault()}>
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
      {src && <input type="hidden" name="src" value={src} />}
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
