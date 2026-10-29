'use client';

import { createContext, use, useMemo } from 'react';
import { finderOf, type Find } from '@/lib/shared/search';

// The list's search, for the windows it opens (an offer's, an application's): they mark its words where
// they are, in yellow as the rows do.

type Search = { query: string; everything: boolean };

const ListSearchContext = createContext<Search | null>(null);

/** `everything`: the search reads the ad too (?in=all), so its words are marked there as well */
export function ListSearch({ query, everything, children }: Search & { children: React.ReactNode }) {
  const search = useMemo(() => ({ query, everything }), [query, everything]);
  return <ListSearchContext value={search}>{children}</ListSearchContext>;
}

/**
 * Where the list's search finds its words in a window's texts: `find` in what it searched (`searched`:
 * the title, the company, the note), `findMore` in the rest (`more`: the ad's details and text), only
 * when it read everything (undefined: they aren't in yet). Undefined with no search.
 */
export function useFind(
  searched: (string | null | undefined)[],
  more: (string | null | undefined)[] | undefined,
): { find?: Find; findMore?: Find } {
  const search = use(ListSearchContext);
  const query = search?.query.trim() ?? '';
  const everything = search?.everything ?? false;
  // by their words: new arrays each render, the same texts; null till the window has them all
  const key = more && (everything ? [...searched, ...more] : searched).join('\0');
  const find = useMemo(() => (query ? finderOf(query, key?.split('\0') ?? null) : null), [query, key]);
  return find ? { find, findMore: everything ? find : undefined } : {};
}
