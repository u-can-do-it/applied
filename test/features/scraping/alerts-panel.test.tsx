// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertsPanel } from '@/features/scraping/alerts-panel';

// Settings' LinkedIn alert emails: whether they come in, what became of their jobs, the Gmail script.

const COUNTS = { waiting: 0, kept: 3, skipped: 2, known: 5 };
const panel = (props: Partial<React.ComponentProps<typeof AlertsPanel>> = {}) =>
  render(
    <AlertsPanel
      lastEmailAt="2026-10-12T09:00:00.000000+00:00"
      lastEmailJobs={6}
      counts={COUNTS}
      script="const SECRET = 'abc';"
      {...props}
    />,
  );
const text = () => screen.getByRole('region', { name: 'LinkedIn alert emails' }).textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AlertsPanel', () => {
  it('the last email and the week', () => {
    panel({ counts: { ...COUNTS, waiting: 4 } });
    expect(text()).toContain('Last email 11:00: 6 jobs'); // Europe/Warsaw
    expect(text()).toContain('This week: 3 kept, 5 found by the scrapers already, 2 left out by the filters');
    expect(text()).toContain('4 waiting for the next run');
  });

  it('no email yet; an email without jobs is a warning', () => {
    panel({ lastEmailAt: null, lastEmailJobs: null });
    expect(text()).toContain('No email yet');
    cleanup();
    panel({ lastEmailJobs: 0 });
    expect(text()).toContain('had no job in it');
  });

  it('the script, copied; without a secret, what to set', () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    panel();
    expect(screen.getByLabelText('The Gmail script').textContent).toBe("const SECRET = 'abc';");
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith("const SECRET = 'abc';");
    cleanup();
    panel({ script: null });
    expect(screen.queryByLabelText('The Gmail script')).toBeNull();
    expect(text()).toContain('Set APP_PASSWORD (or CRON_SECRET) first');
  });

  it('where the browser refuses the clipboard, the script is selected instead', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    panel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect((await screen.findByRole('status')).textContent).toContain('the script is selected');
    expect(String(window.getSelection())).toBe("const SECRET = 'abc';");
  });
});
