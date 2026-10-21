'use client';

import { useMemo, useSyncExternalStore } from 'react';

// The order the statistics' tiles were dragged into, kept in this browser only: it's how you like to
// read them, not data. A tile it doesn't name yet (added since) keeps its place from the default order.

const storageKey = 'jobwatch:tile-order';
const changed = 'jobwatch:tile-order-changed';

function read(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function subscribe(notify: () => void) {
  // another tab, or this one
  window.addEventListener('storage', notify);
  window.addEventListener(changed, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(changed, notify);
  };
}

export function writeTileOrder(order: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    // storage blocked: the order holds until the page is left
  }
  window.dispatchEvent(new Event(changed));
}

/** the tiles' ids as last dragged; the server's HTML and the first render have the default order */
export function arrange(defaults: string[], saved: string | null): string[] {
  let order: unknown;
  try {
    order = JSON.parse(saved ?? 'null');
  } catch {
    return defaults;
  }
  if (!Array.isArray(order)) return defaults;
  const known = (order as unknown[]).filter((id): id is string => typeof id === 'string' && defaults.includes(id));
  // a new one goes after the one it follows by default
  const result = [...new Set(known)];
  defaults.forEach((id, at) => {
    if (result.includes(id)) return;
    const before = at === 0 ? -1 : result.indexOf(defaults[at - 1]);
    result.splice(before + 1, 0, id);
  });
  return result;
}

export function useTileOrder(defaults: string[]) {
  const saved = useSyncExternalStore(subscribe, read, () => null);
  const key = defaults.join();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids, not the array, say when it changed
  return useMemo(() => arrange(defaults, saved), [key, saved]);
}
