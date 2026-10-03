// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/confirm';
import { ScraperEditor } from '@/features/scraping/scraper-editor';
import { saveScraperAction, testScraperAction, type TestResult } from '@/features/scraping/actions';
import { toast } from 'sonner';
import { blank, type Draft } from '@/features/scraping/scraper-draft';
import { kindOf } from '@/lib/listings/kinds';

vi.mock('@/features/scraping/actions', () => ({
  saveScraperAction: vi.fn(),
  deleteScraperAction: vi.fn(),
  testScraperAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
// Radix measures its checkboxes; jsdom has no ResizeObserver
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoResize);

const saved: Draft = {
  ...blank('html'),
  id: 'scraper-1',
  name: 'My board',
  src: 'myboard',
  url: 'https://jobs.example.com/?q={keyword}',
  items: 'li.job',
  fields: { ...blank('html').fields, title: 'h3', url: 'h3 a@href' },
};

function open() {
  render(
    <ConfirmProvider>
      <ScraperEditor initial={saved} autoTest={false} keywords={['React']} onClose={() => {}} />
    </ConfirmProvider>,
  );
}
const box = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const pickType = (kind: string) => fireEvent.change(screen.getByLabelText('Type'), { target: { value: kind } });
const answer = async (name: 'Change' | 'Cancel') =>
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ScraperEditor', () => {
  it('asks before an existing scraper changes its type, and changes nothing on Cancel', async () => {
    open();
    pickType('justjoin');
    expect(await screen.findByText('Change the type?')).toBeTruthy();
    await answer('Cancel');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(box('Type').value).toBe('html');
    expect(box('Board id').value).toBe('myboard');
    expect(box('One offer (CSS selector)').value).toBe('li.job');

    // yes: a built-in board brings its own link and board id; the name and "on" stay
    pickType('justjoin');
    await answer('Change');
    await waitFor(() => expect(box('Type').value).toBe('justjoin'));
    expect(box('Board id').value).toBe('justjoin');
    expect(box('Link').value).toBe(kindOf('justjoin').defaults?.url);
    expect(box('Name').value).toBe('My board');
    expect(screen.queryByLabelText('One offer (CSS selector)')).toBeNull();
  });

  it('between generic types keeps what is typed', async () => {
    open();
    pickType('json');
    await answer('Change');
    await waitFor(() => expect(box('Type').value).toBe('json'));
    expect(box('Path to the list of offers').value).toBe('li.job');
    expect(box('Link').value).toBe(saved.url);
  });

  it('saves without a toast (the action answers with the id), and Enter in a box doesn’t save', async () => {
    open();
    const name = box('Name');
    expect(fireEvent.keyDown(name, { key: 'Enter' })).toBe(false); // the form's implicit submit prevented
    vi.mocked(saveScraperAction).mockResolvedValueOnce({ ok: true, data: 'scraper-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveScraperAction).toHaveBeenCalledOnce());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a Test the check stops clears the last result', async () => {
    open();
    const result: TestResult = {
      ok: true,
      error: null,
      found: 3,
      kept: 2,
      fresh: 1,
      skipped: { keyword: 1, area: 0, ignored: 0 },
      pages: [],
      offers: [],
      ms: 120,
    };
    vi.mocked(testScraperAction).mockResolvedValueOnce({ ok: true, data: result });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByRole('region', { name: 'Test result' })).toBeTruthy();
    fireEvent.change(box('Name'), { target: { value: ' ' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }));
    await waitFor(() => expect(box('Name').getAttribute('aria-invalid')).toBe('true'));
    expect(screen.queryByRole('region', { name: 'Test result' })).toBeNull();
    expect(testScraperAction).toHaveBeenCalledOnce();
  });
});
