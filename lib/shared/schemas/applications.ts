// Shared by the server and client components.
import { z } from 'zod';
import { BOARD_RE, boardOf, isLink } from '../../boards';
import { validDay } from '../../dates';
import type { JobDetails } from '../../scrape';
import { isStage, isState, type StageId, type StateId } from '../../stages';
import { jobKey, text } from './common';

export const NOTE_MAX = 10_000;

const stage = (error?: string) => z.custom<StageId>(isStage, error);
const state = (error?: string) => z.custom<StateId>(isState, error);

export const keySchema = z.object({ key: jobKey });

/** "Mark applied" on an offer: the job, and the board's copy that was clicked. */
export const applySchema = z.object({ key: jobKey, src: z.string(), id: z.string() });

export const setStatusSchema = z.object({
  key: jobKey,
  stage: stage('Unknown status.'),
  state: state('Unknown status.'),
});

/** One step of the history, as the window has it. */
export const removeStepSchema = z.object({
  key: jobKey,
  step: z.object({ stage: stage(), state: state(), at: z.string() }),
});

/** seenAt: the note's note_updated_at as the window read it (null: never written), so a change made elsewhere since isn't overwritten */
export const setNoteSchema = z.object({
  key: jobKey,
  note: z.string(),
  // as the database gives it: "2026-10-03T12:34:56.123456+00:00"
  seenAt: z.iso.datetime({ offset: true }).nullable(),
});

/** Why a note wasn't saved: it was changed elsewhere since the window read it. */
export const NOTE_CONFLICT =
  'This note was changed in another tab or window since you opened it, so your text wasn’t saved. It’s kept here and in this browser.';

const LINK_NEEDED = 'Paste a link that starts with https://';
export const fillFromLinkSchema = z.object({ link: z.string({ error: LINK_NEEDED }).refine(isLink, LINK_NEEDED) });

export const DAY_ERROR = 'Pick the day you applied (not in the future).';

// in the order the form is checked: the first problem is the one shown
const fields = z.object({
  title: text(200).refine(Boolean, 'The title is needed.'),
  url: text(2000).refine((url) => !url || isLink(url), 'The link must start with https://'),
  board: text(30)
    .transform((board) => board.toLowerCase())
    .refine((board) => !board || BOARD_RE.test(board), 'Board: lowercase letters, digits, - or _ (e.g. "linkedin").'),
  // "not in the future" needs the app's time zone: the action checks that
  day: text(10).transform(validDay).refine(Boolean, DAY_ERROR),
  company: text(200),
  salary: text(200),
  contract: text(100),
  location: text(200),
  remote: z.boolean().default(false),
  content: z
    .string()
    .default('')
    .transform((content) => content.slice(0, 200_000)),
});

/** The form's fields as saved, the same for adding and editing. */
function toApplication({ salary, contract, location, remote, ...form }: z.output<typeof fields>) {
  const details: JobDetails = {};
  if (salary) details.salary = salary;
  if (contract) details.contract = contract;
  if (location) details.location = location;
  if (remote) details.remote = true;
  return {
    title: form.title,
    url: form.url,
    // the board follows the link unless one was given
    board: form.board || (form.url ? boardOf(form.url) : 'unknown'),
    day: form.day,
    company: form.company || null,
    details: Object.keys(details).length ? details : null,
    content: form.content,
  };
}

export const addApplicationSchema = fields
  .extend({
    stage: stage('Unknown status.'),
    state: state('Unknown status.'),
    note: text(NOTE_MAX),
  })
  .transform((form) => ({
    ...toApplication(form),
    stage: form.stage,
    state: form.state,
    note: form.note || null,
  }));

/** What "+ Add application" sends, every field filled in (day: YYYY-MM-DD in the app's time zone); "✎ Edit" sends the same without the status and the note. */
export type ApplicationInput = Required<z.input<typeof addApplicationSchema>>;

export const updateApplicationSchema = z.object({ key: jobKey, input: fields.transform(toApplication) });
