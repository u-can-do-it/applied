// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FiltersPanel } from '@/features/scraping/filters-panel';
import { saveFiltersAction } from '@/features/scraping/actions';
import { DEFAULT_SETTINGS } from '@/lib/listings/settings';

vi.mock('@/features/scraping/actions', () => ({ saveFiltersAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
// Radix measures its checkboxes; jsdom has no ResizeObserver
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoResize);
const save = vi.mocked(saveFiltersAction);

const settings = { ...DEFAULT_SETTINGS, keywords: ['React'], cities: [], ignore: [], mute: [], remoteOk: true };
const box = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: /Save filters|Saving/ });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('FiltersPanel', () => {
  it('saves what was typed, then shows it the way it is saved', async () => {
    render(<FiltersPanel settings={settings} />);
    expect(saveButton().disabled).toBe(true); // nothing changed yet
    fireEvent.change(box('Keywords'), { target: { value: 'React,Vue ;Next.js ' } });
    expect(saveButton().disabled).toBe(false);
    save.mockResolvedValueOnce({ ok: true, data: 'Saved. The next run uses them.' });
    fireEvent.click(saveButton());
    await waitFor(() => expect(box('Keywords').value).toBe('React, Vue, Next.js'));
    expect(save).toHaveBeenCalledWith({
      keywords: 'React,Vue ;Next.js ',
      cities: '',
      remoteOk: true,
      ignore: '',
      mute: '',
    });
    expect(toast.success).toHaveBeenCalledWith('Saved. The next run uses them.');
  });

  it('shows what the server says is wrong by the button, keeping what was typed', async () => {
    render(<FiltersPanel settings={settings} />);
    fireEvent.change(box('Keywords'), { target: { value: '' } });
    save.mockResolvedValueOnce({ ok: false, error: "Add at least one keyword: LinkedIn's link has {keyword} in it." });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Add at least one keyword: LinkedIn's link has {keyword} in it.")).toBeTruthy();
    expect(box('Keywords').value).toBe('');
    expect(toast.success).not.toHaveBeenCalled();

    // gone with the next try
    fireEvent.change(box('Keywords'), { target: { value: 'Vue' } });
    save.mockResolvedValueOnce({ ok: true, data: 'Saved. The next run uses them.' });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByText(/Add at least one keyword/)).toBeNull();
  });

  it('follows the refreshed page while it shows the old values, also after a focus and a blur', () => {
    const view = render(<FiltersPanel settings={settings} />);
    fireEvent.focus(box('Keywords'));
    fireEvent.blur(box('Keywords'));
    view.rerender(<FiltersPanel settings={{ ...settings, keywords: ['Svelte'] }} />);
    expect(box('Keywords').value).toBe('Svelte');

    // what you typed stays
    fireEvent.change(box('Cities'), { target: { value: 'Kraków' } });
    view.rerender(<FiltersPanel settings={{ ...settings, keywords: ['Angular'] }} />);
    expect(box('Keywords').value).toBe('Svelte');
    expect(box('Cities').value).toBe('Kraków');
  });
});
