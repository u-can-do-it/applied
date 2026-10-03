// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave, type AutosaveSave } from '@/components/use-autosave';

/** A save that answers when the test says so. */
function controlledSave() {
  const calls: { value: string; base: string; latest: () => string; answer: (ok: boolean) => void }[] = [];
  const save = vi.fn<AutosaveSave<string>>(
    (value, { base, latest }) =>
      new Promise<boolean>((resolve) => {
        calls.push({ value, base, latest, answer: resolve });
      }),
  );
  return { save, calls };
}

const setup = (save: AutosaveSave<string>, saved = '') =>
  renderHook(({ value }) => useAutosave(value, save, { delay: 700, saved }), { initialProps: { value: saved } });

/** lets the save's promise chain run */
const settle = () => act(() => Promise.resolve());
/** answers a save, then lets what follows it run */
const answer = (call: { answer: (ok: boolean) => void }, ok: boolean) =>
  act(() => {
    call.answer(ok);
    return Promise.resolve();
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave', () => {
  it('saves once, the delay after the last change', async () => {
    const { save, calls } = controlledSave();
    const hook = setup(save);
    expect(hook.result.current.status).toBe('idle');

    hook.rerender({ value: 'a' });
    act(() => void vi.advanceTimersByTime(500));
    hook.rerender({ value: 'ab' });
    expect(hook.result.current.status).toBe('typing');
    act(() => void vi.advanceTimersByTime(699));
    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ value: 'ab', base: '' });
    expect(hook.result.current.status).toBe('saving');

    await answer(calls[0], true);
    expect(hook.result.current.status).toBe('saved');
    expect(hook.result.current.stored()).toBe('ab');
  });

  it("doesn't send a value equal to the stored one", async () => {
    const { save } = controlledSave();
    const hook = setup(save, 'note');
    hook.rerender({ value: 'note!' });
    hook.rerender({ value: 'note' });
    act(() => void vi.advanceTimersByTime(1000));
    await act(() => hook.result.current.flush());
    expect(save).not.toHaveBeenCalled();
    // typed and back: what's there is what's stored
    expect(hook.result.current.status).toBe('saved');
  });

  it('keeps one save at a time while typing goes on, then saves the newest value', async () => {
    const { save, calls } = controlledSave();
    const hook = setup(save);

    hook.rerender({ value: 'a' });
    act(() => void vi.advanceTimersByTime(700));
    expect(calls).toHaveLength(1);

    // typing during the save, and the next pause comes before it answered
    hook.rerender({ value: 'ab' });
    expect(hook.result.current.status).toBe('typing');
    act(() => void vi.advanceTimersByTime(700));
    hook.rerender({ value: 'abc' });
    act(() => void hook.result.current.flush()); // leaving the field, too
    expect(calls).toHaveLength(1); // waits for the first

    // the first one sees newer text by the time it answers
    expect(calls[0].latest()).toBe('abc');
    await answer(calls[0], true);
    await settle();
    // then exactly one more, of the newest text, written over the first
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ value: 'abc', base: 'a' });
    expect(hook.result.current.status).toBe('saving');

    await answer(calls[1], true);
    await settle();
    expect(calls).toHaveLength(2);
    expect(hook.result.current.status).toBe('saved');
  });

  it('shows a failed save, and tries again on the next change', async () => {
    const { save, calls } = controlledSave();
    const hook = setup(save);

    hook.rerender({ value: 'a' });
    act(() => void vi.advanceTimersByTime(700));
    await answer(calls[0], false);
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.stored()).toBe('');

    // nothing by itself
    act(() => void vi.advanceTimersByTime(10_000));
    expect(calls).toHaveLength(1);

    hook.rerender({ value: 'ab' });
    expect(hook.result.current.status).toBe('typing');
    act(() => void vi.advanceTimersByTime(700));
    expect(calls[1]).toMatchObject({ value: 'ab', base: '' });
    await answer(calls[1], true);
    expect(hook.result.current.status).toBe('saved');
  });

  it('treats a save that throws as failed', async () => {
    const save = vi.fn<AutosaveSave<string>>(() => Promise.reject(new Error('offline')));
    const hook = setup(save);
    hook.rerender({ value: 'a' });
    await act(() => hook.result.current.flush());
    expect(hook.result.current.status).toBe('error');
  });

  it('saves what is unsaved when it goes', () => {
    const { save, calls } = controlledSave();
    const hook = setup(save);
    hook.rerender({ value: 'last words' });
    hook.unmount();
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBe('last words');
    act(() => void vi.advanceTimersByTime(700));
    expect(calls).toHaveLength(1); // not again when the delay is over
  });

  it('saves nothing more once cancelled', () => {
    const { save } = controlledSave();
    const hook = setup(save);
    hook.rerender({ value: 'a' });
    act(() => hook.result.current.cancel());
    act(() => void vi.advanceTimersByTime(700));
    hook.unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it('sends nothing and keeps its status while blocked', async () => {
    const { save, calls } = controlledSave();
    let blocked = true;
    const hook = renderHook(
      ({ value }) => useAutosave(value, save, { delay: 700, saved: '', blocked: () => blocked }),
      { initialProps: { value: '' } },
    );
    hook.rerender({ value: 'a' });
    act(() => void vi.advanceTimersByTime(700));
    await act(() => hook.result.current.flush());
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('typing');

    blocked = false;
    act(() => void hook.result.current.flush());
    expect(calls[0]).toMatchObject({ value: 'a', base: '' });
  });

  it('starts over from another stored value', () => {
    const { save, calls } = controlledSave();
    const hook = setup(save, 'mine');

    // another version was picked and put in the field: nothing to save
    act(() => hook.result.current.reset('theirs', 'idle'));
    hook.rerender({ value: 'theirs' });
    expect(hook.result.current.status).toBe('idle');
    act(() => void vi.advanceTimersByTime(700));
    expect(save).not.toHaveBeenCalled();

    // kept the typed one over it: saved over the new stored value
    hook.rerender({ value: 'mine again' });
    act(() => hook.result.current.reset('theirs again'));
    act(() => void hook.result.current.flush());
    expect(calls[0]).toMatchObject({ value: 'mine again', base: 'theirs again' });
  });
});
