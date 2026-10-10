import 'server-only';
import { byHost } from './boards';
import { SCRAPING_ANT_TIMEOUT_MS, SCRAPING_ANT_WAIT_MS } from './budgets';
import { env } from './env';

// ScrapingAnt (scrapingant.com), for a board whose site turns this server away (its `blocksServer`:
// Eldorado's Cloudflare answers a datacenter with a challenge). fetchOutbound (lib/outbound.ts) asks the
// site first, as for any other; a page it refuses is fetched again through ScrapingAnt's proxies, which
// hand back its HTML. So no credit is spent while the site lets the server in, nor on a dev machine.
// A plain request through a Polish datacenter proxy costs 1 credit, and only when it gets through: the
// site sees through some of those proxies (ScrapingAnt answers 423, free), so it's asked again, from
// another one; 2 tries a page on average (Oct 2026). Its browser and other countries didn't get through
// at all. The free plan has 10,000 credits a month and one request at a time, so here they go one after
// another. Without SCRAPINGANT_API_KEY the refusal stays.

const API = 'https://api.scrapingant.com/v2/general';
/** no browser, a datacenter proxy in Poland: the cheapest request (1 credit), and enough for a page's HTML */
const PARAMS = { browser: 'false', proxy_type: 'datacenter', proxy_country: 'PL' };
/** a refusal: Cloudflare's challenge is a 403 ("Just a moment…"), a rate limit 429, an overloaded site 503 */
const REFUSED = new Set([403, 429, 503]);
/** "Free user concurrency limit": another request of ours is still out (another function, say); after a pause */
const BUSY = 409;
const BUSY_PAUSE_MS = 2_000;
/** "Our browser was detected by target site": that proxy was seen through; at once, from another one */
const DETECTED = 423;
/** tries a page gets (busy or detected), all within SCRAPING_ANT_TIMEOUT_MS */
const TRIES = 8;

/** The site refused the server, it's a board that does that, and there's a key: worth asking ScrapingAnt. */
export function refusedByBlockingBoard(url: string, res: Response): boolean {
  if (!REFUSED.has(res.status) || !env.SCRAPINGANT_API_KEY) return false;
  return Boolean(byHost(new URL(url).hostname)?.blocksServer);
}

let queue: Promise<unknown> = Promise.resolve();

/** One request at a time (the free plan's limit, in this function); a page that waited too long fails. */
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const queuedAt = Date.now();
  const run = queue.then(() => {
    if (Date.now() - queuedAt > SCRAPING_ANT_WAIT_MS)
      throw new Error('ScrapingAnt: too many pages waiting, this one is tried again later');
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

/** ScrapingAnt's own words for its error ({"detail": "…"}). */
async function detailOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  return typeof body?.detail === 'string' ? body.detail : res.statusText;
}

/**
 * The page through ScrapingAnt, as the site answered it there: its status (Ant-Page-Status-Code) and
 * its body, unread (the caller reads it, capped). Throws when ScrapingAnt fails (no credits left, the
 * site unreachable, every try seen through) or the site refuses its proxy too.
 */
export function throughScrapingAnt(url: string): Promise<Response> {
  return inTurn(async () => {
    const api = new URL(API);
    for (const [name, value] of Object.entries({
      url,
      'x-api-key': env.SCRAPINGANT_API_KEY ?? '',
      ...PARAMS,
      timeout: String(SCRAPING_ANT_TIMEOUT_MS / 1000 - 5), // its own, in seconds: it answers before we give up
    }))
      api.searchParams.set(name, value);

    const signal = AbortSignal.timeout(SCRAPING_ANT_TIMEOUT_MS); // the page's, over all its tries
    for (let tried = 1; ; tried++) {
      const res = await fetch(api, { cache: 'no-store', signal });
      if ((res.status === BUSY || res.status === DETECTED) && tried < TRIES) {
        await res.body?.cancel();
        if (res.status === BUSY) await new Promise((resolve) => setTimeout(resolve, BUSY_PAUSE_MS));
        continue;
      }
      // the error never quotes `api`: its query has the key
      if (!res.ok) throw new Error(`ScrapingAnt ${res.status}: ${await detailOf(res)}`);
      const page = Number(res.headers.get('ant-page-status-code')) || 200;
      if (REFUSED.has(page)) {
        await res.body?.cancel();
        throw new Error(`HTTP ${page} through ScrapingAnt too (the site blocks its proxy as well)`);
      }
      return new Response(res.body, {
        status: page >= 200 && page < 600 ? page : 502,
        headers: { 'content-type': res.headers.get('content-type') ?? 'text/html; charset=utf-8' },
      });
    }
  });
}
