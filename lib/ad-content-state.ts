import type { ApplicationRow } from './db/schema';

// An application's saved ad text (applications.content, content_status, content_error,
// scraped_at) as a state machine. The services in lib/applications.ts turn what happened into an
// event, ask `transition` for the next state and save it if it changed; `fetchDue` says when the
// text is then to be fetched from the link in the background (saveContent).
//
//   none ──added (≥ 80 chars typed)──────────────→ ok
//   none ──added (less, with a link) / marked────→ pending ──fetchSucceeded──→ ok
//   none ──added (less, no link)─────────────────→ empty                ├─fetchFoundNoText──→ empty
//                                                                       └─fetchFailed───────→ failed
//   any  ──edited──→ ok / pending / empty, or unchanged (see `edited`)
//   any  ──fetch*──→ ok / empty / failed ("Fetch again" fetches from whatever state it is in)
//
// Outside `ok`, the text is always what you typed (a fetch saves text only with `ok`), so a fetch
// that fails or finds no ad keeps it.

export type ContentStatus = ApplicationRow['contentStatus'];

/** What an application has saved of its ad. */
export type AdContent = {
  status: ContentStatus;
  text: string | null;
  error: string | null;
  /** when the text was saved (fetched or typed); kept as it was by the transitions that don't save one */
  scrapedAt: string | null;
};

/** `none`: no application yet. */
export type ContentState = { status: 'none' } | AdContent;

export type ContentEvent =
  /** "+ Add application": `text` as typed (trimmed, '' = none) */
  | { type: 'added'; text: string; hasLink: boolean; at: string }
  /** "Mark applied" on a scraped offer: the ad is fetched right away */
  | { type: 'marked' }
  /** "Edit" saved: `text` as typed (trimmed), `hasLink`: the link after the edit */
  | { type: 'edited'; text: string; hasLink: boolean; at: string }
  | { type: 'fetchSucceeded'; text: string; at: string }
  /** every offer's page answered, none with the ad text (removed or blocked) */
  | { type: 'fetchFoundNoText'; at: string }
  /** no offer's page could be fetched (`error`: the last one's reason) */
  | { type: 'fetchFailed'; error: string | null; at: string };

/** A typed text this long is the ad; shorter, it's a note-like stub and the ad is fetched from the link. */
export const FULL_AD_CHARS = 80;
export const NO_TEXT = 'Added by hand, without the ad text.';
export const NO_AD_TEXT = 'The board page has no ad text (removed or blocked?).';
export const NO_LINK = 'No link to fetch the ad from.';

export const NONE: ContentState = { status: 'none' };

/** Typed text without a full ad: fetched if there's a link, else kept as it is, marked "no ad text". */
const typed = (text: string | null, hasLink: boolean, scrapedAt: string | null): AdContent =>
  hasLink ? { status: 'pending', text, error: null, scrapedAt } : { status: 'empty', text, error: NO_TEXT, scrapedAt };

/** The next state, and whether it differs from the one before (unchanged: nothing to save). */
export type Transition = { state: ContentState; changed: boolean };

/** An event that can't happen in the state (an edit of an application that isn't there) throws. */
export function transition(state: ContentState, event: ContentEvent): Transition {
  const next = nextState(state, event);
  return next ? { state: next, changed: true } : { state, changed: false };
}

/** null: the event leaves the state as it is. */
function nextState(state: ContentState, event: ContentEvent): ContentState | null {
  switch (event.type) {
    case 'added': {
      if (state.status !== 'none') throw invalid(state, event);
      if (event.text.length >= FULL_AD_CHARS)
        return { status: 'ok', text: event.text, error: null, scrapedAt: event.at };
      return typed(event.text || null, event.hasLink, event.text ? event.at : null);
    }
    case 'marked': {
      if (state.status !== 'none') throw invalid(state, event);
      return { status: 'pending', text: null, error: null, scrapedAt: null };
    }
    case 'edited': {
      if (state.status === 'none') throw invalid(state, event);
      const had = (state.text ?? '').trim();
      if (!event.text) {
        // left empty: fetched from the link (like adding one); without a link the old text goes
        if (event.hasLink) return { ...state, status: 'pending', text: null, error: null };
        if (had) return { ...state, status: 'empty', text: null, error: NO_TEXT };
        return null;
      }
      if (event.text === had) return null; // the text as it was: whatever its state, it stays
      if (event.text.length >= FULL_AD_CHARS)
        return { status: 'ok', text: event.text, error: null, scrapedAt: event.at };
      return typed(event.text, event.hasLink, state.scrapedAt);
    }
    case 'fetchSucceeded':
      if (state.status === 'none') throw invalid(state, event);
      return { status: 'ok', text: event.text, error: null, scrapedAt: event.at };
    case 'fetchFoundNoText':
      if (state.status === 'none') throw invalid(state, event);
      return { status: 'empty', text: typedText(state), error: NO_AD_TEXT, scrapedAt: event.at };
    case 'fetchFailed':
      if (state.status === 'none') throw invalid(state, event);
      return { status: 'failed', text: typedText(state), error: event.error, scrapedAt: event.at };
    default:
      return unreachable(event);
  }
}

/** What you typed, which a fetch without an ad keeps (an `ok` text may be a fetched ad: that one goes, as before). */
const typedText = (state: AdContent) => (state.status === 'ok' ? null : state.text);

/** The transition left the text waiting for a fetch: start one (it wasn't already asked for). */
export const fetchDue = ({ state, changed }: Transition) => changed && state.status === 'pending';

/** The state as the applications row has it. */
export function contentOf(row: {
  content: string | null;
  contentStatus: ContentStatus;
  contentError: string | null;
  scrapedAt: string | null;
}): AdContent {
  return { status: row.contentStatus, text: row.content, error: row.contentError, scrapedAt: row.scrapedAt };
}

/** The row's columns for a state. */
export function columnsOf(state: ContentState) {
  if (state.status === 'none') throw new Error('No ad content to save before the application exists.');
  return { content: state.text, contentStatus: state.status, contentError: state.error, scrapedAt: state.scrapedAt };
}

const invalid = (state: ContentState, event: ContentEvent) =>
  new Error(`Ad content: "${event.type}" can't happen in state "${state.status}".`);

const unreachable = (event: never): never => {
  throw new Error(`Ad content: unknown event ${JSON.stringify(event)}`);
};
