import 'server-only';
import { scrapeOfferFull, type JobDetails } from './scrape';
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
};
export type ApplicationWithContent = Application & { content: string | null };

const LIST_COLS = 'dup_key,src,id,title,company,url,applied_at,details,content_status,content_error,scraped_at';
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
    body: JSON.stringify({ dup_key: key, src: copy.src, id: copy.id, title: job.title, company: job.company, url: copy.url }),
  });
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
  ];

  let firstEmpty: { details: JobDetails } | null = null;
  let lastError: string | null = null;
  for (const c of copies) {
    try {
      const s = await scrapeOfferFull(c);
      if (s.status === 'ok') {
        await patch(key, { content: s.text, details: s.details, content_status: 'ok', content_error: null, scraped_at: new Date().toISOString() });
        return;
      }
      firstEmpty ??= { details: s.details };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  await patch(key, {
    content: null,
    details: firstEmpty?.details ?? null,
    content_status: firstEmpty ? 'empty' : 'failed',
    content_error: firstEmpty ? 'The board page has no ad text (removed or blocked?).' : lastError,
    scraped_at: new Date().toISOString(),
  });
}
