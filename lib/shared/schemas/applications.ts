// Shared by the server and client components.
import { z } from 'zod';
import { BOARD_RE, boardOf, isLink } from '../../boards';
import { validDay } from '../../dates';
import type { JobDetails } from '../../ads/details';
import { isOutcome, isStage, type OutcomeId, type StageId } from '../../stages';
import { DAY_ERROR, NOTE_MAX } from '../application-messages';
import { jobId, text } from './common';

export { DAY_ERROR, NOTE_CONFLICT, NOTE_MAX } from '../application-messages';

const stage = (error?: string) => z.custom<StageId>(isStage, error);
const outcome = (error?: string) => z.custom<OutcomeId>(isOutcome, error);

export const jobIdSchema = z.object({ jobId });

/** "Mark applied" on an offer: the job, and the offer that was clicked (its board and id). */
export const applySchema = z.object({ jobId, src: z.string(), id: z.string() });

export const setStatusSchema = z.object({
  jobId,
  stage: stage('Unknown status.'),
  outcome: outcome('Unknown status.'),
});

/** One step of the history, as the window has it (as stored: the outcome is `state`). */
export const removeStepSchema = z.object({
  jobId,
  step: z.object({ stage: stage(), state: outcome(), at: z.string() }),
});

/** seenAt: the note's note_updated_at as the window read it (null: never written), so a change made elsewhere since isn't overwritten */
export const setNoteSchema = z.object({
  jobId,
  note: z.string(),
  // as the database gives it: "2026-10-03T12:34:56.123456+00:00"
  seenAt: z.iso.datetime({ offset: true }).nullable(),
});

const LINK_NEEDED = 'Paste a link that starts with https://';
export const fillFromLinkSchema = z.object({ link: z.string({ error: LINK_NEEDED }).refine(isLink, LINK_NEEDED) });

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
    outcome: outcome('Unknown status.'),
    note: text(NOTE_MAX),
  })
  .transform((form) => ({
    ...toApplication(form),
    stage: form.stage,
    outcome: form.outcome,
    note: form.note || null,
  }));

/** What "Add application" sends, every field filled in (day: YYYY-MM-DD in the app's time zone); "Edit" sends the same without the status and the note. */
export type ApplicationInput = Required<z.input<typeof addApplicationSchema>>;

export const updateApplicationSchema = z.object({ jobId, input: fields.transform(toApplication) });
