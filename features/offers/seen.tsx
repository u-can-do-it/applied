'use client';

import { createContext, use, useState, type ComponentProps, type MouseEvent } from 'react';
import { CheckIcon } from 'lucide-react';
import { markSeenAction } from './actions';

// "Seen": a job whose offer you opened from a list. The row notices a click on any of its links (the
// title, a board's; a middle click too) and shows the check mark at once; the database keeps it for
// every device. Nothing to undo, and a failed save only means no mark after the next refresh.

const SeenContext = createContext(false);

export function SeenItem({ jobId, seen, children, ...props }: ComponentProps<'li'> & { jobId: string; seen: boolean }) {
  const [opened, setOpened] = useState(false);
  const shown = seen || opened;
  const open = (event: MouseEvent) => {
    if (shown || (event.type === 'auxclick' && event.button !== 1)) return;
    if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return;
    setOpened(true);
    void markSeenAction({ jobId });
  };
  return (
    <li {...props} onClick={open} onAuxClick={open}>
      <SeenContext value={shown}>{children}</SeenContext>
    </li>
  );
}

/** The check mark after the title, once the job is seen. */
export function SeenMark() {
  if (!use(SeenContext)) return null;
  return (
    <span className="ml-1 inline-flex align-[-2px] text-muted-foreground" title="Opened before">
      <CheckIcon className="size-3.5" aria-hidden />
      <span className="sr-only">(seen)</span>
    </span>
  );
}
