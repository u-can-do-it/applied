// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteEditor, type NoteHandle } from '@/features/applications/note-editor';
import { setApplicationNoteAction } from '@/features/applications/actions';
import { NOTE_CONFLICT } from '@/lib/shared/application-messages';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/features/applications/actions', () => ({ setApplicationNoteAction: vi.fn() }));
const saveNote = vi.mocked(setApplicationNoteAction);

const JOB = 'globex|frontendengineer';
const T1 = '2026-10-01T10:00:00.000Z'; // the note as the window opened
const T2 = '2026-10-02T10:00:00.000Z'; // changed in another tab
const T3 = '2026-10-03T10:00:00.000Z';
const draft = () => JSON.parse(localStorage.getItem(`jobwatch:note:${JOB}`) ?? 'null') as unknown;
/** the database's note, as GET /api/application answers */
const databaseHas = (note: string, at: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ note, noteUpdatedAt: at }) })),
  );
const conflict = () => ({ ok: false as const, error: NOTE_CONFLICT });
const saved = (at: string) => ({ ok: true as const, data: { noteUpdatedAt: at } });

const onSaved = vi.fn();
const onStale = vi.fn();
function open(initial = 'old') {
  const handle = createRef<NoteHandle>();
  const view = render(
    <NoteEditor
      ref={handle}
      jobId={JOB}
      initial={initial}
      seenAt={T1}
      editedAt={T1}
      onSaved={onSaved}
      onStale={onStale}
    />,
  );
  return { handle, view };
}
const box = () => screen.getByRole<HTMLTextAreaElement>('textbox');
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const status = () => document.querySelector('[aria-live]')?.textContent ?? '';
/** time passes, and what the saves started runs */
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** the window, with "mine" typed over "old" and rejected: "theirs" was saved elsewhere */
async function inConflict(theirs = 'theirs') {
  const opened = open();
  databaseHas(theirs, T2);
  saveNote.mockResolvedValueOnce(conflict());
  type('mine');
  await wait(700);
  await wait(10);
  return opened;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NoteEditor', () => {
  it('shows the other version when a save is rejected as a conflict', async () => {
    await inConflict();
    expect(saveNote).toHaveBeenCalledWith({ jobId: JOB, note: 'mine', seenAt: T1 });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(NOTE_CONFLICT);
    expect(alert.textContent).toContain('theirs');
    expect(status()).toContain('not saved: changed elsewhere');
    expect(box().value).toBe('mine');
    expect(draft()).toEqual({ text: 'mine', base: 'old' });
    expect(onStale).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();

    // nothing more is sent, typing or not, until a version is picked
    type('mine, more');
    await wait(2000);
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(status()).not.toContain('saving');
  });

  it('"Use that one" puts their note in the box and drops the draft', async () => {
    await inConflict();
    fireEvent.click(screen.getByRole('button', { name: 'Use that one' }));
    expect(box().value).toBe('theirs');
    expect(draft()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await wait(2000);
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it('"Keep mine" saves it over theirs, with their note_updated_at', async () => {
    await inConflict();
    saveNote.mockResolvedValueOnce(saved(T3));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine (replaces it)' }));
    expect(saveNote).toHaveBeenLastCalledWith({ jobId: JOB, note: 'mine', seenAt: T2 });
    await wait(10);
    expect(status()).toContain('saved');
    expect(draft()).toBeNull();
    expect(onSaved).toHaveBeenLastCalledWith('mine', T3);
  });

  it('"Keep mine" with the same text as theirs has nothing to save', async () => {
    await inConflict('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine (replaces it)' }));
    await wait(2000);
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(status()).toContain('saved');
    expect(draft()).toBeNull();
  });

  it('opens in conflict when the draft was written over an older note', async () => {
    localStorage.setItem(`jobwatch:note:${JOB}`, JSON.stringify({ text: 'my draft', base: 'older' }));
    const { handle, view } = open('current');
    expect(box().value).toBe('my draft');
    expect(screen.getByRole('alert').textContent).toContain('current');
    await wait(2000);
    expect(saveNote).not.toHaveBeenCalled();
    // closed without picking: nothing saved, the draft stays for next time
    expect(handle.current?.flush()).toBeUndefined();
    view.unmount();
    await wait(10);
    expect(saveNote).not.toHaveBeenCalled();
    expect(draft()).toEqual({ text: 'my draft', base: 'older' });
  });

  it('saves what was typed when the window closes', async () => {
    const { handle } = open();
    saveNote.mockResolvedValueOnce(saved(T3));
    type('last words');
    expect(handle.current?.flush()).toBe('last words');
    expect(saveNote).toHaveBeenCalledWith({ jobId: JOB, note: 'last words', seenAt: T1 });
    await wait(1000);
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(draft()).toBeNull();
  });
});
