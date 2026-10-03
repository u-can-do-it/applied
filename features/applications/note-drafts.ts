// Until the database has a note, the text is also kept in this browser, so a dropped connection or a
// closed tab doesn't lose it: it's back (and saved) the next time you open this application.

/** base = the saved note it was written over (another one in the database = changed elsewhere) */
export type Draft = { text: string; base: string };
/** the note as it is in the database, when it isn't the one this was written over */
export type Theirs = { note: string; at: string | null };

// Drafts already sit in browsers under this name and in this shape ({ text, base }): changing either
// would lose the unsaved ones. The job id is the value it always was (offers_unique.dup_key).
const storageKey = (jobId: string) => `jobwatch:note:${jobId}`;

export function readDraft(jobId: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey(jobId)) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
}

export function writeDraft(jobId: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(storageKey(jobId), JSON.stringify(draft));
    else localStorage.removeItem(storageKey(jobId));
  } catch {
    // storage blocked: autosave still works, there's just no copy in the browser
  }
}

export function moveDraft(from: string, to: string) {
  const draft = readDraft(from);
  if (!draft) return;
  writeDraft(to, draft);
  writeDraft(from, null);
}

/**
 * The note a window opens with: an unsaved draft of it comes back; if the note was changed somewhere
 * else meanwhile, it comes back next to that version, for you to pick (it's never dropped without asking).
 */
export function restoreNote(jobId: string, initial: string, seenAt: string | null) {
  const draft = readDraft(jobId);
  if (!draft || draft.text === initial) return { text: initial, theirs: null };
  // written over the note as it is now: carry on with it (if the list's copy was outdated, the first
  // save finds that out)
  if (draft.base === initial) return { text: draft.text, theirs: null };
  // the note was changed elsewhere since: both are shown, and you pick
  return { text: draft.text, theirs: { note: initial, at: seenAt } satisfies Theirs };
}

/** as the database keeps it */
export const noteValue = (text: string) => (text.trim() ? text : null);
