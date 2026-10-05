// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveAction, restoreAction } from '@/features/offers/actions';
import { ArchiveButton, ArchiveRow } from '@/features/offers/archive';
import type { Result } from '@/lib/shared/result';

vi.mock('@/features/offers/actions', () => ({ archiveAction: vi.fn(), restoreAction: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const archive = vi.mocked(archiveAction);
const restore = vi.mocked(restoreAction);
const success = vi.mocked(toast.success);
const error = vi.mocked(toast.error);

const JOB = 'acme|reactdeveloper';
function row(archived = false) {
  render(
    <ul>
      <ArchiveRow jobId={JOB} title="React Developer" archived={archived}>
        <li>
          React Developer <ArchiveButton />
        </li>
      </ArchiveRow>
    </ul>,
  );
}

/** An action's answer that comes when the test says so. */
function later() {
  let answer: (result: Result<undefined>) => void = () => {};
  const promise = new Promise<Result<undefined>>((resolve) => (answer = resolve));
  return { promise, answer };
}

/** Clicks the Undo of the toast shown last. */
function undo() {
  const options = success.mock.lastCall?.[1] as unknown as { action: { onClick: () => void } };
  options.action.onClick();
}

beforeEach(() => {
  archive.mockResolvedValue({ ok: true, data: undefined });
  restore.mockResolvedValue({ ok: true, data: undefined });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('archiving an offer', () => {
  it('takes the row out at once, and the toast can undo it', async () => {
    const saved = later();
    archive.mockReturnValue(saved.promise);
    row();
    fireEvent.click(screen.getByRole('button', { name: 'Archive React Developer' }));
    expect(archive).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
    // gone while it saves; the refreshed list then leaves it out (here, without one, it comes back)
    await waitFor(() => expect(screen.queryByText('React Developer')).toBeNull());
    saved.answer({ ok: true, data: undefined });
    await waitFor(() => expect(success).toHaveBeenCalledWith('Archived “React Developer”', expect.anything()));
    undo();
    expect(restore).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
  });

  it('brings the row back with the error when the save fails', async () => {
    archive.mockResolvedValue({ ok: false, error: 'Database down.' });
    row();
    fireEvent.click(screen.getByRole('button', { name: 'Archive React Developer' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('Database down.'));
    await screen.findByText('React Developer');
    expect(success).not.toHaveBeenCalled();
  });

  it('restores a job in the archived list, and Undo archives it again', async () => {
    row(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restore React Developer' }));
    expect(restore).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
    await waitFor(() => expect(success).toHaveBeenCalledWith('Restored “React Developer”', expect.anything()));
    undo();
    expect(archive).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
  });

  it('says why Undo did not work', async () => {
    restore.mockResolvedValue({ ok: false, error: 'Database down.' });
    row();
    fireEvent.click(screen.getByRole('button', { name: 'Archive React Developer' }));
    await waitFor(() => expect(success).toHaveBeenCalled());
    undo();
    await waitFor(() => expect(error).toHaveBeenCalledWith('Database down.'));
  });
});
