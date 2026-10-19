// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ScraperBrief } from '@/features/scraping/scraper-status';
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
  lastProxied: null,
  lastCompleteAt: null,
  followUp: null,
});

const SUMMARY = { found: 3, kept: 2, added: 1, fresh: 1, notified: 0, notifyLater: true, errors: [], ms: 5 };

function show() {
  render(
    <ScrapersPanel
      scrapers={[scraper('s1', 'Warszawa'), scraper('s2', 'Remote')]}
      counts={{}}
      keywords={['React']}
      schedule={{ enabled: true, fromHour: 0, toHour: 24, everyMinutes: 10, weekendEveryMinutes: 30 }}
      credits={Promise.resolve({ credits: null })}
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

describe('ScraperBrief', () => {
  it("says when a follow-up reads what the scraper's last run couldn't", () => {
    const pages = [{ keyword: 'React', page: 4 }];
    const ads = [
      { src: 'linkedin', id: '9' },
      { src: 'linkedin', id: '10' },
    ] as NonNullable<Scraper['followUp']>['ads'];
    const followUp = { from: '2026-10-14T07:20:00Z', at: '2026-10-14T07:25:00Z', tries: 0, pages, ads };
    render(<ScraperBrief scraper={{ ...scraper('s1', 'LinkedIn'), lastRunAt: '2026-10-14T07:20:00Z', followUp }} />);
    expect(screen.getByText(/a follow-up after/).textContent).toMatch(
      /a follow-up after .+ reads the 1 page and 2 ads its last run couldn’t/,
    );
  });
});

describe('ScrapingAntCredits', () => {
  it('says what ScrapingAnt has left and what its boards’ scrapers spend a month, warning when it runs short', async () => {
    const pracuj: Scraper = {
      ...scraper('p', 'Pracuj.pl'),
      kind: 'pracuj',
      src: 'pracuj',
      config: { url: 'https://it.pracuj.pl/praca/{keyword};kw?sc=0' },
    };
    const answer = Promise.resolve({ credits: { total: 10_000, left: 100, resetsAt: '2099-01-01T00:00:00Z' } });
    await act(() => {
      render(
        <ScrapersPanel
          scrapers={[scraper('s1', 'Warszawa'), pracuj]}
          counts={{}}
          keywords={['React']}
          schedule={{ enabled: true, fromHour: 7, toHour: 22, everyMinutes: 10, weekendEveryMinutes: 30 }}
          credits={answer}
        />,
      );
      return answer;
    });
    // 45 calls a weekday (every 20 minutes for 15 hours), 30 a weekend day (every 30): ~1,221 a month
    expect(screen.getByText(/100 of 10,000 credits left/)).toBeTruthy();
    expect(screen.getByText(/Pracuj\.pl 1,221/)).toBeTruthy();
    expect(screen.getByText(/more than is left/)).toBeTruthy();
  });
});
