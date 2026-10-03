import 'server-only';
import type { Scraper } from '../../db/repos/scrapers';
import { BROWSER_UA, checkUrl } from '../../outbound';
import { message } from '../../shared/errors';
import { areaTest, expandUrl, keywordTest, titleTest } from '../match';
import { parseBody } from '../parse';
import type { ScrapeSettings } from '../settings';
import type { Found } from '../types';
import type { Fetched } from './model';

// Step 1, fetchListings: every enabled scraper's pages, fetched, parsed and filtered (keywords,
// cities, ignored titles). A scraper's failure is part of its result, never the run's.

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
const PARALLEL = 4;

export async function fetchPage(url: string, headers: Record<string, string> = {}): Promise<string> {
  checkUrl(url);
  const sent = new Headers({
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'pl,en;q=0.8',
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  });
  for (const [name, value] of Object.entries(headers)) sent.set(name, value); // the scraper's own headers win
  const res = await fetch(url, {
    headers: sent,
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
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const charset = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(all);
  } catch {
    return new TextDecoder().decode(all);
  }
}

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
  scraper: Pick<Scraper, 'kind' | 'src' | 'config'>,
  settings: ScrapeSettings,
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const { config } = scraper;
  const wantKeyword = config.checkKeyword ? keywordTest(settings.keywords) : null;
  const inArea = config.checkLocation ? areaTest(settings) : null;
  const ignored = titleTest(settings.ignore);
  const kept = new Map<string, Found>();
  const skipped = { keyword: 0, area: 0, ignored: 0 };
  const pages: PageResult[] = [];
  let maxSort: number | undefined;
  let sample: string | undefined;
  let found = 0;

  let urls: ReturnType<typeof expandUrl>;
  try {
    urls = expandUrl(config.url, settings.keywords, config.pages);
  } catch (error) {
    return { ok: false, error: message(error), found: 0, kept: [], skipped, pages, ms: 0 };
  }
  for (const target of urls) {
    const { keyword, page, url } = target;
    try {
      const parsed = parseBody(scraper.kind, await fetchPage(url, config.headers), { src: scraper.src, url, config });
      sample ??= parsed.sample;
      found += parsed.total;
      let pageKept = 0;
      for (const offer of parsed.items) {
        if (offer.sort !== undefined && (maxSort === undefined || offer.sort > maxSort)) maxSort = offer.sort;
        if (wantKeyword && !wantKeyword([offer.title, ...offer.skills])) skipped.keyword++;
        else if (inArea && !inArea(offer)) skipped.area++;
        else if (ignored(offer.title)) skipped.ignored++;
        else {
          if (!kept.has(offer.id)) pageKept++;
          kept.set(offer.id, offer);
        }
      }
      pages.push({ keyword, page, url, ok: true, total: parsed.total, kept: pageKept });
    } catch (error) {
      pages.push({ keyword, page, url, ok: false, error: message(error), total: 0, kept: 0 });
    }
  }
  const failed = pages.filter((result) => !result.ok);
  return {
    ok: failed.length < pages.length,
    error: failed.length
      ? failed
          .map(
            (result) =>
              `${[result.keyword, urls.length > 1 && result.page > 1 && `page ${result.page}`].filter(Boolean).join(' ')}${result.keyword || result.page > 1 ? ': ' : ''}${result.error}`,
          )
          .join('; ')
      : null,
    found,
    kept: [...kept.values()],
    skipped,
    maxSort,
    pages,
    sample,
    ms: Date.now() - startedAt,
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

/** Scrapes every enabled scraper, a few at a time; each result stays with its scraper, in order. */
export async function fetchListings(scrapers: readonly Scraper[], settings: ScrapeSettings): Promise<Fetched[]> {
  const enabled = scrapers.filter((scraper) => scraper.enabled);
  const results = await mapLimit(enabled, PARALLEL, (scraper) => scrape(scraper, settings));
  return enabled.map((scraper, i) => ({ scraper, result: results[i] }));
}
