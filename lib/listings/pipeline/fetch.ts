import 'server-only';
import { STATUS_CODES } from 'node:http';
import type { Scraper } from '../../db/repos/scrapers';
import { BROWSER_UA, fetchOutbound, readText } from '../../outbound';
import { cameThroughScrapingAnt } from '../../scraping-ant';
import { message } from '../../shared/errors';
import { withApiParams } from '../api-params';
import { isObj, str, strip } from '../extract';
import { areaTest, expandUrl, keywordTest, titleTest } from '../match';
import { parseBody } from '../parse';
import { isDue } from '../quota';
import type { ScrapeSettings } from '../settings';
import type { Found } from '../types';
import type { Fetched } from './model';

// Step 1, fetchListings: every enabled scraper's pages, fetched, parsed and filtered (keywords,
// cities, ignored titles). A scraper's failure is part of its result, never the run's. A board with a quota
// of calls has its scrapers skipped by the runs in between (lib/listings/quota.ts).

const TIMEOUT_MS = 20_000;
const PARALLEL = 4;

/** The page's text, and whether it came through ScrapingAnt (its board turned the server away). */
export async function fetchPage(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ text: string; proxied: boolean }> {
  const sent = new Headers({
    'User-Agent': BROWSER_UA,
    'Accept-Language': 'pl,en;q=0.8',
    Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  });
  for (const [name, value] of Object.entries(headers)) sent.set(name, value); // the scraper's own headers win
  const res = await fetchOutbound(url, {
    headers: sent,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) {
    const reason = await reasonOf(res);
    // "HTTP 503, message: Service Temporarily Unavailable"; without its own words, the status's: "HTTP 503 Service Unavailable"
    const words = reason ? `, message: ${reason}` : STATUS_CODES[res.status] ? ` ${STATUS_CODES[res.status]}` : '';
    throw new Error(
      `HTTP ${res.status}${words}${res.status === 403 || res.status === 429 ? ' (the site blocks this server?)' : ''}`,
    );
  }
  return { text: await readText(res), proxied: cameThroughScrapingAnt(res) };
}

/**
 * The site's own words for a refusal: an API's JSON ({"display": "Authorisation failed"}, {"message": …}),
 * an error page's title or heading ("503 Service Temporarily Unavailable", its code left out), or a
 * plain-text answer.
 */
async function reasonOf(res: Response): Promise<string> {
  const type = res.headers.get('content-type') ?? '';
  try {
    const body = await readText(res);
    let reason = '';
    if (type.includes('json')) {
      const answer: unknown = JSON.parse(body);
      if (!isObj(answer)) return '';
      const error = isObj(answer.error) ? answer.error.message : answer.error;
      reason = str(answer.display ?? answer.message ?? error);
    } else if (type.includes('html')) {
      // not the page's text: a board's own error page is its whole site
      reason = strip(
        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] || '',
      );
    } else if (type.startsWith('text/')) {
      reason = strip(body);
    }
    return reason.replace(new RegExp(`^${res.status}\\b\\s*[-:–]?\\s*`), '').slice(0, 200);
  } catch {
    return '';
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
  /** fetched through ScrapingAnt */
  proxied?: true;
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
  /** how many of the pages came through ScrapingAnt (the board turned the server away) */
  proxied: number;
  sample?: string;
  ms: number;
};

/**
 * Fetches and filters one scraper's pages; never throws (errors are part of the result).
 */
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
    return { ok: false, error: message(error), found: 0, kept: [], skipped, pages, proxied: 0, ms: 0 };
  }
  for (const target of urls) {
    const { keyword, page, url } = target;
    try {
      const { text, proxied } = await fetchPage(withApiParams(scraper.kind, url), config.headers);
      const parsed = parseBody(scraper.kind, text, { src: scraper.src, url, config });
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
      pages.push({ keyword, page, url, ok: true, total: parsed.total, kept: pageKept, ...(proxied && { proxied }) });
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
    proxied: pages.filter((result) => result.proxied).length,
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

/**
 * The enabled scrapers a run goes through: a scheduled run leaves out those whose board's quota of calls
 * holds them back (lib/listings/quota.ts); a run you start yourself (Scrape now, /scrape) takes them all.
 */
export function scrapersToRun(
  scrapers: readonly Scraper[],
  settings: Pick<ScrapeSettings, 'keywords'>,
  scheduled: boolean,
  now = Date.now(),
): Scraper[] {
  return scrapers.filter(
    (scraper) => scraper.enabled && (!scheduled || isDue(scraper, scrapers, settings.keywords, now)),
  );
}

/** Scrapes the given scrapers, a few at a time; each result stays with its scraper, in order. */
export async function fetchListings(scrapers: readonly Scraper[], settings: ScrapeSettings): Promise<Fetched[]> {
  const results = await mapLimit([...scrapers], PARALLEL, (scraper) => scrape(scraper, settings));
  return scrapers.map((scraper, i) => ({ scraper, result: results[i] }));
}
