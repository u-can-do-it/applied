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

it('a date range from the URL: the days you applied in the app’s time zone, both ends included', () => {
  window.history.replaceState(null, '', '/applied?from=2026-09-20&to=2026-09-28');
  const { result } = renderHook(() => useAppliedQuery());
  const range = result.current.range;
  expect(range).toMatchObject({ from: '2026-09-20', to: '2026-09-28' });
  // Europe/Warsaw (the default zone): 20.09 00:30 there is 19.09 in UTC
  expect(range?.test({ appliedAt: '2026-09-19T22:30:00Z' })).toBe(true);
  expect(range?.test({ appliedAt: '2026-09-19T21:30:00Z' })).toBe(false);
  expect(range?.test({ appliedAt: '2026-09-28T21:30:00Z' })).toBe(true);
  expect(range?.test({ appliedAt: '2026-09-28T22:30:00Z' })).toBe(false);
});

it('a reversed range is swapped, an open end lets everything through, a bad date is no range', () => {
  window.history.replaceState(null, '', '/applied?from=2026-09-28&to=2026-09-20');
  const { result } = renderHook(() => useAppliedQuery());
  expect(result.current.range?.test({ appliedAt: '2026-09-24T10:00:00Z' })).toBe(true);
  act(() => window.history.replaceState(null, '', '/applied?from=2026-09-20'));
  expect(result.current.range?.test({ appliedAt: '2030-01-01T10:00:00Z' })).toBe(true);
  expect(result.current.range?.test({ appliedAt: '2026-09-01T10:00:00Z' })).toBe(false);
  act(() => window.history.replaceState(null, '', '/applied?from=2026-02-31'));
  expect(result.current.range).toBeNull();
});

it('setting a date is a new history entry; clearing the range takes both away, keeping the rest', () => {
  window.history.replaceState(null, '', '/applied?status=rejected');
  const { result } = renderHook(() => useAppliedQuery());
  const entries = window.history.length;
  act(() => result.current.setRange({ from: '2026-09-20' }));
  act(() => result.current.setRange({ to: '2026-09-28' }));
  expect(window.location.search).toBe('?status=rejected&from=2026-09-20&to=2026-09-28');
  expect(window.history.length).toBe(entries + 2);
  act(() => result.current.setRange({ from: '', to: '' }));
  expect(window.location.search).toBe('?status=rejected');
  expect(result.current.range).toBeNull();
});
