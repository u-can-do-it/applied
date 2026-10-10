'use client';

import { useRef, useState, useTransition } from 'react';
import { ExternalLinkIcon, TriangleAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { ListedJob } from '@/lib/jobs';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { applyAction } from '@/features/applications/actions';
import { AdDetails } from '@/features/applications/ad-details';
import { AdText, type ShownAd } from '@/features/applications/ad-text';
import { ApplicationFit, FitSummary, useFitCheck, type ShownFit } from '@/features/applications/application-fit';
import { NoteEditor, type NoteHandle } from '@/features/applications/note-editor';
import { useDay } from '@/features/applications/use-day';
import { assessJobFitAction, setJobNoteAction } from './actions';
import { useArchiveRow } from './archive';
import { loadOffer, offerKey, useOffer } from './use-offer';

// One offer you haven't applied to, read like an application: the ad complete with what the board says
// besides, your note, the AI's fit; marking it applied, archiving it. Opens with what the list has
// (title, company, verdict); the ad and the note load into their places. Not modal, as an
// application's window: the list stays in use, a click anywhere else closes it (the note saved on the way).

export type OfferJob = Pick<ListedJob, 'jobId' | 'src' | 'id' | 'title' | 'company' | 'url' | 'firstSeen' | 'ai'>;

export const NOTE_PLACEHOLDER = 'Why it caught your eye, who to ask, what to mention when you apply…';

export function OfferSheet({
  job,
  labels,
  onClose,
}: {
  job: OfferJob;
  labels: Record<string, string>;
  onClose: () => void;
}) {
  const { jobId } = job;
  const day = useDay();
  const [open, setOpen] = useState(true);
  const focus = useReturnFocus();
  const clickedAway = useRef(false);
  const note = useRef<NoteHandle>(null);
  const moved = useRef(false); // marked applied: the note went with it
  const row = useArchiveRow();
  const loaded = useOffer(jobId);
  const data = loaded.data;
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const fit = useFitCheck(offerKey(jobId), () => assessJobFitAction({ jobId }), setError);
  const board = labels[job.src] ?? job.src;
  // the list's verdict until the window's is in; the ad text and the note load into their places
  const shown: ShownFit & ShownAd = {
    fit: data ? data.fit : (job.ai ?? undefined),
    bodyLeasing: null,
    content: data?.content,
    contentStatus: data?.contentStatus ?? 'pending',
    contentError: data?.contentError ?? null,
    scrapedAt: data?.scrapedAt ?? null,
  };

  const close = () => {
    if (!moved.current) note.current?.flush();
    setOpen(false);
  };

  const markApplied = () =>
    start(async () => {
      setError(null);
      try {
        await note.current?.settle(); // the note moves to the application: all of it
        unwrap(await applyAction({ jobId, src: job.src, id: job.id }));
        moved.current = true;
        toast.success(`Marked applied: “${job.title}”`);
        close();
      } catch (failure) {
        setError(message(failure));
      }
    });

  const archive = () => {
    close();
    row?.move();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()} modal={false}>
      <SheetContent
        className="gap-0 shadow-2xl outline-none data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]"
        // the window itself takes the focus, not its first button: on the fit badge, its checklist would open
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.target instanceof HTMLElement) event.target.focus();
        }}
        onPointerDownOutside={(event) => {
          keepOpenOnToast(event);
          clickedAway.current = !event.defaultPrevented;
        }}
        // the focus going elsewhere (a toast, the list) isn't leaving
        onFocusOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (clickedAway.current) event.preventDefault();
          else focus.onCloseAutoFocus(event);
          onClose();
        }}
      >
        <SheetHeader className="group/header gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <SheetTitle className="text-lg font-semibold">{job.title}</SheetTitle>
              <SheetDescription className="text-[13px]">
                {job.company && <>{job.company} · </>}
                {board} · first seen {day(job.firstSeen)}
              </SheetDescription>
            </div>
            <ApplicationFit app={shown} checking={fit.checking} onCheck={fit.check} />
          </div>
          <FitSummary app={shown} />
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
          {data ? (
            <NoteEditor
              ref={note}
              jobId={jobId}
              store={{
                save: (text, seenAt) => setJobNoteAction({ jobId, note: text, seenAt }),
                load: () => loadOffer(jobId),
              }}
              initial={data.note ?? ''}
              seenAt={data.noteUpdatedAt}
              editedAt={data.noteUpdatedAt}
              placeholder={NOTE_PLACEHOLDER}
              onSaved={() => {}}
              onStale={() => {}}
            />
          ) : (
            !loaded.error && (
              <div className="flex flex-col gap-1.5" role="status" aria-label="Loading the note">
                <Skeleton className="h-4 w-12 rounded-sm" />
                <Skeleton className="h-[4.6em] rounded-md" />
              </div>
            )
          )}
          <AdDetails details={data?.details ?? null} />
          <AdText ad={shown} loadError={loaded.error ? message(loaded.error) : null} />
        </div>

        <SheetFooter className="mt-0 flex-row flex-wrap items-center justify-end gap-2 border-t px-3.5 py-2.5 sm:px-5 sm:py-3">
          {error && (
            <Alert variant="destructive" className="basis-full">
              <TriangleAlertIcon />
              <AlertTitle className="font-normal">{error}</AlertTitle>
            </Alert>
          )}
          {row && (
            <Button type="button" variant="ghost" className="mr-auto" disabled={busy} onClick={archive}>
              {row.archived ? 'Restore' : 'Archive'}
            </Button>
          )}
          <a
            className={buttonVariants({ variant: 'outline' })}
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on {board} <ExternalLinkIcon />
          </a>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !data}
            aria-busy={busy || undefined}
            title={data ? 'Saves that you applied, with the complete ad text and this note' : 'Once the note is in'}
            onClick={markApplied}
          >
            Mark applied
          </Button>
          <Button type="button" onClick={close}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
