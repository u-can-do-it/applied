'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTransition } from 'react';
import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { Button } from '@/components/ui/button';
import { FitScore } from '@/features/offers/fit-score';
import { RentADev } from '@/features/offers/rent-a-dev';
import { assessFitAction } from './actions';
import { applicationKey, type Shown } from './use-application';

// the ad text still on its way: it would be judged on the title alone
const adWaiting = (app: Shown) => app.content === undefined || app.contentStatus === 'pending';

/**
 * Asks the active AI profile how well the job fits: its own transition, as the AI can take a minute
 * and the rest of the window stays in use meanwhile. The verdict goes onto whatever the window has by
 * then (the ad text may have come in). `checkAgain(jobId)`: after an edit ("Check the fit again"), once
 * the ad text is in; the new verdict replaces the old one.
 */
export function useFitCheck(jobId: string, onError: (error: string | null) => void) {
  const queryClient = useQueryClient();
  const [checking, start] = useTransition();
  const shown = (id: string) => queryClient.getQueryData<Shown>(applicationKey(id));
  // the window's copy once its ad text is in; undefined: the window has closed meanwhile
  const adIn = (id: string) =>
    new Promise<Shown | undefined>((resolve) => {
      const settled = () => {
        const app = shown(id);
        return !app || !adWaiting(app);
      };
      if (settled()) {
        resolve(shown(id));
        return;
      }
      const stop = queryClient.getQueryCache().subscribe(() => {
        if (!settled()) return;
        stop();
        resolve(shown(id));
      });
    });
  const run = (id: string, afterEdit: boolean) =>
    start(async () => {
      onError(null);
      try {
        if (afterEdit && !(await adIn(id))) return;
        const fit = unwrap(await assessFitAction({ jobId: id }));
        // the application's own call on body leasing follows the check (lib/applications.ts assessFit)
        queryClient.setQueryData<Shown>(
          applicationKey(id),
          (current) => current && { ...current, fit, bodyLeasing: fit.bodyLeasing },
        );
      } catch (error) {
        onError(message(error));
      }
    });
  return { checking, check: () => run(jobId, false), checkAgain: (id: string) => run(id, true) };
}

/**
 * The active AI profile's match score, as on the offers; a job it hasn't judged gets a button that asks it.
 * "Rent-a-dev" before it, as in the list.
 */
export function ApplicationFit({ app, checking, onCheck }: { app: Shown; checking: boolean; onCheck: () => void }) {
  const bodyLeasing = app.bodyLeasing ?? app.fit?.bodyLeasing;
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {bodyLeasing && <RentADev />}
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
  if (app.fit)
    return (
      <FitScore
        match={app.fit.match}
        score={app.fit.score}
        summary={app.fit.summary}
        checks={app.fit.checks}
        hadDescription={app.fit.hadDescription}
      />
    );
  if (app.fit === undefined) return null; // not loaded yet

  const waiting = adWaiting(app);
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
