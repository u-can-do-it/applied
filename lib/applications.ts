import 'server-only';
import { boardIdOf, boardOf, cleanLink } from './boards';
import { formatDay, todayInWarsaw } from './dates';
import { scrapeOfferFull, type JobDetails } from './scrape';
import type { HistoryEntry, StageId, StateId } from './stages';
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

/** Moves the application to a stage / outcome; the change is added to its history. */
export async function setStatus(key: string, stage: StageId, state: StateId) {
  await rest(restUrl('rpc/jw_set_application_status'), {
    method: 'POST',
    body: JSON.stringify({ p_key: key, p_stage: stage, p_state: state }),
  });
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

/** Scrapes the complete ad: the copy that was marked first, then the job's other boards. */
export async function saveContent(key: string) {
  const app = await getApplication(key);
  if (!app) return;
  const job = await findJob(key).catch(() => null);
  const copies = [
    { src: app.src, id: app.id, url: app.url },
    ...(job?.copies ?? []).filter((c) => !(c.src === app.src && c.id === app.id)),
  ].filter((c) => c.url); // one added by hand may have no link
  // added by hand or imported: what you typed (salary, location…) stays over what the board says
  const typed = /^(manual|import)-/.test(app.id) ? (app.details ?? {}) : {};
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

/** Saves an application typed in by hand; an error if the job already has one. */
export async function addApplication(a: NewApplication): Promise<{ key?: string; error?: string }> {
  const offer = a.url ? await findOfferByLink(a.url).catch(() => null) : null;
  const key = await jobKeyFor(offer?.company ?? a.company, offer?.title ?? a.title, offer?.dup_key);
  const existing = await getApplication(key);
  if (existing) return { error: `Already in your applications: “${existing.title}”, applied ${formatDay(todayInWarsaw(Date.parse(existing.applied_at)))}.` };
  const id = offer?.id ?? (boardIdOf(a.src, a.url) || `manual-${crypto.randomUUID().slice(0, 12)}`);
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
      content_error: text.length >= 80 || a.url ? null : 'Added by hand, without the ad text.',
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
