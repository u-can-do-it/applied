'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState, useTransition, type Ref } from 'react';
import type { Application, ApplicationWithContent } from '@/lib/applications';
import { stageOf, outcomeLabel, type StageId, type OutcomeId } from '@/lib/stages';
import { message } from '@/lib/shared/errors';
import { unwrap } from '@/lib/shared/result';
import { cn } from '@/lib/shared/cn';
import { useConfirm } from '@/components/confirm';
import { useReturnFocus } from '@/components/return-focus';
import { keepOpenOnToast } from '@/components/toasts';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { refetchContentAction, removeStatusStepAction, setApplicationStatusAction, unapplyAction } from './actions';
import { AdDetails } from './ad-details';
import { AdText } from './ad-text';
import { ApplicationFooter } from './application-footer';
import { moveDraft, writeDraft } from './note-drafts';
import { LazyApplicationForm, loadApplicationForm } from './lazy-application-form';
import { NoteEditor, type NoteHandle } from './note-editor';
import { StatusEditor } from './status-editor';
import { applicationKey, useApplication, type Shown } from './use-application';
import { useDay } from './use-day';

// One application: status, timeline, note, saved ad. Opens with what the list already has (title,
// status, details, note) and keeps one height: only the ad text loads, into its own box, and
// everything between the title and the buttons scrolls inside the window. "Edit" shows the "Add
// application" form in its place.
// Not modal: no backdrop, the page keeps scrolling, and the list beside it stays in use: a click on
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
  const focus = useReturnFocus();
  const note = useRef<NoteHandle>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  // back from the form to the window: focus where you left it (the form, now gone, had it)
  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const closedWith = useRef<string | null | undefined>(undefined); // the note as the window closed
  const clickedAway = useRef(false); // closed by a click elsewhere on the page: the focus stays there
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const loaded = useApplication(jobId, { acting: busy });
  const app = loaded.data ?? initial;
  const gone = useRef(false); // unmarked: there's no note to save any more

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
      history: [...app.history, { stage, state: outcome, at: new Date().toISOString() }],
    });
    act(async () => {
      unwrap(await setApplicationStatusAction({ jobId, stage, outcome }));
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
    if (fresh.jobId !== jobId) {
      moveDraft(jobId, fresh.jobId);
      setJobId(fresh.jobId);
    }
    show(fresh, fresh.jobId);
    setEditing(false);
    // the ad text is fetched again (the link changed): look for it now, then every 3 s
    if (fresh.contentStatus === 'pending')
      void queryClient.refetchQueries({ queryKey: applicationKey(fresh.jobId), type: 'all' });
  };

  // Escape, a click outside, the X and Close all end here; the note's last words are saved on the way
  // out, and the list hears of them once the window has gone (onCloseAutoFocus)
  const close = () => {
    closedWith.current = gone.current ? undefined : note.current?.flush();
    setOpen(false);
  };

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
  const subtitle = (
    <>
      {app.company && <>{app.company} · </>}
      {labels[app.src] ?? app.src} · applied {day(app.appliedAt)}
    </>
  );

  // A side panel: it reads like a page about one application, as tall as the screen, with the list
  // still in view beside it on a wide one
  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()} modal={false}>
      <SheetContent
        className={cn(
          'gap-0 shadow-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-[760px]',
          switched && 'data-open:animate-none',
        )}
        showCloseButton={!editing}
        // editing: Esc goes back to the window, and a click outside does nothing (the form would be lost)
        onEscapeKeyDown={(event) => {
          if (!editing) return;
          event.preventDefault();
          stopEditing();
        }}
        // a click in the list picks another application (the list switches the window); elsewhere, it closes
        onPointerDownOutside={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (editing || target?.closest('[data-application-list]')) event.preventDefault();
          else keepOpenOnToast(event);
          clickedAway.current = !event.defaultPrevented;
        }}
        // the focus going elsewhere (a confirmation, a toast, the list) isn't leaving
        onFocusOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          // still open: it's going because another application took its place (leave() said the rest)
          if (open) {
            event.preventDefault();
            return;
          }
          if (clickedAway.current) event.preventDefault();
          else focus.onCloseAutoFocus(event);
          onClose(closedWith.current, jobId);
        }}
      >
        {editing && <LazyApplicationForm app={app as ApplicationWithContent} onCancel={stopEditing} onSaved={saved} />}
        {/* hidden, not gone, while editing: the note keeps what you typed */}
        <div className={cn('flex min-h-0 flex-1 flex-col', editing && 'hidden')}>
          <SheetHeader className="gap-0.5 border-b px-3.5 pt-3.5 pr-12 pb-2.5 sm:px-5 sm:pt-4.5 sm:pr-12 sm:pb-3">
            {/* the form has the window's title while it's open */}
            {editing ? (
              <h2 className="m-0 text-lg font-semibold">{app.title}</h2>
            ) : (
              <SheetTitle className="text-lg font-semibold">{app.title}</SheetTitle>
            )}
            {editing ? (
              <p className="m-0 text-[13px] text-muted-foreground">{subtitle}</p>
            ) : (
              <SheetDescription className="text-[13px]">{subtitle}</SheetDescription>
            )}
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable] *:shrink-0 sm:px-5 sm:py-3.5">
            <StatusEditor app={app} busy={busy} onStatus={setStatus} onRemoveStep={(i) => void removeStep(i)} />
            <NoteEditor
              ref={note}
              jobId={jobId}
              initial={initial.note ?? ''}
              seenAt={initial.noteUpdatedAt}
              editedAt={app.noteUpdatedAt}
              onSaved={(text, at) => onNoteSaved(jobId, text, at)}
              onStale={() => onNoteStale(jobId)}
            />
            <AdDetails details={app.details} />
            <AdText app={app} loadError={loaded.error ? message(loaded.error) : null} />
          </div>

          <ApplicationFooter
            app={app}
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
      </SheetContent>
    </Sheet>
  );
}
