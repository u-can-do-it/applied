// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeZone } from '@/components/time-zone';
import { RunsLog } from '@/features/activity/runs-log';
import type { ScrapeRun } from '@/lib/db/repos/scrape-runs';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// the real one needs the app router mounted: a plain link that hands a click to onNavigate, as it does
vi.mock('next/link', () => ({
  default: ({
    href,
    onNavigate,
    scroll: _scroll,
    ...rest
  }: React.ComponentProps<'a'> & { href: string; scroll?: boolean; onNavigate?: (event: Event) => void }) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.(event.nativeEvent);
      }}
    />
  ),
}));

const run = (id: number, errors: ScrapeRun['errors'] = []): ScrapeRun => ({
  id,
  startedAt: '2026-10-06T10:30:00.000Z',
  finishedAt: '2026-10-06T10:30:01.600Z',
  trigger: 'cron',
  found: 376,
  kept: 216,
  added: 2,
  fresh: 2,
  notified: 0,
  errors,
  matched: 0,
});
const counts = { all: 50, cron: 40, manual: 8, telegram: 2, failed: 7 };

function show(props: Partial<React.ComponentProps<typeof RunsLog>> = {}) {
  render(
    <TimeZone tz="Europe/Warsaw">
      <RunsLog runs={[run(1)]} added={{}} counts={counts} filter="all" page={0} pages={1} running={false} {...props} />
    </TimeZone>,
  );
}

beforeEach(() => push.mockClear());
afterEach(cleanup);

describe('the runs log', () => {
  it("opens a run to what each board added, then each scraper's error: its status and the site's message", () => {
    const adzuna = { scraper: 'Adzuna', error: 'HTTP 503, message: Service Temporarily Unavailable' };
    show({
      runs: [run(1, [adzuna])],
      added: {
        1: [
          { board: 'nofluff', label: 'NoFluff', added: 1, known: 0 },
          { board: 'justjoin', label: 'JustJoin', added: 1, known: 0 },
        ],
      },
    });
    const row = screen.getByRole('button', { name: /06\.10\.2026/ });
    expect(row.textContent).toContain('1.6 s · 376 on the pages · 216 kept · 2 new');
    expect(row.textContent).toContain('1 error');
    fireEvent.click(row);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the row is in its list item
    const lines = within(within(row.closest('li')!).getByRole('list')).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual([
      'NoFluff: 1 new',
      'JustJoin: 1 new',
      'Adzuna: HTTP 503, message: Service Temporarily Unavailable',
    ]);
    expect(lines[2].className).toContain('text-destructive');
  });

  it("says when a board's new offers were more offers of jobs the lists already had", () => {
    show({
      added: {
        1: [
          { board: 'justjoin', label: 'JustJoin', added: 2, known: 2 },
          { board: 'nofluff', label: 'NoFluff', added: 1, known: 1 },
          { board: 'pracuj', label: 'Pracuj', added: 3, known: 1 },
          { board: 'linkedin', label: 'LinkedIn', added: 4, known: 2 },
        ],
      },
    });
    const row = screen.getByRole('button', { name: /06\.10\.2026/ });
    fireEvent.click(row);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- the row is in its list item
    const lines = within(within(row.closest('li')!).getByRole('list')).getAllByRole('listitem');
    expect(lines.map((line) => line.textContent)).toEqual([
      'JustJoin: 2 new (known jobs)',
      'NoFluff: 1 new (known job)',
      'Pracuj: 3 new (1 for a known job)',
      'LinkedIn: 4 new (2 for known jobs)',
    ]);
  });

  it('pages through the runs, the filter kept, without scrolling to the top of the page', () => {
    show({ filter: 'failed', page: 1, pages: 4 });
    const pages = screen.getByRole('navigation', { name: 'Pages of runs' });
    expect(pages.textContent).toContain('Page 2 of 4');
    const newer = within(pages).getByRole('link', { name: /Newer/ });
    const older = within(pages).getByRole('link', { name: /Older/ });
    expect(newer.getAttribute('href')).toBe('/activity?runs=failed');
    expect(older.getAttribute('href')).toBe('/activity?runs=failed&page=2');
    fireEvent.click(older);
    expect(push).toHaveBeenCalledWith('/activity?runs=failed&page=2', { scroll: false });
  });

  it('the first page has no newer one, the last no older one, and one page no pager', () => {
    show({ page: 0, pages: 3 });
    expect(screen.queryByRole('link', { name: /Newer/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Older/ }).getAttribute('href')).toBe('/activity?page=1');
    cleanup();
    show({ page: 2, pages: 3 });
    expect(screen.queryByRole('link', { name: /Older/ })).toBeNull();
    cleanup();
    show();
    expect(screen.queryByRole('navigation', { name: 'Pages of runs' })).toBeNull();
  });

  it("a filter goes to its first page, with the whole log's counts", () => {
    show({ filter: 'failed', page: 2, pages: 4 });
    const cron = screen.getByRole('radio', { name: /Cron/ });
    expect(cron.textContent).toContain('40');
    fireEvent.click(cron);
    expect(push).toHaveBeenCalledWith('/activity?runs=cron', { scroll: false });
  });
});
