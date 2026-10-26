// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyTitle } from '@/features/offers/copy-title';

afterEach(cleanup);

it('copies the title, and says so', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<CopyTitle title="Senior React Developer" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy the title' }));
  expect(writeText).toHaveBeenCalledWith('Senior React Developer');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Title copied' })).toBeTruthy());
});
