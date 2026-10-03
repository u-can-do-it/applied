'use client';

import { startTransition, useState, useTransition } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { message } from '@/lib/shared/errors';
import { fail, type Result } from '@/lib/shared/result';
import { cn } from '@/lib/shared/cn';

// Buttons and toggles run their actions through this (Settings' pause, cron and scraper switches, the
// time zone select, Telegram's). A form uses components/form.tsx (`answered`, <FormError>) instead.

/** What an action answers here: a message to show ("Saved."), or anything else (not shown). */
type Answer = Result<unknown>;

/**
 * Runs an action from a button or a toggle (a select that saves as you pick, too): busy state, an optimistic update to show right away,
 * and its answer: "Saved." as a toast; what went wrong in `error`, for an <ActionError> next to the control
 * (it stays until the next try, and lands with the refreshed page).
 */
export function useAction() {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Answer>, optimistic?: () => void) => {
    setError(null);
    start(async () => {
      optimistic?.();
      const answer = await fn().catch((failure: unknown) => fail(message(failure)));
      if (!answer.ok) startTransition(() => setError(answer.error));
      else if (typeof answer.data === 'string' && answer.data) toast.success(answer.data);
    });
  };
  return { busy, error, run };
}

/** What went wrong, next to the control that did it; nothing when nothing did. */
export function ActionError({ error, className }: { error: string | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" className={cn('mt-2', className)}>
      <TriangleAlertIcon />
      <AlertTitle className="font-normal [overflow-wrap:anywhere]">{error}</AlertTitle>
    </Alert>
  );
}
