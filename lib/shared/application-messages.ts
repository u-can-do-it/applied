// What the application checks say, without the schemas: client components import these, and the
// schemas (lib/shared/schemas/applications.ts) would bring all of zod into their bundle.

export const NOTE_MAX = 10_000;

/** Why a note wasn't saved: it was changed elsewhere since the window read it. */
export const NOTE_CONFLICT =
  'This note was changed in another tab or window since you opened it, so your text wasn’t saved. It’s kept here and in this browser.';

export const DAY_ERROR = 'Pick the day you applied (not in the future).';
