'use client';

import type { Ref } from 'react';
import { ExternalLinkIcon, PencilIcon, TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { SheetFooter } from '@/components/ui/sheet';
import type { Shown } from './use-application';

/** The application window's buttons, and what went wrong with the last one. */
export function ApplicationFooter({
  app,
  busy,
  error,
  editButton,
  onUnmark,
  onEdit,
  onFetchAgain,
  onClose,
}: {
  app: Shown;
  busy: boolean;
  error: string | null;
  editButton: Ref<HTMLButtonElement>;
  onUnmark: () => void;
  onEdit: () => void;
  onFetchAgain: () => void;
  onClose: () => void;
}) {
  const waiting = app.content === undefined || app.contentStatus === 'pending';
  const hasText = app.contentStatus === 'ok' && !!app.content;
  return (
    <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
      {error && (
        <Alert variant="destructive" className="basis-full">
          <TriangleAlertIcon />
          <AlertTitle className="font-normal">{error}</AlertTitle>
        </Alert>
      )}
      <Button
        type="button"
        variant="destructive"
        className="mr-auto"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={onUnmark}
      >
        Unmark applied
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={busy || waiting}
        title={waiting ? 'Once the ad text is in' : undefined}
        ref={editButton}
        onClick={onEdit}
      >
        <PencilIcon /> Edit
      </Button>
      {!waiting && !hasText && (
        <Button type="button" variant="outline" disabled={busy} aria-busy={busy || undefined} onClick={onFetchAgain}>
          Fetch again
        </Button>
      )}
      {app.url && (
        <a className={buttonVariants({ variant: 'outline' })} href={app.url} target="_blank" rel="noopener noreferrer">
          Open original <ExternalLinkIcon />
        </a>
      )}
      <Button type="button" onClick={onClose}>
        Close
      </Button>
    </SheetFooter>
  );
}
