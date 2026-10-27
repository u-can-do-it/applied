// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirm, type ConfirmOptions } from '@/components/confirm';
import { mergeJobsAction } from '@/features/offers/actions';
import { MergeButton, MergeProvider, type MergeJob } from '@/features/offers/merge';

vi.mock('@/features/offers/actions', () => ({ mergeJobsAction: vi.fn() }));
vi.mock('@/components/confirm', () => ({ useConfirm: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const merge = vi.mocked(mergeJobsAction);
const confirm = vi.fn<(options: ConfirmOptions) => Promise<boolean>>();
vi.mocked(useConfirm).mockReturnValue(confirm);

const job = (jobId: string, title: string, firstSeen: string): MergeJob => ({
  jobId,
  title,
  company: '1dea',
  firstSeen,
  when: firstSeen,
  boards: ['NoFluff'],
  applied: false,
});
const NOFLUFF = job('1dea|frontend', 'Frontend Developer', '2026-10-26T13:50:00Z');
const ADZUNA = job('1dea|frontendremote', 'Frontend Developer (Remote)', '2026-10-27T06:10:00Z');

function list() {
  render(
    <MergeProvider>
      <ul>
        {[NOFLUFF, ADZUNA].map((row) => (
          <li key={row.jobId}>
            {row.title} <MergeButton job={row} />
          </li>
        ))}
      </ul>
    </MergeProvider>,
  );
}

const pickFirst = (title: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`merge ${title.replace(/[()]/g, '\\$&')} with`) }));

beforeEach(() => {
  confirm.mockResolvedValue(true);
  merge.mockResolvedValue({ ok: true, data: { kept: NOFLUFF.title, merged: ADZUNA.title } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(useConfirm).mockReturnValue(confirm);
});

describe('"Same job as…"', () => {
  it('picks a job, then merges the one clicked next with it, after asking', async () => {
    list();
    pickFirst(ADZUNA.title);
    expect(screen.getByRole('status').textContent).toContain(ADZUNA.title);
    // the other row offers itself; the picked one only cancels
    expect(screen.getAllByRole('button', { name: /Same job$/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Same job$/ }));
    await waitFor(() => expect(merge).toHaveBeenCalledExactlyOnceWith({ jobId: ADZUNA.jobId, sameAs: NOFLUFF.jobId }));
    // the question shows the earlier one as the one that stays, whichever was picked first
    const asked = confirm.mock.lastCall?.[0];
    render(<>{asked?.details}</>);
    const [stays, merged] = screen.getAllByText(/Frontend Developer/, { selector: '.font-semibold' }).slice(-2);
    expect([stays.textContent, merged.textContent]).toEqual([NOFLUFF.title, ADZUNA.title]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('merges nothing when the question is answered no, and keeps the pick', async () => {
    confirm.mockResolvedValue(false);
    list();
    pickFirst(NOFLUFF.title);
    fireEvent.click(screen.getByRole('button', { name: /Same job$/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(merge).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('drops the pick on Escape or Cancel', () => {
    list();
    pickFirst(NOFLUFF.title);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    pickFirst(NOFLUFF.title);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says what went wrong, and keeps the pick', async () => {
    merge.mockResolvedValue({ ok: false, error: 'They are one job already.' });
    list();
    pickFirst(NOFLUFF.title);
    fireEvent.click(screen.getByRole('button', { name: /Same job$/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('They are one job already.'));
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
