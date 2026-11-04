'use client';

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TimeZone } from '@/components/time-zone';
import { useApplicationWindow } from './application-window';
import type { OfferJob } from './offer-sheet';
import { WindowButton } from './row-box';
import { offerQuery } from './use-offer';

// The offer's window loads when it's first wanted: as you point at its row (or tab to its button), its
// code and what it shows (the ad, fetched then the first time) start on their way.
const loadSheet = () => import('./offer-sheet');
const OfferSheet = lazy(() => loadSheet().then((module) => ({ default: module.OfferSheet })));

type Props = { job: OfferJob; labels: Record<string, string>; tz: string };

/** What opens a job's window: `onPrefetch` when it's likely next, `onClick` opens it, `busy` while it loads. */
export type WindowTrigger = (props: { onClick: () => void; onPrefetch: () => void; busy: boolean }) => ReactNode;

/**
 * After an offer's title: opens its window (the ad, your note, the fit), as a click on the row does; counts
 * as opening it (seen).
 * Once it's applied to, the window is the application's (its note went there), as from the Applied badge.
 */
export function OfferWindowButton(props: Props & { applied: boolean }) {
  return (
    <JobWindow
      {...props}
      trigger={({ onClick, onPrefetch, busy }) => (
        <WindowButton title={props.job.title} onPrefetch={onPrefetch} onClick={onClick} aria-busy={busy || undefined} />
      )}
    />
  );
}

/** A job's window, the offer's or (`applied`) the application's, opened by what `trigger` renders. */
export function JobWindow({ applied, ...props }: Props & { applied: boolean; trigger: WindowTrigger }) {
  return applied ? <ApplicationWindow {...props} /> : <OfferOnlyWindow {...props} />;
}

function OfferOnlyWindow({ job, labels, tz, trigger }: Props & { trigger: WindowTrigger }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const prefetch = () => {
    if (open) return;
    void queryClient.query(offerQuery(job.jobId)).catch(() => {}); // a failure shows in the window
    void loadSheet().catch(() => {});
  };

  return (
    <>
      {trigger({ onClick: () => setOpen(true), onPrefetch: prefetch, busy: false })}
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

function ApplicationWindow({ job, labels, tz, trigger }: Props & { trigger: WindowTrigger }) {
  const application = useApplicationWindow({
    jobId: job.jobId,
    labels,
    tz,
    onError: (error) => error && toast.error(error),
  });

  return (
    <>
      {trigger({
        onClick: () => void application.open(),
        onPrefetch: application.prefetch,
        busy: application.opening,
      })}
      {application.window}
    </>
  );
}
