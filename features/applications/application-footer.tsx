'use client';

import type { Ref } from 'react';
import { PencilIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { JobSheetFooter, OpenOnBoard } from './job-sheet';
import type { Shown } from './use-application';

/** The application window's buttons, and what went wrong with the last one. */
export function ApplicationFooter({
  app,
  board,
  busy,
  error,
  editButton,
  onUnmark,
  onEdit,
  onFetchAgain,
  onClose,
}: {
  app: Shown;
  board: string;
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
    <JobSheetFooter error={error}>
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
      {app.url && <OpenOnBoard url={app.url} board={board} />}
      <Button type="button" onClick={onClose}>
        Close
      </Button>
    </JobSheetFooter>
  );
}
