// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markSeenAction } from '@/features/offers/actions';
import { SeenItem, SeenMark } from '@/features/offers/seen';

vi.mock('@/features/offers/actions', () => ({ markSeenAction: vi.fn() }));
const markSeen = vi.mocked(markSeenAction);

const JOB = 'acme|reactdeveloper';
function row(seen = false) {
  render(
    <ul>
      <SeenItem jobId={JOB} seen={seen}>
        <a href="https://justjoin.example/1">React Developer</a>
        <SeenMark />
        <a href="https://nofluff.example/a">No Fluff Jobs</a>
        <button type="button">Mark applied</button>
      </SeenItem>
    </ul>,
  );
}

beforeEach(() => markSeen.mockResolvedValue({ ok: true, data: undefined }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('seen offers', () => {
  it('marks the job seen when its title is opened, at once and once', () => {
    row();
    expect(screen.queryByText('(seen)')).toBeNull();
    fireEvent.click(screen.getByText('React Developer'));
    expect(screen.getByText('(seen)')).toBeTruthy();
    fireEvent.click(screen.getByText('No Fluff Jobs'));
    expect(markSeen).toHaveBeenCalledExactlyOnceWith({ jobId: JOB });
  });

  it("counts a board's link and a middle click, not the row's buttons or a right click", () => {
    row();
    fireEvent.click(screen.getByText('Mark applied'));
    fireEvent(screen.getByText('No Fluff Jobs'), new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(markSeen).not.toHaveBeenCalled();
    fireEvent(screen.getByText('No Fluff Jobs'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(markSeen).toHaveBeenCalledOnce();
    expect(screen.getByText('(seen)')).toBeTruthy();
  });

  it('shows the mark for a job seen before without saving it again', () => {
    row(true);
    expect(screen.getByTitle('Opened before')).toBeTruthy();
    fireEvent.click(screen.getByText('React Developer'));
    expect(markSeen).not.toHaveBeenCalled();
  });
});
