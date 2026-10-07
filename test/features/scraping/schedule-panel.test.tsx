// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/confirm';
import { SchedulePanel } from '@/features/scraping/schedule-panel';
import { saveScheduleAction } from '@/features/scraping/actions';
import { loadSettingsSchemas } from '@/features/scraping/settings-schemas';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';

vi.mock('@/features/scraping/actions', () => ({
  saveScheduleAction: vi.fn(),
  setScrapingPausedAction: vi.fn(),
  setTimeZoneAction: vi.fn(),
  cronConnectAction: vi.fn(),
  cronDisconnectAction: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
const save = vi.mocked(saveScheduleAction);

function open() {
  render(
    <ConfirmProvider>
      <SchedulePanel
        settings={{ ...DEFAULT_SETTINGS, everyMinutes: 15, fromHour: 7, toHour: 22 }}
        timeZone="Europe/Warsaw"
        cron={{ available: false }}
        endpoint="http://localhost/api/cron/scrape"
      />
    </ConfirmProvider>,
  );
}

// The first render in a fresh worker runs jsdom's CSS and selector engines and React for the first time: ~0.4 s alone,
// ~2 s under the whole suite's load. Rendered once here (no focus: the schema stays for Save to load), so that isn't
// spent from the test's 5 s.
beforeAll(() => {
  open();
  cleanup();
});
afterEach(cleanup);

describe('SchedulePanel', () => {
  it('checks the hours with the action’s schema (loaded on Save) before sending them', async () => {
    open();
    const from = screen.getByLabelText<HTMLInputElement>('from');
    fireEvent.change(from, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // the code Save started loading, waited for itself: under the whole suite's load it takes most of waitFor's second
    await loadSettingsSchemas();
    await waitFor(() => expect(from.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(from.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Hours are 0–24.');
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(from, { target: { value: '8' } });
    await waitFor(() => expect(from.getAttribute('aria-invalid')).toBeNull());
    save.mockResolvedValueOnce({ ok: true, data: 'Saved.' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ everyMinutes: 15, weekendEveryMinutes: 60, fromHour: 8, toHour: 22 }),
    );
  });
});
