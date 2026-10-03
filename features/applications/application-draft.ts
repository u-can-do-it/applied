import type { ApplicationWithContent } from '@/lib/applications';
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
  remote: false,
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
  remote: Boolean(application.details?.remote),
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
  put('content', filled.content);
  if (!touched.has('remote') && (!editing || !next.remote)) next.remote = filled.remote;
  return next;
}
