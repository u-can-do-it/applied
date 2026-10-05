'use client';

import { createContext, use, useOptimistic, useTransition, type ReactNode } from 'react';
import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/shared/cn';
import { archiveAction, restoreAction } from './actions';
import { ON_HOVER } from './offer-actions';

// "Archived": a job you don't want in the lists any more (one reposted again and again, say). The row
// leaves the list on the click frame, the refreshed list catches up, and the toast's Undo puts it back;
// a failed save brings the row back with the error. ?archived=1 lists the archived jobs, where the same
// button restores one.

type Row = { archived: boolean; title: string; move: () => void };
const RowContext = createContext<Row | null>(null);

/** Around a row of the list: it goes from the list at once when its archive button is clicked. */
export function ArchiveRow({
  jobId,
  title,
  archived,
  children,
}: {
  jobId: string;
  title: string;
  archived: boolean;
  children: ReactNode;
}) {
  const [moved, setMoved] = useOptimistic(false);
  const [, start] = useTransition();
  const save = archived ? restoreAction : archiveAction;
  const undo = async () => {
    const res = await (archived ? archiveAction : restoreAction)({ jobId });
    if (!res.ok) toast.error(res.error);
  };

  const move = () =>
    start(async () => {
      setMoved(true);
      const res = await save({ jobId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(archived ? `Restored “${title}”` : `Archived “${title}”`, {
        action: { label: 'Undo', onClick: () => void undo() },
        duration: 8000, // time to change your mind
      });
    });

  if (moved) return null;
  return <RowContext value={{ archived, title, move }}>{children}</RowContext>;
}

/** The row's archive button ("Restore" in the archived list). */
export function ArchiveButton() {
  const row = use(RowContext);
  if (!row) return null;
  const Icon = row.archived ? ArchiveRestoreIcon : ArchiveIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn('rounded-full text-muted-foreground', ON_HOVER)}
      onClick={row.move}
      aria-label={row.archived ? `Restore ${row.title}` : `Archive ${row.title}`}
      title={row.archived ? 'Back in the lists' : 'Archive: leave it out of the lists'}
    >
      <Icon />
    </Button>
  );
}
