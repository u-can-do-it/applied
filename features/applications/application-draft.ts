import type { ApplicationWithContent } from '@/lib/applications';
import { workModeOf } from '@/lib/ads/details';
import type { Zone } from '@/lib/dates';
import type { ApplicationInput } from '@/lib/shared/schemas/applications';
import type { JobDraft } from './actions';

// What the "Add application" form holds, and what "Fill in from the link" puts in it.

export type Draft = ApplicationInput; // what the form sends
export type Field = keyof Draft;

export const empty = (zone: Zone): Draft => ({
  url: '',
  title: '',
  company: '',
  board: 'unknown',
  day: zone.day(),
  stage: 'submitted',
  outcome: 'pending',
  salary: '',
  contract: '',
  location: '',
  workMode: '',
  officeDays: '',
  content: '',
  note: '',
});

/** An applied offer as the form shows it. */
export const draftOf = (application: ApplicationWithContent, zone: Zone): Draft => ({
  url: application.url,
  title: application.title,
  company: application.company ?? '',
  board: application.src,
  day: zone.day(application.appliedAt),
  stage: application.stage,
  outcome: application.outcome,
  salary: application.details?.salary ?? '',
  contract: application.details?.contract ?? '',
  location: application.details?.location ?? '',
  workMode: workModeOf(application.details) ?? '',
  officeDays: application.details?.officeDays ?? '',
  content: application.content ?? '',
  note: '',
});

/** What the page said, put into the form: what you typed stays; when editing, so does everything already filled in. */
export function withFilled(current: Draft, filled: JobDraft, touched: ReadonlySet<Field>, editing: boolean): Draft {
  const next = { ...current };
  const free = (field: Field) =>
    !touched.has(field) && (!editing || next[field] === '' || (field === 'board' && next[field] === 'unknown'));
  const put = <K extends Field>(field: K, value: Draft[K]) => {
    if (free(field) && value !== '') next[field] = value;
  };
  put('url', filled.url);
  put('board', filled.board);
  put('title', filled.title);
  put('company', filled.company);
  put('location', filled.location);
  put('salary', filled.salary);
  put('contract', filled.contract);
  put('workMode', filled.workMode);
  put('officeDays', filled.officeDays);
  put('content', filled.content);
  return next;
}
