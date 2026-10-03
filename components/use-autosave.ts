'use client';

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';

/**
 * - idle: nothing typed since it opened (or since another version was picked)
 * - typing: changed, not saved yet
 * - saving: a save is on its way
 * - saved: what's there is saved
 * - error: the last save didn't go through (the next change or flush tries again)
 */
export type AutosaveStatus = 'idle' | 'typing' | 'saving' | 'saved' | 'error';

/**
 * `save` stores `value`: true once it's stored, false if it isn't. `base` is the stored value it's
 * written over; `latest()` the value as it is by the time the save answers (typing goes on).
 */
export type AutosaveSave<T> = (value: T, context: { base: T; latest: () => T }) => Promise<boolean>;

export type AutosaveOptions<T> = {
  delay: number;
  /** what's stored when it starts */
  saved: T;
  /** while true, nothing is saved and the status stays as it is (e.g. a conflict to resolve first) */
  blocked?: () => boolean;
};

/**
 * Saves `value` by itself: `delay` ms after it last changed, at once on `flush()` (leaving the field,
 * closing the window), and when the component goes with something unsaved. One save at a time,
 * always of the newest value; a value equal to the stored one isn't sent.
 */
export function useAutosave<T>(value: T, save: AutosaveSave<T>, { delay, saved, blocked }: AutosaveOptions<T>) {
  const [stored, setStored] = useState(saved); // what's stored, for rendering
  const [status, setStatus] = useState<AutosaveStatus>(Object.is(value, saved) ? 'idle' : 'typing');

  // The same for the saves, which outlive the render they started in
  const storedNow = useRef(saved);
  const latest = useRef(value);
  const saveNow = useRef(save);
  const blockedNow = useRef(blocked);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelled = useRef(false);
  useLayoutEffect(() => {
    latest.current = value;
    saveNow.current = save;
    blockedNow.current = blocked;
  });

  // a change: "typing", or back at the stored value ("saved", unless nothing was ever typed)
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    setStatus(Object.is(value, stored) ? (status === 'idle' ? 'idle' : 'saved') : 'typing');
  }

  const flush = (): Promise<void> => {
    clearTimeout(timer.current);
    if (cancelled.current || blockedNow.current?.()) return Promise.resolve();
    if (inFlight.current) return inFlight.current.then(flush); // then the newest value, if it's still unsaved
    const next = latest.current;
    const base = storedNow.current;
    if (Object.is(next, base)) return Promise.resolve();
    setStatus('saving');
    inFlight.current = saveNow
      .current(next, { base, latest: () => latest.current })
      .then((ok) => {
        if (!ok) {
          setStatus('error');
          return;
        }
        storedNow.current = next;
        setStored(next);
        setStatus(Object.is(latest.current, next) ? 'saved' : 'typing');
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  };

  // `delay` after the last change
  const due = useEffectEvent(() => void flush());
  useEffect(() => {
    if (Object.is(value, storedNow.current)) return;
    const pending = setTimeout(() => due(), delay);
    timer.current = pending;
    return () => clearTimeout(pending);
  }, [value, delay]);

  // gone with something unsaved: saved on the way out
  const leave = useEffectEvent(() => void flush());
  useEffect(() => () => leave(), []);

  return {
    status,
    /** what's stored, as of now (a save that answered since the last render included) */
    stored: () => storedNow.current,
    /** saves now what isn't saved yet; resolves once that's done (or failed) */
    flush,
    /** what's stored is `now` (e.g. another version was picked); `show`: the status to show from here */
    reset: (now: T, show?: AutosaveStatus) => {
      storedNow.current = now;
      setStored(now);
      if (show) setStatus(show);
    },
    /** nothing is saved any more (what it saves to is gone) */
    cancel: () => {
      cancelled.current = true;
      clearTimeout(timer.current);
    },
  };
}
