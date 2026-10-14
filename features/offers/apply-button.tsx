'use client';

import { startTransition, useOptimistic, useState, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckIcon, XIcon } from 'lucide-react';
import { useConfirm } from '@/components/confirm';
import { Button } from '@/components/ui/button';
import { zoneOf } from '@/lib/dates';
import { cn } from '@/lib/shared/cn';
import { applyAction, unapplyAction } from '@/features/applications/actions';
import { applicationKey } from '@/features/applications/use-application';
import { useApplicationWindow } from './application-window';
import { ON_HOVER } from './offer-actions';

const PILL =
  'rounded-full bg-transparent font-normal hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent';

/**
 * "Mark applied", or once applied, "Applied 02.10.2026" with a check mark - flips on the click frame,
 * the server catches up. A click on "Applied" opens the application's window; its × (shown on the
 * badge's hover or keyboard focus, always on a touch screen) unmarks it.
 */
export function ApplyButton({
  jobId,
  src,
  id,
  appliedAt,
  labels,
  tz,
}: {
  jobId: string;
  src: string;
  id: string;
  appliedAt: string | null;
  labels: Record<string, string>;
  tz: string; // the app's time zone, for the day
}) {
  const [applied, setApplied] = useOptimistic(appliedAt);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const application = useApplicationWindow({ jobId, labels, tz, onError: setError });

  const mark = () => {
    setError(null);
    start(async () => {
      setApplied(new Date().toISOString());
      const res = await applyAction({ jobId, src, id });
      if (!res.ok) startTransition(() => setError(res.error));
    });
  };

  const unmark = async () => {
    if (
      !(await confirm({
        title: 'Unmark as applied?',
        description: 'Its saved ad text, status history and note are deleted too.',
        action: 'Unmark',
        destructive: true,
      }))
    )
      return;
    setError(null);
    start(async () => {
      setApplied(null);
      queryClient.removeQueries({ queryKey: applicationKey(jobId), exact: true }); // a prefetched one is gone too
      const res = await unapplyAction({ jobId });
      if (!res.ok) startTransition(() => setError(res.error));
    });
  };

  return (
    <>
      {applied ? (
        <span className="group/applied relative inline-flex h-6 items-center rounded-full border border-success text-success">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(PILL, 'border-0 text-success hover:text-success hover:underline')}
            // marked a moment ago: the application is saved once the server answers
            disabled={pending}
            onPointerEnter={() => !pending && application.prefetch()}
            onFocus={() => !pending && application.prefetch()}
            onClick={() => void application.open()}
            aria-haspopup="dialog"
            aria-busy={pending || application.opening || undefined}
            title="Open the application"
          >
            {/* the × takes its place: the badge keeps its width */}
            <CheckIcon className="pointer-coarse:invisible pointer-fine:group-hover/applied:invisible pointer-fine:group-focus-within/applied:invisible" />{' '}
            Applied {zoneOf(tz).formatDayOf(applied)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              PILL,
              // on the check mark: centred where it is (8px in, 12px wide)
              'absolute inset-y-0 left-1 my-auto size-5 text-destructive hover:text-destructive',
              'pointer-fine:invisible pointer-fine:group-hover/applied:visible pointer-fine:group-focus-within/applied:visible',
            )}
            disabled={pending}
            onClick={() => void unmark()}
            aria-label="Unmark as applied"
            title="Unmark as applied"
          >
            <XIcon />
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className={cn(PILL, 'text-muted-foreground hover:border-muted-foreground hover:text-foreground', ON_HOVER)}
          onClick={mark}
          aria-busy={pending || undefined}
          title="Saves that you applied, with the complete ad text"
        >
          Mark applied
        </Button>
      )}
      {error && (
        <span role="alert" className="w-full max-w-56 text-right text-xs text-destructive">
          {error}
        </span>
      )}
      {application.window}
    </>
  );
}
