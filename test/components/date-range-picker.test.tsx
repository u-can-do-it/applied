// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateRangePicker, RANGE_PLACEHOLDER } from '@/components/date-range-picker';

// Radix measures the popover; jsdom has no ResizeObserver
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// The calendar is lazy: its first import (react-day-picker, cold) can outlast findByRole's 1s under the
// full suite's load. Loaded here, the picker's own import finds it in the module cache.
beforeAll(() => import('@/components/ui/calendar'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const day = (name: RegExp) => screen.findByRole('button', { name });

describe('DateRangePicker', () => {
  it('shows the range, or what to do without one', () => {
    const { rerender } = render(<DateRangePicker label="Applied" from="" to="" onCommit={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe(RANGE_PLACEHOLDER);
    rerender(<DateRangePicker label="Applied" from="2026-10-01" to="2026-10-05" onCommit={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('01.10.2026 – 05.10.2026');
  });

  it('commits once both ends are picked, the earlier one first', async () => {
    const onCommit = vi.fn();
    render(<DateRangePicker label="Applied" from="" to="" onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await day(/October 5th, 2026/));
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(await day(/September 28th, 2026/));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith({ from: '2026-09-28', to: '2026-10-05' });
  });

  it('the same day twice: just that day', async () => {
    const onCommit = vi.fn();
    render(<DateRangePicker label="Applied" from="" to="" onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await day(/October 2nd, 2026/));
    fireEvent.click(await day(/October 2nd, 2026/));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith({ from: '2026-10-02', to: '2026-10-02' });
  });

  it('a click on a picked range starts a new one', async () => {
    const onCommit = vi.fn();
    render(<DateRangePicker label="Applied" from="2026-10-01" to="2026-10-05" onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await day(/October 7th, 2026/));
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(await day(/October 8th, 2026/));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith({ from: '2026-10-07', to: '2026-10-08' });
  });

  it("days after today can't be picked", async () => {
    render(<DateRangePicker label="Applied" from="" to="" onCommit={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect((await day(/October 10th, 2026/)).hasAttribute('disabled')).toBe(true);
  });
});
