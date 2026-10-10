'use client';

import { lazy, Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PanelRightOpenIcon } from 'lucide-react';
import { TimeZone } from '@/components/time-zone';
import { Button } from '@/components/ui/button';
import type { OfferJob } from './offer-sheet';
import { offerQuery } from './use-offer';

// The offer's window loads when it's first wanted: as you point at its button (or tab to it), its
// code and what it shows (the ad, fetched then the first time) start on their way.
const loadSheet = () => import('./offer-sheet');
const OfferSheet = lazy(() => loadSheet().then((module) => ({ default: module.OfferSheet })));

/** After an offer's title: opens its window (the ad, your note, the fit); counts as opening it (seen). */
export function OfferWindowButton({ job, labels, tz }: { job: OfferJob; labels: Record<string, string>; tz: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const prefetch = () => {
    if (open) return;
    void queryClient.query(offerQuery(job.jobId)).catch(() => {}); // a failure shows in the window
    void loadSheet().catch(() => {});
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="ml-0.5 align-[-3px] text-muted-foreground hover:text-foreground"
        data-marks-seen
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Details of ${job.title}`}
        title="Details: the ad, your note, the fit"
      >
        <PanelRightOpenIcon />
      </Button>
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
