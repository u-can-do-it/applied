'use client';

import { startTransition, useState, useTransition } from 'react';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';

// Settings' buttons and forms run their actions through these (features/scraping, features/telegram).

/** What an action answers here: a message to show ("Saved."), or anything else (not shown). */
type Answer = Result<unknown>;

/**
 * Runs an action from a button or a form: busy state, an optimistic update to show right away, and
 * its answer, which shows with the refreshed page.
 */
export function useAction() {
  const [busy, start] = useTransition();
  const [state, setState] = useState<Answer | null>(null);
  const run = (fn: () => Promise<Answer>, optimistic?: () => void) => {
    setState(null);
    start(async () => {
      optimistic?.();
      const answer = await fn().catch((failure: unknown) => fail(message(failure)));
      startTransition(() => setState(answer));
    });
  };
  return { busy, state, run, clear: () => setState(null) };
}

export function Feedback({ state }: { state: Result<unknown> | null | undefined }) {
  if (state?.ok === false)
    return (
      <p className="form-error" role="alert">
        {state.error}
      </p>
    );
  if (typeof state?.data === 'string' && state.data)
    return (
      <p className="form-ok" role="status">
        {state.data}
      </p>
    );
  return null;
}
