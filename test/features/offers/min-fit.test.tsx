// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMinFitAction } from '@/features/offers/actions';
import { MinFit } from '@/features/offers/min-fit';

vi.mock('@/features/offers/actions', () => ({ setMinFitAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));
const save = vi.mocked(setMinFitAction);

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({ ok: true, data: undefined });
});
afterEach(cleanup);

describe('MinFit', () => {
  it('sets a minimum only when you ask: a number, then Hide', async () => {
    render(<MinFit minFit={0} />);
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull(); // nothing typed yet
    fireEvent.change(screen.getByLabelText('Hide under'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ minFit: 50 }));
  });

  it('shows the one set, and clears it with its ×', async () => {
    render(<MinFit minFit={60} />);
    expect(screen.getByText('Under 60% hidden')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the offers under 60% again' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ minFit: 0 }));
  });

  it('says what is wrong with the number, keeping it', async () => {
    save.mockResolvedValueOnce({ ok: false, error: 'A fit is 0–100%.' });
    render(<MinFit minFit={0} />);
    fireEvent.change(screen.getByLabelText('Hide under'), { target: { value: '140' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(await screen.findByText('A fit is 0–100%.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Hide under').value).toBe('140');
  });
});
