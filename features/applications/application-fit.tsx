'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTransition } from 'react';
import { Loader2Icon, RotateCwIcon, SparklesIcon } from 'lucide-react';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { Button } from '@/components/ui/button';
import { FitScore } from '@/features/offers/fit-score';
import { isRentADev, RentADev } from '@/features/offers/rent-a-dev';
import { assessFitAction } from './actions';
import { applicationKey, type Shown } from './use-application';

// the ad text still on its way: it would be judged on the title alone
const adWaiting = (app: Shown) => app.content === undefined || app.contentStatus === 'pending';

/**
 * Asks the active AI profile how well the job fits: its own transition, as the AI can take a minute
 * and the rest of the window stays in use meanwhile. The verdict goes onto whatever the window has by
 * then (the ad text may have come in); asked again, the new verdict replaces the old one.
 */
export function useFitCheck(jobId: string, onError: (error: string | null) => void) {
  const queryClient = useQueryClient();
  const [checking, start] = useTransition();
  const check = () =>
    start(async () => {
      onError(null);
      try {
        const fit = unwrap(await assessFitAction({ jobId }));
        // the application's own call on body leasing follows the check (lib/applications.ts assessFit)
        queryClient.setQueryData<Shown>(
          applicationKey(jobId),
          (current) => current && { ...current, fit, bodyLeasing: fit.bodyLeasing },
        );
      } catch (error) {
        onError(message(error));
      }
    });
  return { checking, check };
}

/**
 * The active AI profile's match score, as on the offers; a job it hasn't judged gets a button that asks it,
 * a judged one a "Check again" beside the score, shown as you point at the window's header (`group/header`).
 * "Rent-a-dev" before it, as in the list.
 */
export function ApplicationFit({ app, checking, onCheck }: { app: Shown; checking: boolean; onCheck: () => void }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {isRentADev(app) && <RentADev />}
      <FitBadge app={app} checking={checking} onCheck={onCheck} />
    </span>
  );
}

function FitBadge({ app, checking, onCheck }: { app: Shown; checking: boolean; onCheck: () => void }) {
  if (checking)
    return (
      <Button type="button" variant="outline" size="sm" disabled aria-busy>
        <Loader2Icon className="animate-spin" /> Checking…
      </Button>
    );
  if (app.fit === undefined) return null; // not loaded yet

  const waiting = adWaiting(app);
  if (app.fit)
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          // a touch screen can't hover: always there
          className="text-muted-foreground transition-opacity hover:text-foreground pointer-fine:opacity-0 pointer-fine:group-hover/header:opacity-100 pointer-fine:focus-visible:opacity-100"
          title={waiting ? 'Once the ad text is in' : 'Check the fit again'}
          aria-label="Check the fit again"
          disabled={waiting}
          onClick={onCheck}
        >
          <RotateCwIcon />
        </Button>
        <FitScore
          match={app.fit.match}
          score={app.fit.score}
          summary={app.fit.summary}
          checks={app.fit.checks}
          hadDescription={app.fit.hadDescription}
        />
      </>
    );
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={waiting}
      title={waiting ? 'Once the ad text is in' : 'Ask the AI how well this job fits your profile'}
      onClick={onCheck}
    >
      <SparklesIcon /> Check fit
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
