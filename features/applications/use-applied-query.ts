'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Application } from '@/lib/applications';
import { validDay } from '@/lib/dates';
import { useZone } from '@/components/time-zone';
import { filterOf } from './status-filter';

// The Applied tab's search, status filter and dates, kept in the URL (?q=, ?status=, ?from=, ?to=): a
// reload, a link or Back shows the same list. Written with the History API, which Next's router follows
// (useSearchParams) without asking the server for the page again: the list is filtered here.

/** The days you applied in (ISO, both ends included; '' for open), and whether an application is in them. */
export type AppliedRange = { from: string; to: string; test: (app: Pick<Application, 'appliedAt'>) => boolean };

export function useAppliedQuery() {
  const params = useSearchParams();
  const zone = useZone();
  const status = params.get('status');
  const filter = useMemo(() => filterOf(status), [status]);
  const [search, setSearch] = useSearchText(params.get('q') ?? '');
  // a step that Back takes back, like the offers' chips
  const setFilter = (id: string | null) => writeParams({ status: id }, { push: true });

  const from = validDay(params.get('from'));
  const to = validDay(params.get('to'));
  const range = useMemo<AppliedRange | null>(() => {
    if (!from && !to) return null;
    // a reversed range is swapped, as on the offers
    const [first, last] = from && to && from > to ? [to, from] : [from, to];
    return {
      from,
      to,
      // the day you applied in the app's time zone (what the list's day headings show)
      test: (app) => {
        const day = zone.day(app.appliedAt);
        return (!first || day >= first) && (!last || day <= last);
      },
    };
  }, [from, to, zone]);
  const setRange = (dates: { from?: string; to?: string }) =>
    writeParams(Object.fromEntries(Object.entries(dates).map(([name, day]) => [name, validDay(day) || null])), {
      push: true,
    });

  return { search, setSearch, filter, setFilter, range, setRange };
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
      writeParams({ q: next });
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  return [text, setText] as const;
}

type Param = 'q' | 'status' | 'from' | 'to';

/** Sets (or, empty, removes) parameters of the page's URL, keeping the others. */
function writeParams(values: Partial<Record<Param, string | null>>, { push = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const changed = Object.entries(values).filter(([name, value]) => (params.get(name) ?? '') !== (value ?? ''));
  if (!changed.length) return;
  for (const [name, value] of changed) {
    if (value) params.set(name, value);
    else params.delete(name);
  }
  const query = params.toString();
  const url = query ? `?${query}` : window.location.pathname;
  if (push) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
