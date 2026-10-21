'use client';

import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { PanelRightOpenIcon } from 'lucide-react';
import { cn } from '@/lib/shared/cn';
import { Button } from '@/components/ui/button';

// A job's row, the offers' or the Applied tab's: a click on it that isn't on one of its links or buttons
// (the title, the company, a board, the fit…) opens the job's window, as its window button does: it
// clicks that button (`data-opens-window`), so it counts as opening the job (seen) as the button does.

// what a click is its own on: the row leaves it alone
const OWN_CLICK = 'a[href], button, input, select, textarea, label, [role="button"]';

function openWindow(event: MouseEvent<HTMLElement>) {
  const { target, currentTarget } = event;
  // a window or a tooltip it opened is in another part of the page (a portal), its clicks come here too
  if (!(target instanceof Element) || !currentTarget.contains(target) || target.closest(OWN_CLICK)) return;
  if (window.getSelection()?.type === 'Range') return; // selecting its text
  currentTarget.querySelector<HTMLElement>('[data-opens-window]')?.click();
}

/** The row's box: a click on it opens the job's window. `active`: that window is open. */
export function RowBox({
  className,
  active = false,
  children,
}: {
  className?: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    // the window button after the title is the keyboard's way in: the row's click only saves aiming at it
    <div
      className={cn('cursor-pointer', active && 'bg-accent', className)}
      aria-current={active || undefined}
      onClick={openWindow}
    >
      {children}
    </div>
  );
}

/** After the title: opens the job's window (the ad, your note, the fit; or the application). */
export function WindowButton({ title, ...props }: { title: string } & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="ml-0.5 align-[-3px] text-muted-foreground hover:text-foreground"
      data-opens-window
      data-marks-seen
      aria-haspopup="dialog"
      aria-label={`Details of ${title}`}
      title="Details: the ad, your note, the fit"
      {...props}
    >
      <PanelRightOpenIcon />
    </Button>
  );
}
