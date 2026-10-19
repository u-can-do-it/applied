// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MATCHING_REFRESH_MS, RefreshWhileMatching } from '@/features/offers/refresh-while-matching';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('refreshes the list while a job is being matched, and stops once none is', () => {
  const list = render(<RefreshWhileMatching matching={['a', 'b']} />);
  vi.advanceTimersByTime(MATCHING_REFRESH_MS);
  expect(refresh).toHaveBeenCalledTimes(1);

  list.rerender(<RefreshWhileMatching matching={['b']} />); // a's score came in
  vi.advanceTimersByTime(MATCHING_REFRESH_MS);
  expect(refresh).toHaveBeenCalledTimes(2);

  list.rerender(<RefreshWhileMatching matching={[]} />); // b's too
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(10 * MATCHING_REFRESH_MS);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('a list with nothing being matched never refreshes', () => {
  render(<RefreshWhileMatching matching={[]} />);
  vi.advanceTimersByTime(10 * MATCHING_REFRESH_MS);
  expect(refresh).not.toHaveBeenCalled();
});

it('often enough that a saved score shows within a minute', () => {
  expect(MATCHING_REFRESH_MS).toBeLessThanOrEqual(30_000);
});
