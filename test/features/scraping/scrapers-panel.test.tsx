// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ScrapersPanel } from '@/features/scraping/scrapers-panel';
import type { Scraper } from '@/lib/db/repos/scrapers';
import { fail, ok } from '@/lib/shared/result';

vi.mock('@/features/scraping/actions', () => ({ toggleScraperAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
// Radix measures its switches; jsdom has no ResizeObserver
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoResize);

const scraper = (id: string, name: string): Scraper => ({
  id,
  position: 1,
  name,
  src: 'board',
  kind: 'json',
  enabled: true,
  config: { url: 'https://board.test/jobs', headers: {}, checkKeyword: false, checkLocation: false, fields: {} },
  mark: 1,
  lastRunAt: null,
  lastStatus: null,
  lastFound: null,
  lastKept: null,
  lastNew: null,
  lastError: null,
  lastMs: null,
});

const SUMMARY = { found: 3, kept: 2, added: 1, fresh: 1, notified: 0, notifyLater: true, errors: [], ms: 5 };

function show() {
  render(
    <ScrapersPanel
      scrapers={[scraper('s1', 'Warszawa'), scraper('s2', 'Remote')]}
      counts={{}}
      keywords={['React']}
      schedule={{ enabled: true, fromHour: 0, toHour: 24 }}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('ResizeObserver', NoResize);
});

describe('ScrapersPanel', () => {
  it('runs one scraper from its row and says what it found', async () => {
    const answered = vi.fn(() => Promise.resolve(Response.json(ok(SUMMARY))));
    vi.stubGlobal('fetch', answered);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Run Warszawa now' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(answered).toHaveBeenCalledWith(
      '/api/scrape',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 's1' }) }),
    );
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe('Warszawa: 1 new offer');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a failed run under the list', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json(fail('connect ECONNREFUSED'), { status: 500 })));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Run Remote now' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Remote: connect ECONNREFUSED');
    expect(refresh).not.toHaveBeenCalled();
  });
});
