import 'server-only';
import { rest, restUrl, rpcUrl } from '../supabase';
import { isKind, normalizeSettings, type ScrapeSettings, type Scraper, type ScraperConfig } from './kinds';

// Database side of scraping (supabase/scraping.sql).

const SCRAPER_COLS =
  'id,position,name,src,kind,enabled,config,mark,last_run_at,last_status,last_found,last_kept,last_new,last_error,last_ms';

export async function getSettings(): Promise<ScrapeSettings> {
  const url = restUrl('scrape_settings');
  url.searchParams.set('select', 'settings');
  const rows = (await (await rest(url)).json()) as { settings: unknown }[];
  return normalizeSettings(rows[0]?.settings);
}

export async function saveSettings(s: ScrapeSettings) {
  const url = restUrl('scrape_settings');
  url.searchParams.set('on_conflict', 'id');
  await rest(url, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: JSON.stringify({ id: true, settings: s, updated_at: new Date().toISOString() }),
  });
}

export async function listScrapers(): Promise<Scraper[]> {
  const url = restUrl('scrapers');
  url.searchParams.set('select', SCRAPER_COLS);
  url.searchParams.set('order', 'position.asc,created_at.asc');
  const rows = (await (await rest(url)).json()) as Scraper[];
  return rows.filter((r) => isKind(r.kind));
}

export async function getScraper(id: string): Promise<Scraper | null> {
  const url = restUrl('scrapers');
  url.searchParams.set('select', SCRAPER_COLS);
  url.searchParams.set('id', `eq.${id}`);
  return ((await (await rest(url)).json()) as Scraper[])[0] ?? null;
}

export type ScraperInput = { name: string; src: string; kind: Scraper['kind']; enabled: boolean; config: ScraperConfig };

export async function insertScraper(s: ScraperInput & { position: number }) {
  const res = await rest(restUrl('scrapers'), { method: 'POST', prefer: 'return=representation', body: JSON.stringify(s) });
  return ((await res.json()) as { id: string }[])[0].id;
}

/** resetMark: the search changed, so its next run only saves (no Telegram flood) */
export async function updateScraper(id: string, fields: Partial<ScraperInput & { position: number }>, resetMark = false) {
  const url = restUrl('scrapers');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({ ...fields, ...(resetMark ? { mark: null } : {}), updated_at: new Date().toISOString() }),
  });
}

export async function deleteScraper(id: string) {
  const url = restUrl('scrapers');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, { method: 'DELETE', prefer: 'return=minimal' });
}

export type ScraperOutcome = {
  ok: boolean;
  found: number;
  kept: number;
  added: number;
  error: string | null;
  ms: number;
  mark: number | null;
};

export async function saveOutcome(id: string, o: ScraperOutcome) {
  const url = restUrl('scrapers');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({
      mark: o.mark,
      last_run_at: new Date().toISOString(),
      last_status: o.ok ? 'ok' : 'error',
      last_found: o.found,
      last_kept: o.kept,
      last_new: o.added,
      last_error: o.error,
      last_ms: o.ms,
    }),
  });
}

// ---- machine state: lock, last call, mute ----------------------------------------------

export type ScrapeState = { locked_until: string | null; last_call_at: string | null; last_run_at: string | null; muted: boolean };

export async function getState(): Promise<ScrapeState> {
  const url = restUrl('scrape_state');
  url.searchParams.set('select', 'locked_until,last_call_at,last_run_at,muted');
  return ((await (await rest(url)).json()) as ScrapeState[])[0] ?? { locked_until: null, last_call_at: null, last_run_at: null, muted: false };
}

async function patchState(fields: Partial<ScrapeState>) {
  const url = restUrl('scrape_state');
  url.searchParams.set('id', 'eq.true');
  await rest(url, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(fields) });
}

export const markCall = () => patchState({ last_call_at: new Date().toISOString() });
export const setMuted = (muted: boolean) => patchState({ muted });
export const unlock = () => patchState({ locked_until: null });

/** Takes the run lock (also stamps last_run_at). false = another run holds it. */
export async function lock(seconds: number): Promise<boolean> {
  const res = await rest(restUrl('rpc/jw_scrape_lock'), { method: 'POST', body: JSON.stringify({ p_seconds: seconds }) });
  return (await res.json()) === true;
}

// ---- runs --------------------------------------------------------------------------------

export type RunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  found: number;
  kept: number;
  added: number;
  fresh: number;
  notified: number;
  /** offers the AI matched (null: sent without the AI filter) */
  matched: number | null;
  errors: { scraper: string; error: string }[];
};

export async function startRun(trigger: string): Promise<number> {
  const res = await rest(restUrl('scrape_runs'), { method: 'POST', prefer: 'return=representation', body: JSON.stringify({ trigger }) });
  return ((await res.json()) as { id: number }[])[0].id;
}

export async function finishRun(id: number, fields: Omit<RunRow, 'id' | 'started_at' | 'finished_at' | 'trigger' | 'matched'>) {
  const url = restUrl('scrape_runs');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ ...fields, finished_at: new Date().toISOString() }) });
  // keep two weeks of history
  const old = restUrl('scrape_runs');
  old.searchParams.set('started_at', `lt.${new Date(Date.now() - 14 * 86400_000).toISOString()}`);
  await rest(old, { method: 'DELETE', prefer: 'return=minimal' });
}

/** What the AI check and Telegram did, after the run itself (they can finish later). */
export async function updateRun(id: number, fields: Partial<Pick<RunRow, 'notified' | 'matched' | 'errors'>>) {
  const url = restUrl('scrape_runs');
  url.searchParams.set('id', `eq.${id}`);
  await rest(url, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify(fields) });
}

export async function listRuns(limit = 12): Promise<RunRow[]> {
  const url = restUrl('scrape_runs');
  url.searchParams.set('select', 'id,started_at,finished_at,trigger,found,kept,added,fresh,notified,matched,errors');
  url.searchParams.set('order', 'started_at.desc');
  url.searchParams.set('limit', String(limit));
  return (await rest(url)).json();
}

// ---- offers ------------------------------------------------------------------------------

export type IngestRow = { src: string; id: string; title: string; company: string | null; seniority: string | null; remote: boolean; url: string };

/** Saves offers; returns the ones that were new, and whether the same job was known before. */
export async function ingest(rows: IngestRow[]): Promise<{ src: string; id: string; dup_key: string; seen_before: boolean }[]> {
  if (!rows.length) return [];
  const res = await rest(restUrl('rpc/jw_ingest_offers'), { method: 'POST', body: JSON.stringify({ p_rows: rows }) });
  return res.json();
}

/** Which of these offers are already in the database (for the Settings test). */
export async function knownIds(src: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const url = restUrl('offers');
  url.searchParams.set('select', 'id');
  url.searchParams.set('src', `eq.${src}`);
  url.searchParams.set('id', `in.(${ids.map((i) => `"${i.replace(/["\\]/g, '\\$&')}"`).join(',')})`);
  return new Set(((await (await rest(url)).json()) as { id: string }[]).map((r) => r.id));
}

export async function sourceCounts(): Promise<Record<string, { offers: number; newest: string | null }>> {
  const rows = (await (await rest(rpcUrl('jw_source_counts', {}))).json()) as { src: string; offers: number; newest: string | null }[];
  return Object.fromEntries(rows.map((r) => [r.src, { offers: Number(r.offers), newest: r.newest }]));
}

// ---- Telegram queue ----------------------------------------------------------------------

export type Queued = {
  src: string;
  id: string;
  title: string;
  company: string | null;
  seniority: string | null;
  remote: boolean;
  location: string | null;
  url: string;
  /** the job (company + title), whose AI verdict decides if it's sent */
  dup_key: string | null;
};
export type QueuedAt = Queued & { queued_at: string };

const QUEUE_COLS = 'src,id,title,company,seniority,remote,location,url,dup_key,queued_at';
const quote = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`;

export async function enqueue(rows: Queued[]) {
  if (!rows.length) return;
  const url = restUrl('notify_queue');
  url.searchParams.set('on_conflict', 'src,id');
  await rest(url, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: JSON.stringify(rows) });
}

export async function listQueue(): Promise<QueuedAt[]> {
  const url = restUrl('notify_queue');
  url.searchParams.set('select', QUEUE_COLS);
  url.searchParams.set('order', 'queued_at.asc');
  return (await rest(url)).json();
}

/**
 * Takes these offers out of the queue and returns the ones it got: two senders at once never
 * get the same offer, so nothing is sent twice.
 */
export async function claimQueue(rows: { src: string; id: string }[]): Promise<QueuedAt[]> {
  const out: QueuedAt[] = [];
  for (let i = 0; i < rows.length; i += 40) {
    const url = restUrl('notify_queue');
    url.searchParams.set('select', QUEUE_COLS);
    url.searchParams.set('or', `(${rows.slice(i, i + 40).map((r) => `and(src.eq.${quote(r.src)},id.eq.${quote(r.id)})`).join(',')})`);
    out.push(...((await (await rest(url, { method: 'DELETE', prefer: 'return=representation' })).json()) as QueuedAt[]));
  }
  return out.sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export async function queueSize(): Promise<number> {
  const url = restUrl('notify_queue');
  url.searchParams.set('select', 'id');
  const res = await rest(url, { method: 'HEAD', prefer: 'count=exact' });
  return Number(res.headers.get('content-range')?.split('/')[1]) || 0;
}


// ---- Supabase Cron -------------------------------------------------------------------------

export type CronStatus = {
  available: boolean;
  scheduled?: boolean;
  schedule?: string;
  active?: boolean;
  url?: string;
  lastStatus?: number | null;
  lastError?: string | null;
  lastAt?: string | null;
};

export async function cronStatus(): Promise<CronStatus> {
  return (await rest(restUrl('rpc/jw_cron_status'), { method: 'POST', body: '{}' })).json();
}

export async function cronConnect(endpoint: string, secret: string): Promise<string> {
  return (await rest(restUrl('rpc/jw_cron_connect'), { method: 'POST', body: JSON.stringify({ p_url: endpoint, p_secret: secret }) })).json();
}

export async function cronDisconnect(): Promise<string> {
  return (await rest(restUrl('rpc/jw_cron_disconnect'), { method: 'POST', body: '{}' })).json();
}
