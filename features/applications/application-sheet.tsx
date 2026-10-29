'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState, useTransition, type Ref } from 'react';
import type { Application, ApplicationWithContent } from '@/lib/applications';
import { stageOf, outcomeLabel, withStatus, type StageId, type OutcomeId } from '@/lib/stages';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { cn } from '@/lib/shared/cn';
import { detailsWords } from '@/lib/ads/details';
import { useConfirm } from '@/components/confirm';
import { useFind } from '@/components/list-search';
import { useBackCloses } from '@/components/use-back-closes';
import {
  assessFitAction,
  refetchContentAction,
  removeStatusStepAction,
  setApplicationNoteAction,
  setApplicationStatusAction,
  setRentADevAction,
  setTalentPoolAction,
  unapplyAction,
} from './actions';
import { isRentADev } from '@/features/offers/rent-a-dev';
import { AdDetails } from './ad-details';
import { AdText } from './ad-text';
import { useFitCheck } from './application-fit';
import { ApplicationFooter } from './application-footer';
import { JobSheet, JobSheetBody, JobSheetHeader } from './job-sheet';
import { moveDraft, writeDraft } from './note-drafts';
import { LazyApplicationForm, loadApplicationForm } from './lazy-application-form';
import { NoteEditor, type NoteHandle } from './note-editor';
import { StatusEditor } from './status-editor';
import { applicationKey, loadApplication, useApplication, type Shown } from './use-application';
import { useDay } from './use-day';

// One application: status, timeline, note, saved ad. Opens with what the list already has (title,
// status, details, note) and keeps one height: only the ad text loads, into its own box, and
// everything between the title and the buttons scrolls inside the window. "Edit" shows the "Add
// application" form in its place.
// The same window as an offer's (JobSheet): not modal, the list beside it stays in use, and a click on
// another application shows that one here (the list asks leave() first); a click anywhere else closes it.

export type SheetHandle = {
  /** Before another application is shown: its note as it is now (saved on the way), or null if you'd rather stay (editing). */
  leave: () => Promise<{ note: string | null | undefined; jobId: string } | null>;
};

export function ApplicationSheet({
  ref,
  initial,
  labels,
  switched = false,
  onClose,
  onNoteSaved,
  onNoteStale,
}: {
  ref?: Ref<SheetHandle>;
  initial: Application;
  labels: Record<string, string>;
  /** shown in place of another application's: no sliding in */
  switched?: boolean;
  onClose: (note: string | null | undefined, jobId: string) => void;
  onNoteSaved: (jobId: string, note: string | null, at: string) => void;
  onNoteStale: (jobId: string) => void;
}) {
  const [jobId, setJobId] = useState(initial.jobId); // an edit can make it another job's (see updateApplication)
  const day = useDay();
  const [editing, setEditing] = useState(false);
  useEffect(() => void loadApplicationForm(), []); // "Edit"'s form, so it's in before it's wanted
  const [open, setOpen] = useState(true);
  const confirm = useConfirm();
  const note = useRef<NoteHandle>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // back from the form to the window: focus where you left it (the form, now gone, had it)
  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const closedWith = useRef<string | null | undefined>(undefined); // the note as the window closed
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const loaded = useApplication(jobId, { acting: busy });
  const app: Shown = loaded.data ?? initial;
  const fit = useFitCheck(applicationKey(jobId), () => assessFitAction({ jobId }), setActionError);
  const gone = useRef(false); // unmarked: there's no note to save any more
  const { find, findMore } = useFind(
    [app.title, app.company, app.note],
    // the ad text loads into the window
    app.content === undefined ? undefined : [detailsWords(app.details), app.content],
  );

  // shown at once; a load already on its way would bring the old state back, so it's dropped
  const show = (next: Shown, id = jobId) => {
    void queryClient.cancelQueries({ queryKey: applicationKey(id) });
    queryClient.setQueryData(applicationKey(id), next);
  };

  const act = (fn: () => Promise<unknown>) =>
    start(async () => {
      setActionError(null);
      try {
        await fn();
      } catch (error) {
        setActionError(message(error));
      }
    });
  // after an action: the application as the database has it now
  const reload = async () => {
    await queryClient.cancelQueries({ queryKey: applicationKey(jobId) });
    await loaded.refetch();
  };

  const setStatus = (stage: StageId, outcome: OutcomeId) => {
    if (stage === app.stage && outcome === app.outcome) return;
    show({
      ...app,
      stage,
      outcome,
      history: withStatus(app.history, stage, outcome, new Date().toISOString()),
    });
    act(async () => {
      unwrap(await setApplicationStatusAction({ jobId, stage, outcome }));
      await reload();
    });
  };

  // your own call on it, shown at once; the next fit check makes its own
  const setRentADev = (rentADev: boolean) => {
    show({ ...app, bodyLeasing: rentADev });
    act(async () => {
      unwrap(await setRentADevAction({ jobId, rentADev }));
      await reload();
    });
  };

  const setTalentPool = (talentPool: boolean) => {
    show({ ...app, talentPool });
    act(async () => {
      unwrap(await setTalentPoolAction({ jobId, talentPool }));
      await reload();
    });
  };

  // a step clicked by mistake: out of the history with every step after it, the status goes back
  // to the step before
  const removeStep = async (i: number) => {
    const all = app.history;
    const step = all[i];
    const later = all.length - 1 - i;
    if (
      later > 0 &&
      !(await confirm({
        title: `Remove “${stageOf(step.stage).label} · ${outcomeLabel(step.stage, step.state)}” of ${day(step.at)}?`,
        description: `${later === 1 ? 'The step after it goes' : `The ${later} steps after it go`} too, and the status goes back to the step before.`,
        action: 'Remove',
        destructive: true,
      }))
    )
      return;
    const history = all.slice(0, i);
    const last = history.at(-1);
    show({ ...app, history, stage: last?.stage ?? 'submitted', outcome: last?.state ?? 'pending' }); // instant
    act(async () => {
      unwrap(await removeStatusStepAction({ jobId, step }));
      await reload();
    });
  };

  // saved in the form: back to the window with it (under its new job, if it's another job's now)
  const saved = (fresh: ApplicationWithContent) => {
    const moved = fresh.jobId !== jobId;
    if (moved) {
      moveDraft(jobId, fresh.jobId);
      setJobId(fresh.jobId);
    }
    // the AI's verdict is the job's: the same job keeps it, another one loads its own
    show(moved ? fresh : { ...fresh, fit: app.fit }, fresh.jobId);
    setEditing(false);
    // the ad text is fetched again (the link changed): look for it now, then every 3 s
    if (moved || fresh.contentStatus === 'pending')
      void queryClient.refetchQueries({ queryKey: applicationKey(fresh.jobId), type: 'all' });
  };

  // Escape, a click outside, the X and Close all end here; the note's last words are saved on the way
  // out, and the list hears of them once the window has gone (onCloseAutoFocus)
  const close = () => {
    closedWith.current = gone.current ? undefined : note.current?.flush();
    setOpen(false);
  };
  // as Escape: editing, back to the window
  useBackCloses(open, 'application', () => {
    if (editing) {
      stopEditing();
      return false;
    }
    close();
  });

  useImperativeHandle(ref, () => ({
    leave: async () => {
      if (
        editing &&
        !(await confirm({
          title: 'Leave the edit?',
          description: 'What you changed in the form isn’t saved.',
          action: 'Leave',
          destructive: true,
        }))
      )
        return null;
      return { note: gone.current ? undefined : note.current?.flush(), jobId };
    },
  }));
  const unmark = async () => {
    const yes = await confirm({
      title: 'Unmark as applied?',
      description: 'Its saved ad text, status history and note are deleted too.',
      action: 'Unmark',
      destructive: true,
    });
    if (!yes) return;
    act(async () => {
      unwrap(await unapplyAction({ jobId }));
      gone.current = true;
      note.current?.discard();
      writeDraft(jobId, null);
      close();
    });
  };
  const board = labels[app.src] ?? app.src;

  return (
    <JobSheet
      open={open}
      onDismiss={close}
      onGone={() => onClose(closedWith.current, jobId)}
      // editing: a click outside does nothing (the form would be lost); a click in the list picks
      // another application (the list switches the window)
      keepOpen={(target) => editing || Boolean(target?.closest('[data-application-list]'))}
      // editing: Esc goes back to the window
      onEscapeKeyDown={(event) => {
        if (!editing) return;
        event.preventDefault();
        stopEditing();
      }}
      switched={switched}
      showCloseButton={!editing}
    >
      {editing && <LazyApplicationForm app={app as ApplicationWithContent} onCancel={stopEditing} onSaved={saved} />}
      {/* hidden, not gone, while editing: the note keeps what you typed */}
      <div className={cn('flex min-h-0 flex-1 flex-col', editing && 'hidden')}>
        <JobSheetHeader
          title={app.title}
          company={app.company}
          board={board}
          when={`applied ${day(app.appliedAt)}`}
          fit={app}
          checking={fit.checking}
          onCheck={fit.check}
          // the form has the window's title while it's open
          plain={editing}
          find={find}
        />

        <JobSheetBody>
          <StatusEditor
            app={app}
            busy={busy}
            rentADev={isRentADev(app) === true}
            onStatus={setStatus}
            onRentADev={setRentADev}
            onTalentPool={setTalentPool}
            onRemoveStep={(i) => void removeStep(i)}
          />
          <NoteEditor
            ref={note}
            jobId={jobId}
            store={{
              save: (text, seenAt) => setApplicationNoteAction({ jobId, note: text, seenAt }),
              load: () => loadApplication(jobId),
            }}
            initial={initial.note ?? ''}
            seenAt={initial.noteUpdatedAt}
            editedAt={app.noteUpdatedAt}
            onSaved={(text, at) => onNoteSaved(jobId, text, at)}
            onStale={() => onNoteStale(jobId)}
            find={find}
          />
          <AdDetails details={app.details} find={findMore} />
          <AdText ad={app} loadError={loaded.error ? message(loaded.error) : null} find={findMore} />
        </JobSheetBody>

        <ApplicationFooter
          app={app}
          board={board}
          busy={busy}
          error={actionError}
          editButton={editButton}
          onUnmark={() => void unmark()}
          onEdit={() => setEditing(true)}
          onFetchAgain={() => {
            show({ ...app, content: undefined }); // back to the placeholder while it fetches
            act(async () => {
              unwrap(await refetchContentAction({ jobId }));
              await reload();
            });
          }}
          onClose={close}
        />
      </div>
    </JobSheet>
  );
}
