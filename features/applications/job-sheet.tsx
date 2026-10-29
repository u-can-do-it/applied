'use client';

import { useRef, type ReactNode } from 'react';
import { ExternalLinkIcon, TriangleAlertIcon } from 'lucide-react';
import { cn } from '@/lib/shared/cn';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Marked } from '@/components/marked';
import { buttonVariants } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { Find } from '@/lib/shared/search';
import { ApplicationFit, FitSummary, type ShownFit } from './application-fit';

// One job's window, an offer's or an application's: the same side panel, header, scrolling body and
// footer for both. A side panel, not modal: it reads like a page about one job, as tall as the screen,
// with the list still in view and in use beside it on a wide one; a click anywhere else closes it.

/**
 * The window. `open` false slides it out (`onDismiss`: Escape, the X, a click elsewhere, which the
 * caller turns into that after saving what's typed); `onGone` once it has, the focus given back (or left
 * where you clicked). A click where `keepOpen` says doesn't close it.
 */
export function JobSheet({
  open,
  onDismiss,
  onGone,
  keepOpen,
  onEscapeKeyDown,
  switched = false,
  showCloseButton = true,
  children,
}: {
  open: boolean;
  onDismiss: () => void;
  onGone: () => void;
  keepOpen?: (target: Element | null) => boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** shown in place of another job's: no sliding in */
  switched?: boolean;
  showCloseButton?: boolean;
  children: ReactNode;
}) {
  const focus = useReturnFocus();
  const clickedAway = useRef(false); // closed by a click elsewhere on the page: the focus stays there
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onDismiss()} modal={false}>
      <SheetContent
        className={cn(
          'gap-0 shadow-2xl outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]',
          switched && 'data-open:animate-none',
        )}
        showCloseButton={showCloseButton}
        // the window itself takes the focus, not its first button: on the fit badge, its checklist would open
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.target instanceof HTMLElement) event.target.focus();
        }}
        onEscapeKeyDown={onEscapeKeyDown}
        onPointerDownOutside={(event) => {
          if (keepOpen?.(event.target instanceof Element ? event.target : null)) event.preventDefault();
          else keepOpenOnToast(event);
          clickedAway.current = !event.defaultPrevented;
        }}
        // the focus going elsewhere (a confirmation, a toast, the list) isn't leaving
        onFocusOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          // still open: it's going because another job's window took its place
          if (open) {
            event.preventDefault();
            return;
          }
          if (clickedAway.current) event.preventDefault();
          else focus.onCloseAutoFocus(event);
          onGone();
        }}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The title, "company · board · `when`", and the AI's fit: its score (or a button that asks for it) and
 * its one-line reason. `plain`: another title is the window's (a form over it), this one only shows.
 * `find`: the list's search, its words marked in the title and the company.
 */
export function JobSheetHeader({
  title,
  company,
  board,
  when,
  fit,
  checking,
  onCheck,
  plain = false,
  find,
}: {
  title: string;
  company: string | null;
  board: string;
  when: string;
  fit: ShownFit;
  checking: boolean;
  onCheck: () => void;
  plain?: boolean;
  find?: Find;
}) {
  const subtitle = (
    <>
      {company && (
        <>
          <Marked text={company} marks={find?.(company)} /> ·{' '}
        </>
      )}
      {board} · {when}
    </>
  );
  const shownTitle = <Marked text={title} marks={find?.(title)} />;
  return (
    <SheetHeader className="group/header gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {plain ? (
            <h2 className="m-0 text-lg font-semibold">{shownTitle}</h2>
          ) : (
            <SheetTitle className="text-lg font-semibold">{shownTitle}</SheetTitle>
          )}
          {plain ? (
            <p className="m-0 text-[13px] text-muted-foreground">{subtitle}</p>
          ) : (
            <SheetDescription className="text-[13px]">{subtitle}</SheetDescription>
          )}
        </div>
        <ApplicationFit app={fit} checking={checking} onCheck={onCheck} />
      </div>
      <FitSummary app={fit} />
    </SheetHeader>
  );
}

/** Everything between the header and the buttons, scrolling inside the window. */
export function JobSheetBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
      {children}
    </div>
  );
}

/** The buttons, and what went wrong with the last one above them. */
export function JobSheetFooter({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
      {error && (
        <Alert variant="destructive" className="basis-full">
          <TriangleAlertIcon />
          <AlertTitle className="font-normal">{error}</AlertTitle>
        </Alert>
      )}
      {children}
    </SheetFooter>
  );
}

/** The offer on its board, in a new tab. */
export function OpenOnBoard({ url, board }: { url: string; board: string }) {
  return (
    <a className={buttonVariants({ variant: 'outline' })} href={url} target="_blank" rel="noopener noreferrer">
      Open on {board} <ExternalLinkIcon />
    </a>
  );
}
