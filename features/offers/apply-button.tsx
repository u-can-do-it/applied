'use client';

import { startTransition, useOptimistic, useState, useTransition } from 'react';
import { CheckIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import { zoneOf } from '@/lib/dates';
import { cn } from '@/lib/shared/cn';
import { applyAction, unapplyAction } from '@/features/applications/actions';

/** "Mark applied" / "Applied 02.10.2026" with a check mark - flips on the click frame, the server catches up. */
export function ApplyButton({
  jobId,
  src,
  id,
  appliedAt,
  tz,
}: {
  jobId: string;
  src: string;
  id: string;
  appliedAt: string | null;
  tz: string; // the app's time zone, for the day
}) {
  const [applied, setApplied] = useOptimistic(appliedAt);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (
      applied &&
      !(await confirm({
        title: 'Unmark as applied?',
        description: 'The saved ad text is deleted too.',
        action: 'Unmark',
        destructive: true,
      }))
    )
      return;
    setError(null);
    start(async () => {
      setApplied(applied ? null : new Date().toISOString());
      const res = applied ? await unapplyAction({ jobId }) : await applyAction({ jobId, src, id });
      if (!res.ok) startTransition(() => setError(res.error));
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className={cn(
          'rounded-full bg-transparent font-normal text-muted-foreground hover:border-muted-foreground hover:bg-transparent hover:text-foreground dark:bg-transparent dark:hover:bg-transparent',
          applied && 'border-success text-success hover:border-success hover:text-success dark:border-success',
        )}
        onClick={() => void toggle()}
        aria-pressed={Boolean(applied)}
        aria-busy={pending || undefined}
        title={applied ? 'Click to unmark' : 'Saves that you applied, with the complete ad text'}
      >
        {applied ? (
          <>
            <CheckIcon /> Applied {zoneOf(tz).formatDayOf(applied)}
          </>
        ) : (
          'Mark applied'
        )}
      </Button>
      {error && (
        <span role="alert" className="max-w-56 text-right text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
