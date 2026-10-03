import 'server-only';
import { after } from 'next/server';
import { assessJobs, type Verdict } from '../ai-runs';
import { getProfile, isUsable, listProfiles, type ProfileWithFile } from '../profiles';
import { formatNotification, sendMessage, telegramReady, type Outgoing } from '../telegram';
import type { ScrapeSettings, Scraper } from './kinds';
import { areaTest, expandUrl, keywordTest, placeOf, titleTest, type Found } from './match';
import { parseBody } from './parsers';
import {
  claimQueue,
  enqueue,
  finishRun,
  getSettings,
  getState,
  ingest,
  listQueue,
  listScrapers,
  lock,
  saveOutcome,
  startRun,
  unlock,
  updateRun,
  type IngestRow,
  type Queued,
  type QueuedAt,
} from './store';

// One run = every enabled scraper: fetch, parse, filter, save new offers, queue the new jobs
// for Telegram, check them against the active AI profile and send the matches (unless muted).

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
const PARALLEL = 4;
export const LOCK_SECONDS = 280; // a crashed run frees the lock after this (functions stop at 300 s)

function checkUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Not a link: ${raw.slice(0, 80)}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https links');
  // a scraper must not read the server's own network
  const privateHost =
    /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[(::1|f[cd])|metadata)/i;
  if (process.env.NODE_ENV === 'production' && privateHost.test(u.hostname))
    throw new Error('Private addresses are not allowed');
}

export async function fetchPage(url: string, headers: Record<string, string> = {}): Promise<string> {
  checkUrl(url);
  const h = new Headers({
    'User-Agent': UA,
    'Accept-Language': 'pl,en;q=0.8',
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  });
  for (const [k, v] of Object.entries(headers)) h.set(k, v); // the scraper's own headers win
  const res = await fetch(url, {
    headers: h,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status}${res.status === 403 || res.status === 429 ? ' (the site blocks this server?)' : ''}`,
    );
  if (!res.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('The page is bigger than 8 MB');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(all);
  } catch {
    return new TextDecoder().decode(all);
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type PageResult = {
  keyword: string | null;
  page: number;
  url: string;
  ok: boolean;
  error?: string;
  total: number;
  kept: number;
};
export type ScrapeResult = {
  ok: boolean;
  error: string | null;
  /** offers on the pages */
  found: number;
  /** after the filters, one per offer id */
  kept: Found[];
  /** why the others were dropped */
  skipped: { keyword: number; area: number; ignored: number };
  /** newest sort value over everything on the pages, kept or not (the scraper's watermark) */
  maxSort?: number;
  pages: PageResult[];
  sample?: string;
  ms: number;
};

/** Fetches and filters one scraper's pages; never throws (errors are part of the result). */
export async function scrape(
  s: Pick<Scraper, 'kind' | 'src' | 'config'>,
  settings: ScrapeSettings,
): Promise<ScrapeResult> {
  const t0 = Date.now();
  const wantKeyword = s.config.checkKeyword ? keywordTest(settings.keywords) : null;
  const inArea = s.config.checkLocation ? areaTest(settings) : null;
  const ignored = titleTest(settings.ignore);
  const kept = new Map<string, Found>();
  const skipped = { keyword: 0, area: 0, ignored: 0 };
  const pages: PageResult[] = [];
  let maxSort: number | undefined;
  let sample: string | undefined;
  let found = 0;

  let urls: ReturnType<typeof expandUrl>;
  try {
    urls = expandUrl(s.config.url, settings.keywords, s.config.pages);
  } catch (e) {
    return { ok: false, error: message(e), found: 0, kept: [], skipped, pages, ms: 0 };
  }
  for (const u of urls) {
    try {
      const parsed = parseBody(s.kind, await fetchPage(u.url, s.config.headers), {
        src: s.src,
        url: u.url,
        config: s.config,
      });
      sample ??= parsed.sample;
      found += parsed.total;
      let pageKept = 0;
      for (const o of parsed.items) {
        if (o.sort !== undefined && (maxSort === undefined || o.sort > maxSort)) maxSort = o.sort;
        if (wantKeyword && !wantKeyword([o.title, ...o.skills])) skipped.keyword++;
        else if (inArea && !inArea(o)) skipped.area++;
        else if (ignored(o.title)) skipped.ignored++;
        else {
          if (!kept.has(o.id)) pageKept++;
          kept.set(o.id, o);
        }
      }
      pages.push({ keyword: u.keyword, page: u.page, url: u.url, ok: true, total: parsed.total, kept: pageKept });
    } catch (e) {
      pages.push({ keyword: u.keyword, page: u.page, url: u.url, ok: false, error: message(e), total: 0, kept: 0 });
    }
  }
  const failed = pages.filter((p) => !p.ok);
  return {
    ok: failed.length < pages.length,
    error: failed.length
      ? failed
          .map(
            (p) =>
              `${[p.keyword, urls.length > 1 && p.page > 1 && `page ${p.page}`].filter(Boolean).join(' ')}${p.keyword || p.page > 1 ? ': ' : ''}${p.error}`,
          )
          .join('; ')
      : null,
    found,
    kept: [...kept.values()],
    skipped,
    maxSort,
    pages,
    sample,
    ms: Date.now() - t0,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const clean = (v: string | null | undefined) => (v == null ? null : v.replace(/\u0000/g, '').trim() || null);
/* eslint-disable @typescript-eslint/no-non-null-assertion -- parseBody keeps only offers with an id and a link */
const row = (o: Found): IngestRow => ({
  src: o.src,
  id: clean(o.id)!,
  title: clean(o.title) ?? '(no title)',
  company: clean(o.company),
  seniority: clean(o.seniority),
  remote: o.remote,
  url: clean(o.url)!,
});
/* eslint-enable @typescript-eslint/no-non-null-assertion */

export type RunSummary = {
  skipped?: string;
  found: number;
  kept: number;
  added: number;
  fresh: number;
  notified: number;
  /** the AI check and Telegram still run, in the background */
  notifyLater?: boolean;
  errors: { scraper: string; error: string }[];
  ms: number;
};

const EMPTY = { found: 0, kept: 0, added: 0, fresh: 0, notified: 0, errors: [] as RunSummary['errors'], ms: 0 };
// the AI starts no new batch after this much of a run (a batch can take two minutes; functions stop at 300 s)
const AI_BUDGET_MS = 150_000;

/**
 * Runs every enabled scraper. `locked`: the caller already took the lock (the endpoint does,
 * so it can answer "busy" right away). `background`: the AI check and Telegram go on after the
 * answer (the "Scrape now" button doesn't wait for OpenAI).
 */
export async function runAll(
  trigger: 'cron' | 'manual' | 'telegram',
  opts: { locked?: boolean; background?: boolean } = {},
): Promise<RunSummary> {
  if (!opts.locked && !(await lock(LOCK_SECONDS))) return { ...EMPTY, skipped: 'Another run is still going.' };
  const t0 = Date.now();
  let runId: number | null = null;
  let unlockLater = false;
  try {
    const [settings, scrapers] = await Promise.all([getSettings(), listScrapers()]);
    runId = await startRun(trigger);
    const active = scrapers.filter((s) => s.enabled);
    const results = await mapLimit(active, PARALLEL, (s) => scrape(s, settings));

    // the first scraper that found an offer owns it (two searches on one board find the same ones)
    const owner = new Map<string, { o: Found; s: Scraper }>();
    results.forEach((r, i) => {
      for (const o of r.kept) {
        const k = `${o.src}\n${o.id}`;
        const had = owner.get(k);
        if (!had) owner.set(k, { o, s: active[i] });
        // e.g. LinkedIn's "Warszawa" search doesn't say remote, its "remote only" one does
        else if (o.remote && !had.o.remote) had.o = { ...had.o, remote: true };
      }
    });
    const added = await ingest([...owner.values()].map(({ o }) => row(o)));

    // what's worth a message
    const muted = titleTest(settings.mute);
    const addedBy = new Map<string, number>();
    const jobs = new Set<string>();
    const fresh: Queued[] = [];
    for (const a of added) {
      const own = owner.get(`${a.src}\n${a.id}`);
      if (!own) continue;
      addedBy.set(own.s.id, (addedBy.get(own.s.id) ?? 0) + 1);
      if (own.s.mark === null) continue; // the scraper's first run only saves
      if (own.o.sort !== undefined && own.o.sort <= own.s.mark) continue; // an old offer bumped up again
      if (a.seen_before || jobs.has(a.dup_key)) continue; // the same job, already seen on another board
      if (muted(own.o.title)) continue; // a stack you don't want to hear about
      jobs.add(a.dup_key);
      fresh.push({ ...row(own.o), location: placeOf(own.o, settings.cities), dup_key: a.dup_key });
    }

    await Promise.all(
      results.map((r, i) => {
        const s = active[i];
        // the watermark moves only on a successful run; null -> "has run" even with nothing dated
        const mark = r.ok ? Math.max(s.mark ?? -Infinity, r.maxSort ?? -Infinity, 0) : s.mark;
        return saveOutcome(s.id, {
          ok: r.ok,
          found: r.found,
          kept: r.kept.length,
          added: addedBy.get(s.id) ?? 0,
          error: r.error,
          ms: r.ms,
          mark,
        });
      }),
    );

    const errors = results.flatMap((r, i) => (r.error ? [{ scraper: active[i].name, error: r.error }] : []));
    const summary: RunSummary = {
      found: results.reduce((n, r) => n + r.found, 0),
      kept: owner.size,
      added: added.length,
      fresh: fresh.length,
      notified: 0,
      errors,
      ms: Date.now() - t0,
    };
    await finishRun(runId, {
      found: summary.found,
      kept: summary.kept,
      added: summary.added,
      fresh: summary.fresh,
      notified: 0,
      errors,
    });

    // every new job (not another board's copy of a known one) gets the AI's verdict, also the ones
    // that aren't announced (a scraper's first run, a muted title): the AI tab has them checked
    const newJobs = [...new Set(added.filter((a) => !a.seen_before).map((a) => a.dup_key))];
    // the announced ones wait in the queue; Telegram gets the matches
    const send = settings.notify && telegramReady();
    if (send) await enqueue(fresh);
    const id = runId;
    const deadline = t0 + AI_BUDGET_MS;
    const tail = async () => {
      const more: RunSummary['errors'] = [];
      const note = (scraper: string, error?: string | null) => {
        if (error && !more.some((m) => m.error === error)) more.push({ scraper, error });
      };
      let matched: number | null = null;
      const profile = newJobs.length
        ? await aiProfile(settings).catch((e: unknown) => (note('AI', message(e)), null))
        : null;
      if (profile) {
        const r = await assessJobs(profile, newJobs, deadline).catch((e: unknown) => ({
          verdicts: new Map<string, Verdict>(),
          error: message(e),
        }));
        matched = newJobs.filter((k) => r.verdicts.get(k)?.match).length;
        note('AI', r.error);
      }
      const n = send ? await notify({ deadline }) : { sent: 0 };
      note('AI / Telegram', 'error' in n ? n.error : null);
      if (profile || send || more.length)
        await updateRun(id, { notified: n.sent, matched, errors: [...errors, ...more] });
      return { sent: n.sent, more };
    };
    if (opts.background && (newJobs.length || fresh.length)) {
      unlockLater = true;
      after(() =>
        tail()
          .catch((e: unknown) => console.error('[scrape] AI / Telegram failed:', e))
          .finally(() => unlock().catch(() => {})),
      );
      return { ...summary, notifyLater: true };
    }
    const { sent, more } = await tail();
    return { ...summary, notified: sent, errors: [...errors, ...more], ms: Date.now() - t0 };
  } catch (e) {
    // the database or something unexpected: keep it in the run log, so Settings shows it
    const errors = [{ scraper: 'Run', error: message(e) }];
    if (runId !== null) await finishRun(runId, { ...EMPTY, errors }).catch(() => {});
    return { ...EMPTY, errors, ms: Date.now() - t0 };
  } finally {
    if (!unlockLater) await unlock().catch(() => {});
  }
}

// ---- the AI filter and Telegram ------------------------------------------------------------

/** an offer the AI couldn't check for this long goes out anyway, marked, instead of waiting forever */
const UNCHECKED_AFTER_MS = 20 * 60_000;

type Notified = { sent: number; matched: number | null; error?: string };

/** The active AI profile, if the AI filter can work: on in Settings, a usable profile, an OpenAI key. */
async function aiProfile(settings: ScrapeSettings): Promise<ProfileWithFile | null> {
  if (!settings.aiFilter || !process.env.OPENAI_API_KEY) return null;
  const active = (await listProfiles())[0];
  if (!isUsable(active)) return null;
  return getProfile(active.id);
}

const appLink = () =>
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/ai?days=1&rejected=1`
    : null;

/**
 * Checks what's queued against the AI profile and sends what's ready: the matches listed, the
 * rest as a count. Offers still waiting for a verdict stay queued for the next run. While muted
 * (and not sent by hand) nothing is sent, but the verdicts are made, so /send is quick.
 */
export async function notify(opts: { manual?: boolean; deadline?: number } = {}): Promise<Notified> {
  const queued = await listQueue();
  if (!queued.length) return { sent: 0, matched: null };
  const settings = await getSettings();
  let error: string | undefined;
  const profile = await aiProfile(settings).catch((e: unknown) => ((error = message(e)), null));
  let verdicts = new Map<string, Verdict>();
  if (profile) {
    try {
      const r = await assessJobs(
        profile,
        [...new Set(queued.flatMap((q) => q.dup_key ?? []))],
        opts.deadline ?? Date.now() + AI_BUDGET_MS,
      );
      verdicts = r.verdicts;
      if (r.error) error = r.error;
    } catch (e) {
      error = message(e);
    }
  }
  const muted = (await getState()).muted;
  if (muted && !opts.manual) return { sent: 0, matched: null, ...(error ? { error } : {}) };

  const waited = (q: QueuedAt) => Date.now() - Date.parse(q.queued_at) > UNCHECKED_AFTER_MS;
  const ready = queued.filter((q) => !profile || !q.dup_key || verdicts.has(q.dup_key) || waited(q));
  // nothing decided yet (e.g. OpenAI is down): no "0 matched" in the log, just the error
  if (!ready.length) return { sent: 0, matched: null, ...(error ? { error } : {}) };
  const claimed = await claimQueue(ready); // only the ones no other sender took meanwhile

  const matched: Outgoing[] = [];
  const unmatched: QueuedAt[] = [];
  const unchecked: QueuedAt[] = [];
  for (const q of claimed) {
    const v = profile && q.dup_key ? verdicts.get(q.dup_key) : undefined;
    if (!profile) matched.push(q);
    else if (!v) unchecked.push(q);
    else if (v.match) matched.push({ ...q, verdict: { score: v.score, summary: v.summary } });
    else unmatched.push(q);
  }
  const messages = formatNotification({
    matched,
    unmatched,
    unchecked,
    profile: profile?.name ?? null,
    held: Boolean(opts.manual && muted),
    link: appLink(),
  });
  let sent = 0;
  for (let i = 0; i < messages.length; i++) {
    try {
      await sendMessage(messages[i].text);
    } catch (e) {
      // back into the queue with their own time, so they're tried again (and still count as waiting)
      const left = new Set(messages.slice(i).flatMap((m) => m.offers.map((o) => `${o.src}\n${o.id}`)));
      await enqueue(claimed.filter((q) => left.has(`${q.src}\n${q.id}`))).catch(() => {});
      return { sent, matched: profile ? matched.length : null, error: message(e) };
    }
    sent += messages[i].offers.length;
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 400)); // Telegram: about 1 message/s per chat
  }
  return {
    sent: matched.length + unchecked.length,
    matched: profile ? matched.length : null,
    ...(error ? { error } : {}),
  };
}
