'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// Updates ?q= as you type (debounced). Without JS it still works as a plain GET form.
export function SearchBox({ q, src }: { q: string; src: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (value.trim()) sp.set('q', value.trim());
      if (src) sp.set('src', src);
      const s = sp.toString();
      router.replace(s ? `/?${s}` : '/', { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [value, src, router]);

  return (
    <form className="search" action="/" method="get" role="search" onSubmit={(e) => e.preventDefault()}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
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
