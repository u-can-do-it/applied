'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ListedJob } from '@/lib/jobs';
import type { OfferAd, OfferWindow } from '@/lib/offer-window';
import { detailsWords } from '@/lib/ads/details';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFind } from '@/components/list-search';
import { useBackCloses } from '@/components/use-back-closes';
import { applyAction } from '@/features/applications/actions';
import { AdDetails } from '@/features/applications/ad-details';
import { AdText, type ShownAd } from '@/features/applications/ad-text';
import { useFitCheck, type ShownFit } from '@/features/applications/application-fit';
import { JobSheet, JobSheetBody, JobSheetFooter, JobSheetHeader, OpenOnBoard } from '@/features/applications/job-sheet';
import { NoteEditor, type NoteHandle } from '@/features/applications/note-editor';
import { useDay } from '@/features/applications/use-day';
import { assessJobFitAction, setJobNoteAction } from './actions';
import { AdEditor, type AdEditorHandle } from './ad-editor';
import { useArchiveRow } from './archive';
import { loadOffer, offerKey, useOffer } from './use-offer';

// One offer you haven't applied to, read like an application: the ad complete with what the board says
// besides, your note, the AI's fit; marking it applied, archiving it. Opens with what the list has
// (title, company, verdict); the ad and the note load into their places. The ad is yours to edit, or to
// paste (or read from a link) when the board page doesn't give it: it saves itself, and once you're done
// the AI judges the job from it. The same window as an application's (JobSheet): the list stays in use, a
// click anywhere else closes it (the note saved on the way).

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
  const note = useRef<NoteHandle>(null);
  const moved = useRef(false); // marked applied: the note went with it
  const row = useArchiveRow();
  const loaded = useOffer(jobId);
  const data = loaded.data;
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false); // the ad
  const adEditor = useRef<AdEditorHandle>(null);
  const changedAd = useRef(false); // saved since the edit began: the AI judges it again once you're done
  const fit = useFitCheck(offerKey(jobId), () => assessJobFitAction({ jobId }), setError);
  // a verdict on the title alone (from before every judgment needed the ad) is made again from the ad,
  // once the window has it: once per opening
  const rejudged = useRef(false);
  useEffect(() => {
    if (rejudged.current || data?.contentStatus !== 'ok' || !data.fit || data.fit.hadDescription) return;
    rejudged.current = true;
    fit.check();
  }, [data, fit]);
  const board = labels[job.src] ?? job.src;
  const { find, findMore } = useFind(
    [job.title, job.company, data?.note],
    data && [detailsWords(data.details), data.content],
  );
  // the list's verdict until the window's is in; the ad text and the note load into their places
  const shown: ShownFit & ShownAd = {
    fit: data ? data.fit : (job.ai ?? undefined),
    bodyLeasing: null,
    content: data?.content,
    contentStatus: data?.contentStatus ?? 'pending',
    contentError: data?.contentError ?? null,
    scrapedAt: data?.scrapedAt ?? null,
  };

  const adSaved = (ad: OfferAd) => {
    changedAd.current = true;
    rejudged.current = true; // judged once you're done, from what you saved
    void queryClient.cancelQueries({ queryKey: offerKey(jobId) }); // a load asked before would bring the old ad
    queryClient.setQueryData<OfferWindow>(offerKey(jobId), (current) => current && { ...current, ...ad });
  };
  const editAd = () => {
    changedAd.current = false;
    setEditing(true);
  };
  const doneEditingAd = () => {
    setEditing(false);
    if (changedAd.current) fit.check();
  };

  const close = () => {
    if (!moved.current) note.current?.flush();
    // the ad you were editing is saved on the way out (the AI judges it in a run, or as it opens next)
    if (!moved.current)
      void adEditor.current?.settle().then((why) => why && toast.error(`The ad wasn’t saved: ${why}`));
    setOpen(false);
  };
  useBackCloses(open, 'offer', close);

  const markApplied = () =>
    start(async () => {
      setError(null);
      try {
        await note.current?.settle(); // the note moves to the application: all of it
        const why = await adEditor.current?.settle(); // and the ad you pasted, when the board doesn't give it
        if (why) throw new Error(`The ad wasn’t saved: ${why}`);
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
    <JobSheet open={open} onDismiss={close} onGone={onClose}>
      <JobSheetHeader
        title={job.title}
        company={job.company}
        board={board}
        when={`first seen ${day(job.firstSeen)}`}
        fit={shown}
        checking={fit.checking}
        onCheck={fit.check}
        find={find}
      />

      <JobSheetBody>
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
            find={find}
          />
        ) : (
          !loaded.error && (
            <div className="flex flex-col gap-1.5" role="status" aria-label="Loading the note">
              <Skeleton className="h-4 w-12 rounded-sm" />
              <Skeleton className="h-[4.6em] rounded-md" />
            </div>
          )
        )}
        <AdDetails details={data?.details ?? null} find={findMore} />
        {editing && data ? (
          <AdEditor
            ref={adEditor}
            jobId={jobId}
            initial={data.contentStatus === 'ok' ? (data.content ?? '') : ''}
            onSaved={adSaved}
            onDone={doneEditingAd}
          />
        ) : (
          <AdText
            ad={shown}
            loadError={loaded.error ? message(loaded.error) : null}
            onEdit={data ? editAd : undefined}
            find={findMore}
          />
        )}
      </JobSheetBody>

      <JobSheetFooter error={error}>
        {row && (
          <Button type="button" variant="ghost" className="mr-auto" disabled={busy} onClick={archive}>
            {row.archived ? 'Restore' : 'Archive'}
          </Button>
        )}
        <OpenOnBoard url={job.url} board={board} />
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
      </JobSheetFooter>
    </JobSheet>
  );
}
