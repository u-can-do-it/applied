'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterOf } from './status-filter';

// The Applied tab's search and status filter, kept in the URL (?q=, ?status=): a reload, a link or
// Back shows the same list. Written with the History API, which Next's router follows
// (useSearchParams) without asking the server for the page again: the list is filtered here.

export function useAppliedQuery() {
  const params = useSearchParams();
  const status = params.get('status');
  const filter = useMemo(() => filterOf(status), [status]);
  const [search, setSearch] = useSearchText(params.get('q') ?? '');
  // a step that Back takes back, like the offers' chips
  const setFilter = (id: string | null) => writeParam('status', id, { push: true });
  return { search, setSearch, filter, setFilter };
}

/**
 * The search box's text: in the list at once, in ?q= once you stop typing (a browser allows only so
 * many URL changes a second, and a page's history needs no entry per letter).
 */
function useSearchText(fromUrl: string) {
  const [text, setText] = useState(fromUrl);
  const written = useRef(fromUrl);

  // follow the URL when it changes from outside (Back / Forward)
  useEffect(() => {
    if (fromUrl !== written.current) {
      written.current = fromUrl;
      setText(fromUrl);
    }
  }, [fromUrl]);

  useEffect(() => {
    const next = text.trim();
    if (next === written.current) return;
    const timer = setTimeout(() => {
      written.current = next;
      writeParam('q', next);
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  return [text, setText] as const;
}

/** Sets (or, empty, removes) one parameter of the page's URL, keeping the others. */
function writeParam(name: 'q' | 'status', value: string | null, { push = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  if ((params.get(name) ?? '') === (value ?? '')) return;
  if (value) params.set(name, value);
  else params.delete(name);
  const query = params.toString();
  const url = query ? `?${query}` : window.location.pathname;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
