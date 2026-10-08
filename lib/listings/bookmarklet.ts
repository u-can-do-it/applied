import 'server-only';
import type { Scraper } from '../db/repos/scrapers';
import { env } from '../env';
import { hmac, sameString } from '../hmac';
import { expandUrl } from './match';
import type { ScrapeSettings } from './settings';

// The bookmarklet: for a board that blocks this server (Eldorado's Cloudflare answers a datacenter with
// a challenge) but not your browser. Clicked on the board's site, it asks /api/import which pages that
// site's scrapers read, fetches them there, as you, and sends them back; the server runs those scrapers
// on them as usual (parse, filters, save, notify). Nothing gets past the board's checks: it is your
// browser on the board's own page, like opening it yourself.

/** What the bookmarklet sends as "Authorization: Bearer …"; derived from APP_PASSWORD. */
export async function importToken(): Promise<string | null> {
  return env.APP_PASSWORD ? hmac(env.APP_PASSWORD, 'jobwatch-import-v1') : null;
}

/** Without APP_PASSWORD only a local dev server lets it through (like the cron endpoint). */
export async function isImportRequest(request: Request) {
  const token = await importToken();
  if (!token) return env.NODE_ENV !== 'production';
  return sameString(request.headers.get('authorization') ?? '', `Bearer ${token}`);
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/**
 * The scrapers whose links are on `host` (switched on or not: a click is asking for them) and the
 * pages they read, as expandUrl gives them; a scraper whose link can't be expanded is left out.
 */
export function importPlan(
  scrapers: readonly Pick<Scraper, 'id' | 'name' | 'config'>[],
  settings: Pick<ScrapeSettings, 'keywords'>,
  host: string,
): { scrapers: { id: string; name: string }[]; urls: string[] } {
  const chosen: { id: string; name: string }[] = [];
  const urls = new Set<string>();
  for (const scraper of scrapers) {
    let pages: string[];
    try {
      pages = expandUrl(scraper.config.url, settings.keywords, scraper.config.pages).map((page) => page.url);
    } catch {
      continue;
    }
    if (!pages.length || pages.some((url) => hostOf(url) !== host)) continue;
    chosen.push({ id: scraper.id, name: scraper.name });
    for (const url of pages) urls.add(url);
  }
  return { scrapers: chosen, urls: [...urls] };
}

// Runs on the board's page. Plain ES2020 in a string, not a compiled function: what's dragged to the
// bookmarks bar must not depend on the bundler. APP and TOKEN are filled in by bookmarklet().
const SCRIPT = `(async (APP, TOKEN) => {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:360px;padding:10px 14px;border-radius:8px;' +
    'background:#18181b;color:#fafafa;font:14px/1.4 system-ui,sans-serif;white-space:pre-wrap;box-shadow:0 4px 16px #0004';
  document.body.append(box);
  const say = (text) => { box.textContent = 'Jobwatch: ' + text; };
  const auth = { Authorization: 'Bearer ' + TOKEN };
  const answer = async (res) => {
    const result = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  try {
    say('which pages…');
    const plan = await answer(await fetch(APP + '/api/import?host=' + encodeURIComponent(location.host), { headers: auth }));
    if (!plan.urls.length) throw new Error('no scraper reads ' + location.host);
    const pages = [];
    for (const [i, url] of plan.urls.entries()) {
      say('page ' + (i + 1) + ' of ' + plan.urls.length + '…');
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
      pages.push({ url, body: await res.text() });
    }
    say('sending to ' + plan.scrapers.join(', ') + '…');
    const json = new Blob([JSON.stringify({ host: location.host, pages })]);
    const body = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const run = await answer(
      await fetch(APP + '/api/import', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/gzip' }, body }),
    );
    say(
      run.skipped ||
        run.found + ' found, ' + run.kept + ' kept, ' + run.added + ' new' +
          run.errors.map((failed) => '\\n' + failed.scraper + ': ' + failed.error).join(''),
    );
  } catch (error) {
    say('failed: ' + error.message);
  }
  setTimeout(() => box.remove(), 10000);
})`;

/** The bookmark's link: SCRIPT, called with this app's address and the token. */
export function bookmarklet(app: string, token: string) {
  return `javascript:${encodeURIComponent(`${SCRIPT}(${JSON.stringify(app)},${JSON.stringify(token)});void 0`)}`;
}
