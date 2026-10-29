'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { SearchIcon, TextSearchIcon } from 'lucide-react';
import { searchBox, searchInput } from '@/components/search-field';
import { withParams } from '@/lib/shared/search-params';
import { useNav } from './nav';

const KEPT = ['src', 'days', 'from', 'to'] as const; // other filters survive a no-JS submit

/** "Everything": a checkbox drawn as a chip, at the box's end; lit while it's on */
export const EVERYTHING =
  'flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] text-muted-foreground select-none hover:text-foreground has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-3 has-focus-visible:ring-ring/50';
export const PLACEHOLDER = { some: 'Search title or company…', all: 'Search everything: ad, note, salary, skills…' };
const EVERYTHING_TITLE = 'Search your note and the ad too: its text, salary, contract, work mode, location and skills';

// Updates ?q= as you type (debounced). Without JS it still works as a plain GET form. "Everything"
// (?in=all) has the search read the note and the ad too (lib/jobs.ts).
export function SearchBox({ query }: { query: URLSearchParams }) {
  const { navigate, path } = useNav();
  const everything = query.get('in') === 'all';
  const queryText = query.get('q') ?? '';
  const [value, setValue] = useState(queryText);
  const lastSent = useRef(queryText);
  // reads the latest filters/navigate without restarting the debounce on every render; a search typed
  // anew is best match first again (a company's link asks for newest first, ?order=new), unless you
  // order by fit (?order=fit), which stays
  const search = useEffectEvent((next: string) =>
    navigate(withParams(query, { q: next, order: query.get('order') === 'fit' ? 'fit' : null }, path), {
      replace: true,
    }),
  );

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
    <form className={searchBox} action={path} method="get" role="search" onSubmit={(event) => event.preventDefault()}>
      <SearchIcon className="size-4.5" />
      <input
        type="search"
        name="q"
        className={searchInput}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={everything ? PLACEHOLDER.all : PLACEHOLDER.some}
        aria-label="Search offers"
        autoComplete="off"
      />
      <label className={EVERYTHING} title={EVERYTHING_TITLE}>
        <input
          type="checkbox"
          name="in"
          value="all"
          className="sr-only"
          checked={everything}
          onChange={(event) => navigate(withParams(query, { in: event.target.checked ? 'all' : null }, path))}
        />
        <TextSearchIcon aria-hidden className="size-3.5" /> Everything
      </label>
      {KEPT.map((name) => {
        const kept = query.get(name);
        return kept ? <input key={name} type="hidden" name={name} value={kept} /> : null;
      })}
    </form>
  );
}
