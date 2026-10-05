'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTransition } from 'react';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { Button } from '@/components/ui/button';
import { FitScore } from '@/features/offers/fit-score';
import { assessFitAction } from './actions';
import { applicationKey, type Shown } from './use-application';

/**
 * The active AI profile's match score, as on the AI tab. A job it hasn't judged gets a button that
 * asks it: its own transition, as the AI can take a minute and the rest of the window stays in use
 * meanwhile. The verdict goes onto whatever the window has by then (the ad text may have come in).
 */
export function ApplicationFit({
  app,
  jobId,
  onError,
}: {
  app: Shown;
  jobId: string;
  onError: (error: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [checking, start] = useTransition();
  if (app.fit)
    return (
      <FitScore
        score={app.fit.score}
        summary={app.fit.summary}
        checks={app.fit.checks}
        hadDescription={app.fit.hadDescription}
      />
    );
  if (app.fit === undefined) return null; // not loaded yet

  const check = () =>
    start(async () => {
      onError(null);
      try {
        const fit = unwrap(await assessFitAction({ jobId }));
        queryClient.setQueryData<Shown>(applicationKey(jobId), (current) => current && { ...current, fit });
      } catch (error) {
        onError(message(error));
      }
    });
  // the ad text still on its way: it would be judged on the title alone
  const adWaiting = app.content === undefined || app.contentStatus === 'pending';
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={checking || adWaiting}
      aria-busy={checking || undefined}
      title={adWaiting ? 'Once the ad text is in' : 'Ask the AI how well this job fits your profile'}
      onClick={check}
    >
      {checking ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
      {checking ? 'Checking…' : 'Check fit'}
    </Button>
  );
}

/** The AI's one-line reason for the score, under the title. */
export function FitSummary({ app }: { app: Shown }) {
  if (!app.fit?.summary) return null;
  return (
    <p className="mt-1 mb-0 text-xs text-brand">
      <SparklesIcon /> {app.fit.summary}
    </p>
  );
}
