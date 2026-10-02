import 'server-only';
import { boardIdOf, boardOf, cleanLink } from './boards';
import type { Zone } from './dates';
import { scrapeOfferFull, type JobDetails } from './scrape';
import { GHOST_AFTER_DAYS, type HistoryEntry, type StageId, type StateId } from './stages';
import { rest, restUrl } from './supabase';

// Jobs you applied to. Marking one keeps a snapshot (title, company, link) and, in the
// background, the complete ad text, so it stays readable after the board takes the ad down.

export type Application = {
  dup_key: string;
  src: string;
  id: string;
  title: string;
  company: string | null;
  url: string;
  applied_at: string;
  details: JobDetails | null;
  content_status: 'pending' | 'ok' | 'empty' | 'failed';
  content_error: string | null;
  scraped_at: string | null;
  stage: StageId;
  stage_state: StateId;
  stage_updated_at: string | null;
  history: HistoryEntry[];
  note: string | null;
  note_updated_at: string | null;
};
export type ApplicationWithContent = Application & { content: string | null };

const LIST_COLS = 'dup_key,src,id,title,company,url,applied_at,details,content_status,content_error,scraped_at,stage,stage_state,stage_updated_at,history,note,note_updated_at';
const keyFilter = (url: URL, key: string) => url.searchParams.set('dup_key', `eq.${key}`);

export async function listApplications(): Promise<Application[]> {
  const url = restUrl('applications');
  url.searchParams.set('select', LIST_COLS);
  url.searchParams.set('order', 'applied_at.desc');
  return (await rest(url)).json();
}

export async function getApplication(key: string): Promise<ApplicationWithContent | null> {
  const url = restUrl('applications');
  url.searchParams.set('select', `${LIST_COLS},content`);
  keyFilter(url, key);
  return ((await (await rest(url)).json()) as ApplicationWithContent[])[0] ?? null;
}

type Copy = { src: string; id: string; url: string };

/** The job as the list shows it: its key, title, company and every board's copy. */
async function findJob(key: string): Promise<{ title: string; company: string | null; copies: Copy[] } | null> {
  const url = restUrl('offers_unique');
  url.searchParams.set('select', 'title,company,copies');
  keyFilter(url, key);
  return ((await (await rest(url)).json()) as { title: string; company: string | null; copies: Copy[] }[])[0] ?? null;
}

/** Marks the job applied (keeping the first date if it already was), with the clicked copy's link. */
export async function markApplied(key: string, clicked: { src: string; id: string }) {
  const job = await findJob(key);
  if (!job) throw new Error('That offer is no longer in the database.');
  const copy = job.copies.find((c) => c.src === clicked.src && c.id === clicked.id) ?? job.copies[0];
  const url = restUrl('applications');
  url.searchParams.set('on_conflict', 'dup_key');
  await rest(url, {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=minimal',
    body: JSON.stringify({
      dup_key: key, src: copy.src, id: copy.id, title: job.title, company: job.company, url: copy.url,
      stage: 'submitted', stage_state: 'pending',
      history: [{ stage: 'submitted', state: 'pending', at: new Date().toISOString() }],
    }),
  });
}

/** Open applications without news for a month become ghosted. Returns how many just did. */
export async function ghostStale(): Promise<number> {
  const res = await rest(restUrl('rpc/jw_ghost_stale_applications'), { method: 'POST', body: JSON.stringify({ p_days: GHOST_AFTER_DAYS }) });
  return Number(await res.json()) || 0;
}

/** Moves the application to a stage / outcome; the change is added to its history. */
export async function setStatus(key: string, stage: StageId, state: StateId) {
  await rest(restUrl('rpc/jw_set_application_status'), {
    method: 'POST',
    body: JSON.stringify({ p_key: key, p_stage: stage, p_state: state }),
  });
}

/**
 * Takes a step out of the status history together with every step after it (a mistaken click
 * and what followed it); the status becomes the last step left. The first one, applying, stays.
 * "Reached" stages come from the history, so the ✓ goes with them.
 */
export async function removeStatusStep(key: string, step: HistoryEntry): Promise<{ error?: string }> {
  const app = await getApplication(key);
  if (!app) return { error: 'This application no longer exists.' };
  const all = app.history ?? [];
  let i = all.findIndex((h) => h.at === step.at && h.stage === step.stage && h.state === step.state);
  // a step clicked a moment ago carries the browser's time, not the database's: the latest one like it
  if (i < 0) i = all.map((h) => `${h.stage}/${h.state}`).lastIndexOf(`${step.stage}/${step.state}`);
  if (i < 0) return { error: 'That step is no longer in the history.' };
  if (i === 0) return { error: 'The first step is the application itself (“Unmark applied” removes that).' };
  const history = all.slice(0, i);
  const last = history[history.length - 1];
  // counts as a change now: taking back an automatic "ghosted" doesn't bring it right back
  await patch(key, { history, stage: last?.stage ?? 'submitted', stage_state: last?.state ?? 'pending', stage_updated_at: new Date().toISOString() });
  return {};
}

export const NOTE_MAX = 10_000;

/** Saves your note for the application ('' clears it). */
export async function setNote(key: string, note: string) {
  const url = restUrl('applications');
  keyFilter(url, key);
  const text = note.trim() ? note.slice(0, NOTE_MAX) : null;
  await rest(url, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ note: text, note_updated_at: new Date().toISOString() }) });
}

export async function unmarkApplied(key: string) {
  const url = restUrl('applications');
  keyFilter(url, key);
  await rest(url, { method: 'DELETE', prefer: 'return=minimal' });
}

async function patch(key: string, fields: Partial<ApplicationWithContent>) {
  const url = restUrl('applications');
  keyFilter(url, key);
  await rest(url, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(fields) });
}

/** Added by hand or imported (not marked on a scraped offer): its id is ours, not a board's. */
const ownId = (id: string) => /^(manual|import)-/.test(id);

/**
 * Scrapes the complete ad: the copy that was marked first, then the job's other boards.
 * `typed`: details you just typed in, which stay over what the board says.
 */
export async function saveContent(key: string, opts: { typed?: JobDetails | null } = {}) {
  const app = await getApplication(key);
  if (!app) return;
  const job = await findJob(key).catch(() => null);
  const copies = [
    { src: app.src, id: app.id, url: app.url },
    ...(job?.copies ?? []).filter((c) => !(c.src === app.src && c.id === app.id)),
  ].filter((c) => c.url); // one added by hand may have no link
  // added by hand or imported: what you typed (salary, location…) stays over what the board says
  const typed = { ...(ownId(app.id) ? (app.details ?? {}) : {}), ...(opts.typed ?? {}) };
  const merge = (d: JobDetails | null | undefined) => (d || Object.keys(typed).length ? { ...(d ?? {}), ...typed } : null);

  let firstEmpty: { details: JobDetails } | null = null;
  let lastError: string | null = copies.length ? null : 'No link to fetch the ad from.';
  for (const c of copies) {
    try {
      const s = await scrapeOfferFull(c);
      if (s.status === 'ok') {
        await patch(key, { content: s.text, details: merge(s.details), content_status: 'ok', content_error: null, scraped_at: new Date().toISOString() });
        return;
      }
      firstEmpty ??= { details: s.details };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  await patch(key, {
    content: null,
    details: merge(firstEmpty?.details),
    content_status: firstEmpty ? 'empty' : 'failed',
    content_error: firstEmpty ? 'The board page has no ad text (removed or blocked?).' : lastError,
    scraped_at: new Date().toISOString(),
  });
}

// ---- added by hand ("Add application") --------------------------------------------------

type OfferRow = { src: string; id: string; title: string; company: string | null; url: string; dup_key: string };

/** The scraped offer behind a link, if there is one: by the board's id, or by the same link. */
export async function findOfferByLink(link: string): Promise<OfferRow | null> {
  const board = boardOf(link);
  const id = boardIdOf(board, link);
  const url = restUrl('offers');
  url.searchParams.set('select', 'src,id,title,company,url,dup_key');
  const clean = cleanLink(link);
  const q = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`;
  // NoFluff stores its posting id, not the link's slug: by link only
  const byId = id && board !== 'nofluff' ? `and(src.eq.${q(board)},id.eq.${q(id)}),` : '';
  url.searchParams.set('or', `(${byId}url.eq.${q(clean)},url.eq.${q(link.trim())})`);
  url.searchParams.set('limit', '1');
  return ((await (await rest(url)).json()) as OfferRow[])[0] ?? null;
}

/** The job's key: the same company + title as the scrapers see it, or the job it was merged into. */
export async function jobKeyFor(company: string | null, title: string, known?: string): Promise<string> {
  const key = known ?? ((await (await rest(restUrl('rpc/jw_dup_key'), { method: 'POST', body: JSON.stringify({ company, title }) })).json()) as string);
  const url = restUrl('job_links');
  url.searchParams.set('select', 'job_key');
  url.searchParams.set('dup_key', `eq.${key}`);
  return ((await (await rest(url)).json()) as { job_key: string }[])[0]?.job_key ?? key;
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
const alreadyThere = (a: Application, z: Zone) => `Already in your applications: “${a.title}”, applied ${z.formatDayOf(a.applied_at)}.`;

/** Saves an application typed in by hand; an error if the job already has one. */
export async function addApplication(a: NewApplication, z: Zone): Promise<{ key?: string; error?: string }> {
  const offer = a.url ? await findOfferByLink(a.url).catch(() => null) : null;
  const key = await jobKeyFor(offer?.company ?? a.company, offer?.title ?? a.title, offer?.dup_key);
  const existing = await getApplication(key);
  if (existing) return { error: alreadyThere(existing, z) };
  const id = offer?.id ?? (boardIdOf(a.src, a.url) || newId());
  const history: HistoryEntry[] = [{ stage: 'submitted', state: 'pending', at: a.appliedAt }];
  if (a.stage !== 'submitted' || a.state !== 'pending') history.push({ stage: a.stage, state: a.state, at: new Date().toISOString() });
  const text = a.content?.trim() ?? '';
  await rest(restUrl('applications'), {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      dup_key: key,
      src: offer?.src ?? a.src,
      id,
      title: a.title,
      company: a.company,
      url: offer?.url ?? a.url,
      applied_at: a.appliedAt,
      content: text || null,
      details: a.details,
      // with a link but no text, the ad is fetched right after saving (like "Mark applied")
      content_status: text.length >= 80 ? 'ok' : a.url ? 'pending' : 'empty',
      content_error: text.length >= 80 || a.url ? null : NO_TEXT,
      scraped_at: text ? new Date().toISOString() : null,
      stage: a.stage,
      stage_state: a.state,
      stage_updated_at: history[history.length - 1].at,
      history,
      note: a.note?.trim() ? a.note.slice(0, NOTE_MAX) : null,
      note_updated_at: a.note?.trim() ? new Date().toISOString() : null,
    }),
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
  if (offer) target = await jobKeyFor(offer.company, offer.title, offer.dup_key);
  else if ((e.title !== app.title || e.company !== app.company) && !(await findJob(key).catch(() => null))) target = await jobKeyFor(e.company, e.title);
  if (target !== key) {
    const other = await getApplication(target);
    if (other) return { error: alreadyThere(other, z) };
  }

  const fields: Partial<ApplicationWithContent> = { title: e.title, company: e.company };
  if (target !== key) fields.dup_key = target;
  // which copy: the scraped offer behind the link, else the board and the link as typed
  const url = offer?.url ?? typedUrl;
  if (offer) Object.assign(fields, { src: offer.src, id: offer.id, url });
  else {
    Object.assign(fields, { src: e.src, url });
    if (url !== app.url || e.src !== app.src) fields.id = boardIdOf(e.src, url) || (ownId(app.id) ? app.id : newId());
  }

  // another day: the first step (applying) moves with it, and so does "no news since" if nothing changed since
  const history = [...(app.history ?? [])];
  if (e.day !== z.day(app.applied_at)) {
    const next = history[1];
    if (next && e.day > z.day(next.at)) return { error: `The status changed on ${z.formatDayOf(next.at)}: you applied that day or earlier.` };
    const at = appliedAtOf(e.day, z);
    fields.applied_at = at;
    if (history[0]?.stage === 'submitted' && history[0].state === 'pending') {
      history[0] = { ...history[0], at };
      fields.history = history;
    }
    if (app.stage_updated_at && Date.parse(app.stage_updated_at) === Date.parse(app.applied_at)) fields.stage_updated_at = at;
  }

  // the typed details over the rest of what the board said (posted, valid until…)
  const details: JobDetails = { ...(app.details ?? {}) };
  for (const k of ['salary', 'contract', 'location'] as const) {
    const v = e.details?.[k];
    if (v) details[k] = v;
    else delete details[k];
  }
  if (e.details?.remote) details.remote = true;
  else delete details.remote;
  fields.details = Object.keys(details).length ? details : null;

  // the ad text: as typed; left empty, it's fetched from the link (like adding one)
  const text = e.content.trim();
  const had = (app.content ?? '').trim();
  let fetch = false;
  if (!text) {
    if (url) {
      Object.assign(fields, { content: null, content_status: 'pending', content_error: null });
      fetch = true;
    } else if (had) Object.assign(fields, { content: null, content_status: 'empty', content_error: NO_TEXT });
  } else if (text !== had) {
    if (text.length >= 80) Object.assign(fields, { content: text, content_status: 'ok', content_error: null, scraped_at: new Date().toISOString() });
    else if (url) {
      Object.assign(fields, { content: text, content_status: 'pending', content_error: null });
      fetch = true;
    } else Object.assign(fields, { content: text, content_status: 'empty', content_error: NO_TEXT });
  }

  await patch(key, fields);
  return { app: (await getApplication(target)) ?? undefined, fetch };
}
