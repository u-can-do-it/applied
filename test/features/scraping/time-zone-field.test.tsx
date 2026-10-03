// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeZoneField } from '@/features/scraping/time-zone-field';
import { setTimeZoneAction } from '@/features/scraping/actions';

vi.mock('@/features/scraping/actions', () => ({ setTimeZoneAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
// this browser is in Tokyo
vi.mock('@/lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  deviceTimeZone: () => 'Asia/Tokyo',
}));
const save = vi.mocked(setTimeZoneAction);

afterEach(() => {
  cleanup();
  save.mockReset();
});

describe('TimeZoneField', () => {
  it('only offers the browser’s zone: opening the page saves nothing', async () => {
    render(<TimeZoneField value="Europe/Warsaw" effective="Europe/Warsaw" />);
    expect(await screen.findByText(/Your browser is in Asia\/Tokyo/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the browser’s zone when you take the suggestion', async () => {
    save.mockResolvedValueOnce({ ok: true, data: 'Saved.' });
    render(<TimeZoneField value="Europe/Warsaw" effective="Europe/Warsaw" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use Asia/Tokyo' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tz: 'Asia/Tokyo' }));
  });

  it('saves a zone picked from the list', async () => {
    save.mockResolvedValueOnce({ ok: true, data: 'Saved.' });
    render(<TimeZoneField value="Europe/Warsaw" effective="Europe/Warsaw" />);
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'America/New_York' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tz: 'America/New_York' }));
  });

  it('with none picked yet (an older install), shows the zone in use and still saves nothing by itself', async () => {
    render(<TimeZoneField value="" effective="Europe/Berlin" />);
    expect(screen.getByRole('option', { name: 'Not picked yet (Europe/Berlin for now)' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Use Asia/Tokyo' })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('offers to make the browser’s zone the pick when it’s the one in use but none was picked', async () => {
    render(<TimeZoneField value="" effective="Asia/Tokyo" />);
    expect(await screen.findByText(/the zone the app uses/)).toBeTruthy();
  });
});
