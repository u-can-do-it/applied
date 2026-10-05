import 'server-only';
import { columnsOf, contentOf, fetchDue, NO_LINK, NONE, transition, type ContentEvent } from './ad-content-state';
import { boardIdOf, boardOf, cleanLink, offerIdOf } from './boards';
import type { Zone } from './dates';
import * as applicationsRepo from './db/repos/applications';
import * as linksRepo from './db/repos/job-links';
import * as offersRepo from './db/repos/offers';
import type { NewApplicationRow } from './db/schema';
import { scrapeOfferFull } from './ads';
import type { JobDetails } from './ads/details';
import {
  editedDetails,
  hasAny,
  mergeDetails,
  ownId,
  typedDetails,
  typedFields,
  withTextDetails,
} from './application-details';
import { message } from './shared/errors';
import { NOTE_CONFLICT, NOTE_MAX } from './shared/schemas/applications';
import { GHOST_AFTER_DAYS, type HistoryEntry, type OutcomeId, type StageId } from './stages';

// Jobs you applied to: the rules (which offer is kept, when the applied date may move, how the job
// changes on an edit, what a scrape may overwrite). The queries are in lib/db/repos/applications.ts.
// Marking one keeps a snapshot (title, company, link) and, in the background, the complete ad
// text, so it stays readable after the board takes the ad down.

export type Application = applicationsRepo.Application;
export type ApplicationWithContent = applicationsRepo.ApplicationWithContent;
export {
  editedDetails,
  mergeDetails,
  readDetailsFromText,
  TYPED_FIELDS,
  typedDetails,
  typedFields,
  withTextDetails,
  type SavedDetails,
  type TypedField,
} from './application-details';

export const listApplications = () => applicationsRepo.list();
export const getApplication = (jobId: string) => applicationsRepo.get(jobId);

/** The job as the list shows it: its id, title, company and every board's offer. */
const findJob = (jobId: string) => offersRepo.jobById(jobId);

/**
 * Marks the job applied (keeping the first date if it already was), with the clicked offer's link.
 * The ad text is then to be fetched (saveContent).
 */
export async function markApplied(jobId: string, clicked: { src: string; id: string }) {
  const job = await findJob(jobId);
  if (!job) throw new Error('That offer is no longer in the database.');
  const offer = job.offers.find(({ src, id }) => src === clicked.src && id === clicked.id) ?? job.offers[0];
  await applicationsRepo.insertUnlessThere({
    jobId,
    src: offer.src,
    id: offer.id,
    title: job.title,
    company: job.company,
    url: offer.url,
    ...columnsOf(transition(NONE, { type: 'marked' }).state),
    stage: 'submitted',
    outcome: 'pending',
    history: [{ stage: 'submitted', state: 'pending', at: new Date().toISOString() }],
  });
}

/** Open applications without news for a month become ghosted. Returns how many just did. */
export const ghostStale = (): Promise<number> => applicationsRepo.ghostStale(GHOST_AFTER_DAYS);

/** Moves the application to a stage / outcome; the change is added to its history. */
export const setStatus = (jobId: string, stage: StageId, outcome: OutcomeId) =>
  applicationsRepo.setStatus(jobId, stage, outcome);

/**
 * Takes a step out of the status history together with every step after it (a mistaken click
 * and what followed it); the status becomes the last step left. The first one, applying, stays.
 * "Reached" stages come from the history, so the check mark goes with them.
 */
export async function removeStatusStep(jobId: string, step: HistoryEntry): Promise<{ error?: string }> {
  const app = await getApplication(jobId);
  if (!app) return { error: 'This application no longer exists.' };
  const all = app.history;
  let i = all.findIndex((entry) => entry.at === step.at && entry.stage === step.stage && entry.state === step.state);
  // a step clicked a moment ago carries the browser's time, not the database's: the latest one like it
  if (i < 0) i = all.map((entry) => `${entry.stage}/${entry.state}`).lastIndexOf(`${step.stage}/${step.state}`);
  if (i < 0) return { error: 'That step is no longer in the history.' };
  if (i === 0) return { error: 'The first step is the application itself (“Unmark applied” removes that).' };
  const history = all.slice(0, i);
  const last = history.at(-1);
  // counts as a change now: taking back an automatic "ghosted" doesn't bring it right back
  await applicationsRepo.patch(jobId, {
    history,
    stage: last?.stage ?? 'submitted',
    outcome: last?.state ?? 'pending',
    stageUpdatedAt: new Date().toISOString(),
  });
  return {};
}

/**
 * Saves your note for the application ('' clears it), if nobody else changed it since you read it:
 * `seenAt` is the note_updated_at you saw. Answers with the new one, for the next save.
 */
export async function setNote(jobId: string, note: string, seenAt: string | null): Promise<{ noteUpdatedAt: string }> {
  const text = note.trim() ? note.slice(0, NOTE_MAX) : null;
  const savedAt = await applicationsRepo.setNoteIfUnchanged(jobId, text, seenAt);
  if (savedAt) return { noteUpdatedAt: savedAt };
  if (!(await applicationsRepo.get(jobId))) throw new Error('This application no longer exists.');
  throw new Error(NOTE_CONFLICT);
}

export const unmarkApplied = (jobId: string) => applicationsRepo.remove(jobId);

const patch = (jobId: string, fields: Partial<NewApplicationRow>) => applicationsRepo.patch(jobId, fields);

/** Scrapes the complete ad: the offer that was marked first, then the job's other boards. */
export async function saveContent(jobId: string) {
  const app = await getApplication(jobId);
  if (!app) return;
  const job = await findJob(jobId).catch(() => null);
  const offers = [
    { src: app.src, id: app.id, url: app.url },
    ...(job?.offers ?? []).filter((offer) => !(offer.src === app.src && offer.id === app.id)),
  ].filter((offer) => offer.url); // one added by hand may have no link
  // what you typed (salary, location…) stays over what the board says
  const merge = (scraped: JobDetails | null | undefined) =>
    mergeDetails(scraped, app.details, typedFields(app.details, app.id));

  const save = async (event: ContentEvent, details: JobDetails | null | undefined) => {
    let merged = merge(details);
    // what the board didn't give (salary, work mode…), from the text
    if (event.type === 'fetchSucceeded') merged = await withTextDetails(merged, { ...app, content: event.text });
    await patch(jobId, { ...columnsOf(transition(contentOf(app), event).state), details: merged });
  };

  let firstEmpty: { details: JobDetails } | null = null;
  let lastError: string | null = offers.length ? null : NO_LINK;
  for (const offer of offers) {
    try {
      const scraped = await scrapeOfferFull(offer);
      if (scraped.status === 'ok') {
        await save({ type: 'fetchSucceeded', text: scraped.text, at: new Date().toISOString() }, scraped.details);
        return;
      }
      firstEmpty ??= { details: scraped.details };
    } catch (error) {
      lastError = message(error);
    }
  }
  const at = new Date().toISOString();
  await save(
    firstEmpty ? { type: 'fetchFoundNoText', at } : { type: 'fetchFailed', error: lastError, at },
    firstEmpty?.details,
  );
}

// ---- added by hand ("Add application") --------------------------------------------------

/** The scraped offer behind a link, if there is one: by the board's id, or by the same link. */
export async function findOfferByLink(link: string) {
  const board = boardOf(link);
  const id = offerIdOf(board, link);
  return offersRepo.findOffer({
    ...(id ? { src: board, id } : {}),
    urls: [cleanLink(link), link.trim()],
  });
}

/**
 * The job of this company + title: the one its title key (as the scrapers make it, or
 * `knownTitleKey`) was merged into, or its own.
 */
export async function jobIdFor(company: string | null, title: string, knownTitleKey?: string | null): Promise<string> {
  return linksRepo.jobIdOf(knownTitleKey ?? (await offersRepo.titleKeyOf(company, title)));
}

export type NewApplication = {
  url: string;
  title: string;
  company: string | null;
  src: string;
  appliedAt: string; // ISO
  stage: StageId;
  outcome: OutcomeId;
  details: JobDetails | null;
  content: string | null;
  note: string | null;
};

/** When you applied, from the day: now if it's today, else that day's noon (in the app's time zone). */
export const appliedAtOf = (day: string, zone: Zone) =>
  day === zone.day()
    ? new Date().toISOString()
    : new Date(zone.startOfDay(day).getTime() + 12 * 3600_000).toISOString();

const newId = () => `manual-${crypto.randomUUID().slice(0, 12)}`;
const alreadyThere = (app: Application, zone: Zone) =>
  `Already in your applications: “${app.title}”, applied ${zone.formatDayOf(app.appliedAt)}.`;

/**
 * Saves an application typed in by hand; an error if the job already has one. `fetch`: the ad text
 * is to be fetched from the link (saveContent), as none or only a few words were typed.
 */
export async function addApplication(
  input: NewApplication,
  zone: Zone,
): Promise<{ jobId?: string; fetch?: boolean; error?: string }> {
  const offer = input.url ? await findOfferByLink(input.url).catch(() => null) : null;
  const jobId = await jobIdFor(offer?.company ?? input.company, offer?.title ?? input.title, offer?.titleKey);
  const existing = await getApplication(jobId);
  if (existing) return { error: alreadyThere(existing, zone) };
  const id = offer?.id ?? (boardIdOf(input.src, input.url) || newId());
  const history: HistoryEntry[] = [{ stage: 'submitted', state: 'pending', at: input.appliedAt }];
  if (input.stage !== 'submitted' || input.outcome !== 'pending')
    history.push({ stage: input.stage, state: input.outcome, at: new Date().toISOString() });
  // with a link but no text, the ad is fetched right after saving (like "Mark applied")
  const content = transition(NONE, {
    type: 'added',
    text: input.content?.trim() ?? '',
    hasLink: Boolean(input.url),
    at: new Date().toISOString(),
  });
  await applicationsRepo.insert({
    jobId,
    src: offer?.src ?? input.src,
    id,
    title: input.title,
    company: input.company,
    url: offer?.url ?? input.url,
    appliedAt: input.appliedAt,
    details: hasAny(input.details) ? typedDetails(input.details) : null,
    ...columnsOf(content.state),
    stage: input.stage,
    outcome: input.outcome,
    stageUpdatedAt: history[history.length - 1].at,
    history,
    note: input.note?.trim() ? input.note.slice(0, NOTE_MAX) : null,
    noteUpdatedAt: input.note?.trim() ? new Date().toISOString() : null,
  });
  return { jobId, fetch: fetchDue(content) };
}

// ---- edited in its window ("Edit") ---------------------------------------------------------

export type ApplicationEdit = {
  url: string; // as typed ('' = none); cleaned if it's not the saved one
  title: string;
  company: string | null;
  src: string;
  day: string; // YYYY-MM-DD in the app's time zone: the day you applied
  details: JobDetails | null; // salary, contract, location, remote as typed
  content: string; // the ad text
};

/**
 * Saves what you changed in the form; the status and the note stay. The link decides which job
 * it is: one the scrapers have makes it that job's application (as adding it would); otherwise a
 * new title or company gives it the job those make, unless it's one of the scraped jobs already.
 * `fetch`: the ad text is to be fetched from the link (it was left empty).
 */
export async function updateApplication(
  jobId: string,
  edit: ApplicationEdit,
  zone: Zone,
): Promise<{ app?: ApplicationWithContent; fetch?: boolean; error?: string }> {
  const app = await getApplication(jobId);
  if (!app) return { error: 'This application no longer exists.' };
  const typedUrl = edit.url === app.url ? app.url : edit.url ? cleanLink(edit.url) : '';
  const offer = typedUrl ? await findOfferByLink(typedUrl).catch(() => null) : null;
  let target = jobId;
  if (offer) target = await jobIdFor(offer.company, offer.title, offer.titleKey);
  else if ((edit.title !== app.title || edit.company !== app.company) && !(await findJob(jobId).catch(() => null)))
    target = await jobIdFor(edit.company, edit.title);
  if (target !== jobId) {
    const other = await getApplication(target);
    if (other) return { error: alreadyThere(other, zone) };
  }

  const fields: Partial<NewApplicationRow> = { title: edit.title, company: edit.company };
  if (target !== jobId) fields.jobId = target;
  // which offer: the scraped one behind the link, else the board and the link as typed
  const url = offer?.url ?? typedUrl;
  if (offer) Object.assign(fields, { src: offer.src, id: offer.id, url });
  else {
    Object.assign(fields, { src: edit.src, url });
    if (url !== app.url || edit.src !== app.src)
      fields.id = boardIdOf(edit.src, url) || (ownId(app.id) ? app.id : newId());
  }

  // another day: the first step (applying) moves with it, and so does "no news since" if nothing changed since
  const history = [...app.history];
  if (edit.day !== zone.day(app.appliedAt)) {
    const next = history.at(1);
    if (next && edit.day > zone.day(next.at))
      return { error: `The status changed on ${zone.formatDayOf(next.at)}: you applied that day or earlier.` };
    const at = appliedAtOf(edit.day, zone);
    fields.appliedAt = at;
    if (history[0]?.stage === 'submitted' && history[0].state === 'pending') {
      history[0] = { ...history[0], at };
      fields.history = history;
    }
    if (app.stageUpdatedAt && Date.parse(app.stageUpdatedAt) === Date.parse(app.appliedAt)) fields.stageUpdatedAt = at;
  }

  fields.details = editedDetails(app.details, edit.details, app.id, url === app.url);

  // the ad text: as typed; left empty, it's fetched from the link (like adding one)
  const content = transition(contentOf(app), {
    type: 'edited',
    text: edit.content.trim(),
    hasLink: Boolean(url),
    at: new Date().toISOString(),
  });
  // unchanged: left out, so a fetch still under way isn't undone
  if (content.changed) Object.assign(fields, columnsOf(content.state));

  await patch(jobId, fields);
  return { app: (await getApplication(target)) ?? undefined, fetch: fetchDue(content) };
}
