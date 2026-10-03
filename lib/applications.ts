import 'server-only';
import { boardIdOf, boardOf, cleanLink, offerIdOf } from './boards';
import type { Zone } from './dates';
import * as applicationsRepo from './db/repos/applications';
import * as linksRepo from './db/repos/job-links';
import * as offersRepo from './db/repos/offers';
import type { NewApplicationRow } from './db/schema';
import { scrapeOfferFull } from './ads';
import type { JobDetails } from './ads/details';
import { message } from './shared/errors';
import { NOTE_CONFLICT, NOTE_MAX } from './shared/schemas/applications';
import { GHOST_AFTER_DAYS, type HistoryEntry, type StageId, type StateId } from './stages';

// Jobs you applied to: the rules (which copy is kept, when the applied date may move, how the key
// changes on an edit, what a scrape may overwrite). The queries are in lib/db/repos/applications.ts.
// Marking one keeps a snapshot (title, company, link) and, in the background, the complete ad
// text, so it stays readable after the board takes the ad down.

export type Application = applicationsRepo.Application;
export type ApplicationWithContent = applicationsRepo.ApplicationWithContent;

export const listApplications = () => applicationsRepo.list();
export const getApplication = (key: string) => applicationsRepo.get(key);

/** The job as the list shows it: its key, title, company and every board's copy. */
const findJob = (key: string) => offersRepo.jobByKey(key);

/** Marks the job applied (keeping the first date if it already was), with the clicked copy's link. */
export async function markApplied(key: string, clicked: { src: string; id: string }) {
  const job = await findJob(key);
  if (!job) throw new Error('That offer is no longer in the database.');
  const copy = job.copies.find((c) => c.src === clicked.src && c.id === clicked.id) ?? job.copies[0];
  await applicationsRepo.insertUnlessThere({
    dupKey: key,
    src: copy.src,
    id: copy.id,
    title: job.title,
    company: job.company,
    url: copy.url,
    stage: 'submitted',
    stageState: 'pending',
    history: [{ stage: 'submitted', state: 'pending', at: new Date().toISOString() }],
  });
}

/** Open applications without news for a month become ghosted. Returns how many just did. */
export const ghostStale = (): Promise<number> => applicationsRepo.ghostStale(GHOST_AFTER_DAYS);

/** Moves the application to a stage / outcome; the change is added to its history. */
export const setStatus = (key: string, stage: StageId, state: StateId) => applicationsRepo.setStatus(key, stage, state);

/**
 * Takes a step out of the status history together with every step after it (a mistaken click
 * and what followed it); the status becomes the last step left. The first one, applying, stays.
 * "Reached" stages come from the history, so the ✓ goes with them.
 */
export async function removeStatusStep(key: string, step: HistoryEntry): Promise<{ error?: string }> {
  const app = await getApplication(key);
  if (!app) return { error: 'This application no longer exists.' };
  const all = app.history;
  let i = all.findIndex((h) => h.at === step.at && h.stage === step.stage && h.state === step.state);
  // a step clicked a moment ago carries the browser's time, not the database's: the latest one like it
  if (i < 0) i = all.map((h) => `${h.stage}/${h.state}`).lastIndexOf(`${step.stage}/${step.state}`);
  if (i < 0) return { error: 'That step is no longer in the history.' };
  if (i === 0) return { error: 'The first step is the application itself (“Unmark applied” removes that).' };
  const history = all.slice(0, i);
  const last = history.at(-1);
  // counts as a change now: taking back an automatic "ghosted" doesn't bring it right back
  await applicationsRepo.patch(key, {
    history,
    stage: last?.stage ?? 'submitted',
    stageState: last?.state ?? 'pending',
    stageUpdatedAt: new Date().toISOString(),
  });
  return {};
}

/**
 * Saves your note for the application ('' clears it), if nobody else changed it since you read it:
 * `seenAt` is the note_updated_at you saw. Answers with the new one, for the next save.
 */
export async function setNote(key: string, note: string, seenAt: string | null): Promise<{ noteUpdatedAt: string }> {
  const text = note.trim() ? note.slice(0, NOTE_MAX) : null;
  const savedAt = await applicationsRepo.setNoteIfUnchanged(key, text, seenAt);
  if (savedAt) return { noteUpdatedAt: savedAt };
  if (!(await applicationsRepo.get(key))) throw new Error('This application no longer exists.');
  throw new Error(NOTE_CONFLICT);
}

export const unmarkApplied = (key: string) => applicationsRepo.remove(key);

const patch = (key: string, fields: Partial<NewApplicationRow>) => applicationsRepo.patch(key, fields);

/** Added by hand or imported (not marked on a scraped offer): its id is ours, not a board's. */
const ownId = (id: string) => /^(manual|import)-/.test(id);

/** The details "Add application" and "✎ Edit" let you type; only these can be yours. */
export const TYPED_FIELDS = ['salary', 'contract', 'location', 'remote'] as const;
export type TypedField = (typeof TYPED_FIELDS)[number];
/** What an application keeps: the ad's details, plus which of them you typed (they stay over a new scrape). */
export type SavedDetails = JobDetails & { typed?: TypedField[] };

const isTypedField = (k: unknown): k is TypedField => TYPED_FIELDS.includes(k as TypedField);
const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && v !== false;
const hasAny = (d: JobDetails | null | undefined) => Boolean(d && Object.values(d).some(filled));
const withoutList = ({ typed: _, ...d }: SavedDetails) => d;

/** The form's details as saved: the editable fields you filled in, and their names. */
export function typedDetails(form: JobDetails | null | undefined): SavedDetails {
  const d: SavedDetails = {};
  for (const k of TYPED_FIELDS) {
    const v = form?.[k];
    if (filled(v)) Object.assign(d, { [k]: v });
  }
  const typed = TYPED_FIELDS.filter((k) => k in d);
  return typed.length ? { ...d, typed } : d;
}

/**
 * The details after "✎ Edit", over the rest of what the board said (posted, valid until…). The form
 * shows the saved values, so a field is yours only if it already was or you changed it. A new link
 * is another ad: only what you filled in, without the old one's dates and company.
 */
export function editedDetails(
  saved: SavedDetails | null,
  form: JobDetails | null | undefined,
  id: string,
  sameLink: boolean,
): SavedDetails | null {
  if (!sameLink) {
    const d = typedDetails(form);
    return hasAny(d) ? d : null;
  }
  const was = typedFields(saved, id);
  const d: SavedDetails = withoutList(saved ?? {});
  const typed: TypedField[] = [];
  for (const k of TYPED_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- k is one of the four TYPED_FIELDS, not a dynamic key
    delete d[k];
    const v = form?.[k];
    if (!filled(v)) continue;
    Object.assign(d, { [k]: v });
    if (was.includes(k) || v !== saved?.[k]) typed.push(k);
  }
  return hasAny(d) ? { ...d, typed } : null;
}

/** Which saved fields are yours: the list; a row from before it, added by hand or imported: all it has. */
export function typedFields(saved: SavedDetails | null, id: string): TypedField[] {
  if (Array.isArray(saved?.typed)) return saved.typed.filter(isTypedField);
  return ownId(id) ? TYPED_FIELDS.filter((k) => filled(saved?.[k])) : [];
}

/**
 * The details to save after a scrape: the fields you typed stay, the rest is what the board says.
 * A scrape that says nothing keeps the details saved before, so a failed fetch never wipes them.
 */
export function mergeDetails(
  scraped: JobDetails | null | undefined,
  saved: SavedDetails | null,
  typed: TypedField[],
): SavedDetails | null {
  const old = withoutList(saved ?? {});
  const mine = Object.fromEntries(typed.filter((k) => filled(old[k])).map((k) => [k, old[k]]));
  const merged: SavedDetails = { ...(hasAny(scraped) ? scraped : old), ...mine };
  if (!hasAny(merged)) return null;
  return saved?.typed ? { ...merged, typed: saved.typed } : merged;
}

/** Scrapes the complete ad: the copy that was marked first, then the job's other boards. */
export async function saveContent(key: string) {
  const app = await getApplication(key);
  if (!app) return;
  const job = await findJob(key).catch(() => null);
  const copies = [
    { src: app.src, id: app.id, url: app.url },
    ...(job?.copies ?? []).filter((c) => !(c.src === app.src && c.id === app.id)),
  ].filter((c) => c.url); // one added by hand may have no link
  // what you typed (salary, location…) stays over what the board says
  const merge = (d: JobDetails | null | undefined) => mergeDetails(d, app.details, typedFields(app.details, app.id));

  let firstEmpty: { details: JobDetails } | null = null;
  let lastError: string | null = copies.length ? null : 'No link to fetch the ad from.';
  for (const c of copies) {
    try {
      const s = await scrapeOfferFull(c);
      if (s.status === 'ok') {
        await patch(key, {
          content: s.text,
          details: merge(s.details),
          contentStatus: 'ok',
          contentError: null,
          scrapedAt: new Date().toISOString(),
        });
        return;
      }
      firstEmpty ??= { details: s.details };
    } catch (e) {
      lastError = message(e);
    }
  }
  await patch(key, {
    content: null,
    details: merge(firstEmpty?.details),
    contentStatus: firstEmpty ? 'empty' : 'failed',
    contentError: firstEmpty ? 'The board page has no ad text (removed or blocked?).' : lastError,
    scrapedAt: new Date().toISOString(),
  });
}

// ---- added by hand ("Add application") --------------------------------------------------

/** The scraped offer behind a link, if there is one: by the board's id, or by the same link. */
export async function findOfferByLink(link: string) {
  const board = boardOf(link);
  const id = offerIdOf(board, link);
  return offersRepo.findCopy({
    ...(id ? { src: board, id } : {}),
    urls: [cleanLink(link), link.trim()],
  });
}

/** The job's key: the same company + title as the scrapers see it, or the job it was merged into. */
export async function jobKeyFor(company: string | null, title: string, known?: string | null): Promise<string> {
  return linksRepo.groupOf(known ?? (await offersRepo.dupKeyOf(company, title)));
}

export type NewApplication = {
  url: string;
  title: string;
  company: string | null;
  src: string;
  appliedAt: string; // ISO
  stage: StageId;
  state: StateId;
  details: JobDetails | null;
  content: string | null;
  note: string | null;
};

/** When you applied, from the day: now if it's today, else that day's noon (in the app's time zone). */
export const appliedAtOf = (day: string, z: Zone) =>
  day === z.day() ? new Date().toISOString() : new Date(z.startOfDay(day).getTime() + 12 * 3600_000).toISOString();

const newId = () => `manual-${crypto.randomUUID().slice(0, 12)}`;
const NO_TEXT = 'Added by hand, without the ad text.';
const alreadyThere = (a: Application, z: Zone) =>
  `Already in your applications: “${a.title}”, applied ${z.formatDayOf(a.appliedAt)}.`;

/** Saves an application typed in by hand; an error if the job already has one. */
export async function addApplication(a: NewApplication, z: Zone): Promise<{ key?: string; error?: string }> {
  const offer = a.url ? await findOfferByLink(a.url).catch(() => null) : null;
  const key = await jobKeyFor(offer?.company ?? a.company, offer?.title ?? a.title, offer?.dupKey);
  const existing = await getApplication(key);
  if (existing) return { error: alreadyThere(existing, z) };
  const id = offer?.id ?? (boardIdOf(a.src, a.url) || newId());
  const history: HistoryEntry[] = [{ stage: 'submitted', state: 'pending', at: a.appliedAt }];
  if (a.stage !== 'submitted' || a.state !== 'pending')
    history.push({ stage: a.stage, state: a.state, at: new Date().toISOString() });
  const text = a.content?.trim() ?? '';
  await applicationsRepo.insert({
    dupKey: key,
    src: offer?.src ?? a.src,
    id,
    title: a.title,
    company: a.company,
    url: offer?.url ?? a.url,
    appliedAt: a.appliedAt,
    content: text || null,
    details: hasAny(a.details) ? typedDetails(a.details) : null,
    // with a link but no text, the ad is fetched right after saving (like "Mark applied")
    contentStatus: text.length >= 80 ? 'ok' : a.url ? 'pending' : 'empty',
    contentError: text.length >= 80 || a.url ? null : NO_TEXT,
    scrapedAt: text ? new Date().toISOString() : null,
    stage: a.stage,
    stageState: a.state,
    stageUpdatedAt: history[history.length - 1].at,
    history,
    note: a.note?.trim() ? a.note.slice(0, NOTE_MAX) : null,
    noteUpdatedAt: a.note?.trim() ? new Date().toISOString() : null,
  });
  return { key };
}

// ---- edited in its window ("✎ Edit") -------------------------------------------------------

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
 * new title or company gives it the key those make, unless it's one of the scraped jobs already.
 * `fetch`: the ad text is to be fetched from the link (it was left empty).
 */
export async function updateApplication(
  key: string,
  e: ApplicationEdit,
  z: Zone,
): Promise<{ app?: ApplicationWithContent; fetch?: boolean; error?: string }> {
  const app = await getApplication(key);
  if (!app) return { error: 'This application no longer exists.' };
  const typedUrl = e.url === app.url ? app.url : e.url ? cleanLink(e.url) : '';
  const offer = typedUrl ? await findOfferByLink(typedUrl).catch(() => null) : null;
  let target = key;
  if (offer) target = await jobKeyFor(offer.company, offer.title, offer.dupKey);
  else if ((e.title !== app.title || e.company !== app.company) && !(await findJob(key).catch(() => null)))
    target = await jobKeyFor(e.company, e.title);
  if (target !== key) {
    const other = await getApplication(target);
    if (other) return { error: alreadyThere(other, z) };
  }

  const fields: Partial<NewApplicationRow> = { title: e.title, company: e.company };
  if (target !== key) fields.dupKey = target;
  // which copy: the scraped offer behind the link, else the board and the link as typed
  const url = offer?.url ?? typedUrl;
  if (offer) Object.assign(fields, { src: offer.src, id: offer.id, url });
  else {
    Object.assign(fields, { src: e.src, url });
    if (url !== app.url || e.src !== app.src) fields.id = boardIdOf(e.src, url) || (ownId(app.id) ? app.id : newId());
  }

  // another day: the first step (applying) moves with it, and so does "no news since" if nothing changed since
  const history = [...app.history];
  if (e.day !== z.day(app.appliedAt)) {
    const next = history.at(1);
    if (next && e.day > z.day(next.at))
      return { error: `The status changed on ${z.formatDayOf(next.at)}: you applied that day or earlier.` };
    const at = appliedAtOf(e.day, z);
    fields.appliedAt = at;
    if (history[0]?.stage === 'submitted' && history[0].state === 'pending') {
      history[0] = { ...history[0], at };
      fields.history = history;
    }
    if (app.stageUpdatedAt && Date.parse(app.stageUpdatedAt) === Date.parse(app.appliedAt)) fields.stageUpdatedAt = at;
  }

  fields.details = editedDetails(app.details, e.details, app.id, url === app.url);

  // the ad text: as typed; left empty, it's fetched from the link (like adding one)
  const text = e.content.trim();
  const had = (app.content ?? '').trim();
  let fetch = false;
  if (!text) {
    if (url) {
      Object.assign(fields, { content: null, contentStatus: 'pending', contentError: null });
      fetch = true;
    } else if (had) Object.assign(fields, { content: null, contentStatus: 'empty', contentError: NO_TEXT });
  } else if (text !== had) {
    if (text.length >= 80)
      Object.assign(fields, {
        content: text,
        contentStatus: 'ok',
        contentError: null,
        scrapedAt: new Date().toISOString(),
      });
    else if (url) {
      Object.assign(fields, { content: text, contentStatus: 'pending', contentError: null });
      fetch = true;
    } else Object.assign(fields, { content: text, contentStatus: 'empty', contentError: NO_TEXT });
  }

  await patch(key, fields);
  return { app: (await getApplication(target)) ?? undefined, fetch };
}
