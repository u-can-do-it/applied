'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { CheckIcon } from 'lucide-react';
import { NOTE_CONFLICT } from '@/lib/shared/application-messages';
import { cn } from '@/lib/shared/cn';
import { useAutosave, type AutosaveSave, type AutosaveStatus } from '@/components/use-autosave';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { setApplicationNoteAction } from './actions';
import { noteValue, restoreNote, writeDraft, type Theirs } from './note-drafts';
import { loadApplication } from './use-application';
import { useDay } from './use-day';

// Your note: saves itself when you stop typing, leave the box or close the window (useAutosave),
// with a copy in this browser until the database has it (note-drafts.ts). A save says which version
// of the note it was written over (note_updated_at); if the note was changed elsewhere since
// (another tab), nothing is overwritten: you see both and pick.

export type NoteHandle = {
  /** saves what's left; the note (undefined: not saved, see the conflict) */
  flush: () => string | null | undefined;
  /** unmarked: there's no note to save any more */
  discard: () => void;
};

const NOTE_STATUS: Record<AutosaveStatus, string> = {
  idle: '',
  typing: '…',
  saving: 'saving…',
  saved: 'saved',
  error: 'not saved yet (kept in this browser, tries again on the next change)',
};

export function NoteEditor({
  jobId,
  initial,
  seenAt,
  editedAt,
  onSaved,
  onStale,
  ref,
}: {
  jobId: string;
  /** the note as the window opened with it, and its note_updated_at */
  initial: string;
  seenAt: string | null;
  editedAt: string | null;
  onSaved: (note: string | null, at: string) => void;
  /** the note was changed elsewhere: the list's copy of it is outdated */
  onStale: () => void;
  ref: Ref<NoteHandle>;
}) {
  const day = useDay();
  const router = useRouter();
  const [restored] = useState(() => restoreNote(jobId, initial, seenAt));
  const [text, setText] = useState(restored.text);
  const [problem, setProblem] = useState<string | null>(null); // why the last save didn't go through
  const [theirs, setTheirs] = useState<Theirs | null>(restored.theirs);
  const savedAt = useRef(seenAt); // the stored note's note_updated_at, sent with the next save
  const conflict = useRef(Boolean(restored.theirs)); // no saving until you pick a version

  // after a failed save: if the note isn't the one this was written over any more, show the other one
  const lookAgain = async (value: string, base: string, latest: () => string) => {
    const fresh = await loadApplication(jobId).catch(() => null);
    if (!fresh || fresh.noteUpdatedAt === savedAt.current) return;
    conflict.current = true;
    setTheirs({ note: fresh.note ?? '', at: fresh.noteUpdatedAt });
    writeDraft(jobId, { text: latest() || value, base });
    onStale();
    router.refresh(); // the list shows the note as it is now
  };

  const save: AutosaveSave<string> = async (value, { base, latest }) => {
    const res = await setApplicationNoteAction({ jobId, note: value, seenAt: savedAt.current });
    if (!res.ok) {
      setProblem(res.error);
      await lookAgain(value, base, latest); // before the next save goes: it mustn't go over theirs
      return false;
    }
    savedAt.current = res.data.noteUpdatedAt;
    setProblem(null);
    onSaved(noteValue(value), res.data.noteUpdatedAt);
    const now = latest();
    writeDraft(jobId, now === value ? null : { text: now, base: value });
    return true;
  };
  const autosave = useAutosave(text, save, { delay: 700, saved: initial, blocked: () => conflict.current });
  const status = autosave.status;

  useImperativeHandle(ref, () => ({
    flush: () => {
      if (conflict.current) return undefined; // the list keeps the database's note
      void autosave.flush();
      return noteValue(text);
    },
    discard: autosave.cancel,
  }));

  // the version you pick becomes the one the database has; "mine" is then saved over "theirs"
  const pick = (mine: boolean) => {
    if (!theirs) return;
    conflict.current = false;
    savedAt.current = theirs.at;
    setTheirs(null);
    setProblem(null);
    if (mine && text === theirs.note) {
      // the same text: nothing to save over it, what's there is stored
      autosave.reset(theirs.note, 'saved');
      writeDraft(jobId, null);
    } else if (mine) {
      autosave.reset(theirs.note);
      void autosave.flush();
    } else {
      setText(theirs.note);
      autosave.reset(theirs.note, 'idle');
      writeDraft(jobId, null);
    }
  };

  // a restored draft is saved right away; an outdated one is dropped
  const mounted = useEffectEvent(() => {
    if (conflict.current) return;
    if (text === initial) writeDraft(jobId, null);
    else void autosave.flush();
  });
  useEffect(() => {
    mounted();
  }, []);

  const shownStatus = theirs
    ? 'not saved: changed elsewhere'
    : status === 'idle' && initial && editedAt
      ? `edited ${day(editedAt)}`
      : NOTE_STATUS[status];
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
        <span>
          Note
          {shownStatus && (
            <span className={cn(status === 'error' || theirs ? 'text-warning' : undefined)} aria-live="polite">
              {' · '}
              {shownStatus}
              {!theirs && status === 'saved' && (
                <>
                  {' '}
                  <CheckIcon />
                </>
              )}
            </span>
          )}
        </span>
        <Textarea
          rows={3}
          maxLength={10_000}
          className="max-h-[40vh] min-h-[4.6em] resize-y bg-background text-sm text-foreground md:text-sm dark:bg-background"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            const stored = autosave.stored();
            writeDraft(jobId, value === stored && !conflict.current ? null : { text: value, base: stored });
          }}
          onBlur={() => void autosave.flush()}
          placeholder="Recruiter's name, the salary you asked for, what they asked in the interview, next steps…"
        />
      </label>
      {problem && !theirs && status === 'error' && (
        <p className="m-0 text-[13px] text-destructive" role="alert">
          {problem}
        </p>
      )}
      {theirs && <Conflict theirs={theirs} problem={problem} onPick={pick} />}
    </div>
  );
}

/** The note as it is now (changed elsewhere), and which one to keep. */
function Conflict({
  theirs,
  problem,
  onPick,
}: {
  theirs: Theirs;
  problem: string | null;
  onPick: (mine: boolean) => void;
}) {
  const day = useDay();
  return (
    <div className="flex flex-col gap-1.5" role="alert">
      <p className="m-0 text-[13px] text-destructive">{problem ?? NOTE_CONFLICT}</p>
      <p className="m-0 text-xs text-muted-foreground">The note now{theirs.at ? ` (edited ${day(theirs.at)})` : ''}:</p>
      <blockquote className="m-0 max-h-[30vh] overflow-auto border-l-3 bg-background px-2.5 py-2 text-[13px] whitespace-pre-wrap">
        {theirs.note.trim() || <em>empty</em>}
      </blockquote>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={() => onPick(false)}>
          Use that one
        </Button>
        <Button type="button" onClick={() => onPick(true)}>
          Keep mine (replaces it)
        </Button>
      </div>
    </div>
  );
}
