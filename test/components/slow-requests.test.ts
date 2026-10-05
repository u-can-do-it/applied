// @vitest-environment jsdom
import { afterEach, beforeEach, describe as group, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { describe, SLOW_MS, watchSlow } from '@/components/slow-requests';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(() => 't1'), dismiss: vi.fn() } }));
const warning = vi.mocked(toast.warning);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

group('describe', () => {
  it('names a server action by its page', () => {
    expect(describe('/settings', { method: 'POST', headers: { 'Next-Action': 'abc' } })).toBe(
      'POST /settings (server action)',
    );
  });
  it('drops _rsc from a page fetch', () => {
    expect(describe('/applied?_rsc=x1&q=go', { headers: { RSC: '1' } })).toBe('GET /applied?q=go (page)');
  });
  it('keeps another origin whole', () => {
    expect(describe(new URL('https://example.com/a'))).toBe('GET https://example.com/a');
  });
});

group('watchSlow', () => {
  it('says nothing for a quick response', async () => {
    const fetch = watchSlow(() => later(100, new Response('ok')));
    const pending = fetch('/api/changes');
    await vi.advanceTimersByTimeAsync(SLOW_MS + 1000);
    await pending;
    expect(warning).not.toHaveBeenCalled();
  });

  it('warns while waiting, then says how long it took', async () => {
    const fetch = watchSlow(() => later(4200, new Response('ok', { status: 200 })));
    const pending = fetch('/api/changes');
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(warning).toHaveBeenLastCalledWith(
      'Slow response: GET /api/changes',
      expect.objectContaining({ description: 'Still waiting…' }),
    );
    await vi.advanceTimersByTimeAsync(1200);
    await pending;
    expect(warning).toHaveBeenLastCalledWith(
      'Slow response: GET /api/changes',
      expect.objectContaining({ id: 't1', description: 'HTTP 200 after 4.2 s' }),
    );
  });

  it("doesn't watch prefetches", async () => {
    const fetch = watchSlow(() => later(5000, new Response('ok')));
    const pending = fetch('/applied', { headers: { 'Next-Router-Prefetch': '1' } });
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(warning).not.toHaveBeenCalled();
  });
});
