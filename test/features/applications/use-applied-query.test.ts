// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TILES } from '@/features/applications/status-filter';
import { useAppliedQuery } from '@/features/applications/use-applied-query';
import { outcomeLabel, stageOf } from '@/lib/stages';

// Next's router follows pushState / replaceState and Back (useSearchParams); here, a stand-in that does the same
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => window.location.search,
      ),
    ),
}));
for (const method of ['pushState', 'replaceState'] as const) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args: Parameters<History['pushState']>) => {
    original(...args);
    changed();
  };
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/applied');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('starts from the URL: the search and the status filter', () => {
  window.history.replaceState(null, '', '/applied?q=react&status=hr-failed');
  const { result } = renderHook(() => useAppliedQuery());
  expect(result.current.search).toBe('react');
  expect(result.current.filter).toMatchObject({
    id: 'hr-failed',
    label: `${stageOf('hr').short} · ${outcomeLabel('hr', 'failed')}`,
  });
});

it('a filter is a new history entry; clearing it takes ?status= away', () => {
  const { result } = renderHook(() => useAppliedQuery());
  const entries = window.history.length;
  act(() => result.current.setFilter('rejected'));
  expect(window.location.search).toBe('?status=rejected');
  expect(window.history.length).toBe(entries + 1);
  expect(result.current.filter?.label).toBe(TILES.rejected.label);
  act(() => result.current.setFilter(null));
  expect(window.location.pathname + window.location.search).toBe('/applied');
  expect(result.current.filter).toBeNull();
});

it('the search filters at once and is in ?q= once you stop typing, in place (no entry per letter)', async () => {
  window.history.replaceState(null, '', '/applied?status=rejected');
  const { result } = renderHook(() => useAppliedQuery());
  const entries = window.history.length;
  act(() => result.current.setSearch('front '));
  expect(result.current.search).toBe('front ');
  expect(window.location.search).toBe('?status=rejected');
  await wait(250);
  expect(window.location.search).toBe('?status=rejected&q=front');
  expect(result.current.search).toBe('front '); // still as typed: the next word goes on after the space
  expect(window.history.length).toBe(entries);
  act(() => result.current.setSearch(''));
  await wait(250);
  expect(window.location.search).toBe('?status=rejected');
});

it('follows the URL when it changes from outside (Back)', () => {
  const { result } = renderHook(() => useAppliedQuery());
  act(() => window.history.replaceState(null, '', '/applied?q=java&status=positive'));
  expect(result.current.search).toBe('java');
  expect(result.current.filter?.id).toBe('positive');
});
