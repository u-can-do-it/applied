'use client';

import { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TimeZone } from '@/components/time-zone';
import { useApplicationWindow } from './application-window';
import type { OfferJob } from './offer-sheet';
import { WindowButton } from './row-box';
import { offerQuery } from './use-offer';

// The offer's window loads when it's first wanted: as you point at its button (or tab to it), its
// code and what it shows (the ad, fetched then the first time) start on their way.
const loadSheet = () => import('./offer-sheet');
const OfferSheet = lazy(() => loadSheet().then((module) => ({ default: module.OfferSheet })));

type Props = { job: OfferJob; labels: Record<string, string>; tz: string };

/**
 * After an offer's title: opens its window (the ad, your note, the fit), as a click on the row does; counts
 * as opening it (seen).
 * Once it's applied to, the window is the application's (its note went there), as from the Applied badge.
 */
export function OfferWindowButton({ applied, ...props }: Props & { applied: boolean }) {
  return applied ? <ApplicationWindowButton {...props} /> : <OfferOnlyWindowButton {...props} />;
}

function OfferOnlyWindowButton({ job, labels, tz }: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const prefetch = () => {
    if (open) return;
    void queryClient.query(offerQuery(job.jobId)).catch(() => {}); // a failure shows in the window
    void loadSheet().catch(() => {});
  };

  return (
    <>
      <WindowButton title={job.title} onPointerEnter={prefetch} onFocus={prefetch} onClick={() => setOpen(true)} />
      {open && (
        <TimeZone tz={tz}>
          <Suspense fallback={null}>
            <OfferSheet job={job} labels={labels} onClose={() => setOpen(false)} />
          </Suspense>
        </TimeZone>
      )}
    </>
  );
}

function ApplicationWindowButton({ job, labels, tz }: Props) {
  const application = useApplicationWindow({
    jobId: job.jobId,
    labels,
    tz,
    onError: (error) => error && toast.error(error),
  });

  return (
    <>
      <WindowButton
        title={job.title}
        onPointerEnter={application.prefetch}
        onFocus={application.prefetch}
        onClick={() => void application.open()}
        aria-busy={application.opening || undefined}
      />
      {application.window}
    </>
  );
}
