// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRefreshWhile } from '@/components/use-refresh-while';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const setup = (active: boolean, data: unknown) =>
  renderHook(({ active, data }) => useRefreshWhile(active, 4000, data), { initialProps: { active, data } });

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useRefreshWhile', () => {
  it('keeps refreshing while active, even when the data stays the same', () => {
    const data = { done: 2 };
    const hook = setup(true, data);
    vi.advanceTimersByTime(3999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    hook.rerender({ active: true, data }); // a refresh that brought nothing new
    vi.advanceTimersByTime(8000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('counts again from new data, with one timer only', () => {
    const hook = setup(true, { done: 2 });
    vi.advanceTimersByTime(3000);
    hook.rerender({ active: true, data: { done: 3 } });
    hook.rerender({ active: true, data: { done: 4 } });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops when no longer active, and does nothing while inactive', () => {
    const hook = setup(true, 'running');
    vi.advanceTimersByTime(4000);
    expect(refresh).toHaveBeenCalledTimes(1);
    hook.rerender({ active: false, data: 'done' });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockClear();
    const idle = setup(false, null);
    vi.advanceTimersByTime(20_000);
    expect(refresh).not.toHaveBeenCalled();
    idle.unmount();
    hook.unmount();
  });
});
