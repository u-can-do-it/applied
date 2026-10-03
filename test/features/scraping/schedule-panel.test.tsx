// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/confirm';
import { SchedulePanel } from '@/features/scraping/schedule-panel';
import { saveScheduleAction } from '@/features/scraping/actions';
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

afterEach(cleanup);

describe('SchedulePanel', () => {
  it('checks the hours with the action’s schema (loaded on Save) before sending them', async () => {
    render(
      <ConfirmProvider>
        <SchedulePanel
          settings={{ ...DEFAULT_SETTINGS, everyMinutes: 15, fromHour: 7, toHour: 22 }}
          state={{ lockedUntil: null, lastCallAt: null, lastRunAt: null, muted: false }}
          running={false}
          runs={[]}
          cron={{ available: false }}
          endpoint="http://localhost/api/cron/scrape"
        />
      </ConfirmProvider>,
    );
    const from = screen.getByLabelText<HTMLInputElement>('from');
    fireEvent.change(from, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(from.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(from.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Hours are 0–24.');
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(from, { target: { value: '8' } });
    await waitFor(() => expect(from.getAttribute('aria-invalid')).toBeNull());
    save.mockResolvedValueOnce({ ok: true, data: 'Saved.' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ everyMinutes: 15, fromHour: 8, toHour: 22 }));
  });
});
