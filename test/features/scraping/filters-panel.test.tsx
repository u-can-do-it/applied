// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FiltersPanel } from '@/features/scraping/filters-panel';
import { saveFiltersAction } from '@/features/scraping/actions';
import { loadSettingsSchemas } from '@/features/scraping/settings-schemas';
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

// Save checks with the action's schema, whose code loads with the form's first focus (as on the page) or Save: in
// before the tests, so they wait for the save, not for the chunk (most of waitFor's second under the whole suite)
beforeAll(() => loadSettingsSchemas());
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/** the badges in the field with that label */
const badges = (label: string) =>
  [...(box(label).parentElement?.querySelectorAll('[data-slot="badge"]') ?? [])].map((badge) => badge.textContent);

describe('FiltersPanel', () => {
  it('makes a badge of each word before a comma or Enter, and saves them with what is still typed', async () => {
    render(<FiltersPanel settings={settings} />);
    expect(badges('Keywords')).toEqual(['React']);
    expect(saveButton().disabled).toBe(true); // nothing changed yet
    fireEvent.change(box('Keywords'), { target: { value: 'Vue ;Next.js,react' } });
    expect(badges('Keywords')).toEqual(['React', 'Vue', 'Next.js']); // "react" is there already
    fireEvent.change(box('Keywords'), { target: { value: 'Node' } });
    expect(saveButton().disabled).toBe(false);
    save.mockResolvedValueOnce({ ok: true, data: 'Saved. The next run uses them.' });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved. The next run uses them.'));
    expect(save).toHaveBeenCalledWith({
      keywords: 'React, Vue, Next.js, Node',
      cities: '',
      remoteOk: true,
      ignore: '',
      mute: '',
    });
  });

  it('takes a badge out with its ×, Backspace in the empty box the last one, and Enter makes one', () => {
    render(<FiltersPanel settings={{ ...settings, keywords: ['React', 'Vue', 'Svelte'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Vue”' }));
    expect(badges('Keywords')).toEqual(['React', 'Svelte']);
    fireEvent.keyDown(box('Keywords'), { key: 'Backspace' });
    expect(badges('Keywords')).toEqual(['React']);
    fireEvent.change(box('Keywords'), { target: { value: 'React Native' } }); // a space stays inside
    fireEvent.keyDown(box('Keywords'), { key: 'Enter' });
    expect(badges('Keywords')).toEqual(['React', 'React Native']);
    expect(box('Keywords').value).toBe('');
    fireEvent.change(box('Cities'), { target: { value: 'Kraków' } });
    fireEvent.blur(box('Cities')); // leaving the box makes one too
    expect(badges('Cities')).toEqual(['Kraków']);
  });

  it('shows what the server says is wrong by the button, keeping what was typed', async () => {
    render(<FiltersPanel settings={settings} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove “React”' }));
    save.mockResolvedValueOnce({ ok: false, error: "Add at least one keyword: LinkedIn's link has {keyword} in it." });
    fireEvent.click(saveButton());
    expect(await screen.findByText("Add at least one keyword: LinkedIn's link has {keyword} in it.")).toBeTruthy();
    expect(badges('Keywords')).toEqual([]);
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
    expect(badges('Keywords')).toEqual(['Svelte']);

    // what you typed stays
    fireEvent.change(box('Cities'), { target: { value: 'Kraków' } });
    view.rerender(<FiltersPanel settings={{ ...settings, keywords: ['Angular'] }} />);
    expect(badges('Keywords')).toEqual(['Svelte']);
    expect(box('Cities').value).toBe('Kraków');
  });
});
