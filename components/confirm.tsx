'use client';

import { createContext, lazy, Suspense, use, useRef, useState } from 'react';
import { useReturnFocus } from './return-focus';

// "Are you sure?" before something that can't be undone: `if (!(await confirm({ … }))) return;`.
// One AlertDialog for the whole app (in the root layout); Escape and Cancel answer no. Focus goes
// back to the button that asked. The dialog's code loads with the first question.

const ConfirmDialog = lazy(() => import('./confirm-dialog'));

export type ConfirmOptions = {
  title: string;
  /** what happens, in a sentence */
  description: string;
  /** the button that says yes: "Delete", "Unmark" */
  action: string;
  /** a red yes button: something is deleted */
  destructive?: boolean;
};

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // kept after the answer, so the dialog doesn't go blank while it fades out
  const [asked, setAsked] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const focus = useReturnFocus();

  const reply = (yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    setOpen(false);
  };
  const ask: Ask = (options) =>
    new Promise((resolve) => {
      answer.current?.(false); // a question still open is a no
      answer.current = resolve;
      focus.remember();
      setAsked(options);
      setOpen(true);
    });

  return (
    <ConfirmContext value={ask}>
      {children}
      {asked && (
        <Suspense fallback={null}>
          <ConfirmDialog open={open} asked={asked} reply={reply} onCloseAutoFocus={focus.onCloseAutoFocus} />
        </Suspense>
      )}
    </ConfirmContext>
  );
}

/** Asks in the app's AlertDialog; resolves true for yes. */
export function useConfirm(): Ask {
  const ask = use(ConfirmContext);
  if (!ask) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ask;
}
