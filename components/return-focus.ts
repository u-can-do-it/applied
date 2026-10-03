'use client';

import { useRef } from 'react';

/**
 * Radix gives focus back to a dialog's Trigger when it closes. A dialog the app opens from code has
 * no Trigger, so focus would fall to the page: this keeps what had focus when it opened (the button
 * clicked) and gives it back. A dialog mounted when it opens remembers on its first render; one that
 * stays mounted calls `remember()` as it opens.
 */
export function useReturnFocus() {
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  return {
    remember: () => {
      opener.current = document.activeElement;
    },
    /** for the dialog's onCloseAutoFocus */
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      // the button is gone (it removed its own row): back into the window still open under this one
      const target =
        opener.current instanceof HTMLElement && opener.current.isConnected
          ? opener.current
          : document.querySelector<HTMLElement>('[role=dialog][data-state=open]');
      target?.focus();
    },
  };
}
