import 'server-only';
import type { Scraper } from '../db/repos/scrapers';
import { env } from '../env';
import { hmac, sameString } from '../hmac';
import { expandUrl } from './match';
import type { ScrapeSettings } from './settings';

// The bookmarklet: for a board that blocks this server (Eldorado's Cloudflare answers a datacenter with
// a challenge) but not your browser. Clicked on the board's site, it asks /api/import which pages that
// site's scrapers read, fetches them there, as you, and sends them back; the server runs those scrapers
// on them as usual (parse, filters, save, notify). Clicked anywhere else, it opens the blocked board's
// search instead: a bookmarklet ends with its page, so the import is a second click there. Nothing gets past the board's checks: it is your
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

/** A scraper's pages, as expandUrl gives them; null if its link can't be expanded. */
function pagesOf(scraper: Pick<Scraper, 'config'>, settings: Pick<ScrapeSettings, 'keywords'>) {
  try {
    return expandUrl(scraper.config.url, settings.keywords, scraper.config.pages).map((page) => page.url);
  } catch {
    return null;
  }
}

/**
 * The scrapers whose links are on `host` (switched on or not: a click is asking for them) and the
 * pages they read; a scraper whose link can't be expanded is left out, and so is an ATS's: its link is a
 * careers page, but what it reads is the ATS's API, on another host.
 */
export function importPlan(
  scrapers: readonly Pick<Scraper, 'id' | 'name' | 'kind' | 'config'>[],
  settings: Pick<ScrapeSettings, 'keywords'>,
  host: string,
): { scrapers: { id: string; name: string }[]; urls: string[] } {
  const chosen: { id: string; name: string }[] = [];
  const urls = new Set<string>();
  for (const scraper of scrapers) {
    if (scraper.kind === 'ats') continue;
    const pages = pagesOf(scraper, settings);
    if (!pages?.length || pages.some((url) => hostOf(url) !== host)) continue;
    chosen.push({ id: scraper.id, name: scraper.name });
    for (const url of pages) urls.add(url);
  }
  return { scrapers: chosen, urls: [...urls] };
}

/**
 * Where a click elsewhere (on Jobwatch, say) takes you: the first page of the first scraper the latest
 * scheduled run was refused with a 403, the board that blocks this server; null if none was. The
 * scheduled run, not the scraper's last one: after an import from the browser that one is fine.
 */
export function blockedPage(
  scrapers: readonly Pick<Scraper, 'name' | 'config'>[],
  settings: Pick<ScrapeSettings, 'keywords'>,
  cronErrors: readonly { scraper: string; error: string }[],
): string | null {
  const refused = new Set(
    cronErrors.filter((failed) => /\bHTTP 403\b/.test(failed.error)).map((failed) => failed.scraper),
  );
  for (const scraper of scrapers) {
    if (!refused.has(scraper.name)) continue;
    const first = pagesOf(scraper, settings)?.[0];
    if (first) return first;
  }
  return null;
}

// Runs on the board's page. Plain ES2020 in a string, not a compiled function: what's dragged to the
// bookmarks bar must not depend on the bundler. APP and TOKEN are filled in by bookmarklet().
const SCRIPT = `(async (APP, TOKEN) => {
  // a click anywhere on it (or its ×) closes it; it goes by itself after 10 s at the end
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:2147483647;top:12px;right:12px;max-width:360px;padding:10px 38px 10px 14px;border-radius:8px;' +
    'background:#18181b;color:#fafafa;font:14px/1.4 system-ui,sans-serif;white-space:pre-wrap;box-shadow:0 4px 16px #0004;cursor:pointer';
  box.title = 'Close';
  const message = document.createElement('span');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.style.cssText =
    'position:absolute;top:4px;right:6px;padding:2px 8px;border:0;background:none;color:inherit;font:20px/1 system-ui,sans-serif;cursor:pointer';
  box.append(message, close);
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
  const say = (text) => { message.textContent = 'Jobwatch: ' + text; };
  const auth = { Authorization: 'Bearer ' + TOKEN };
  const answer = async (res) => {
    const result = await res.json().catch(() => ({ ok: false, error: 'HTTP ' + res.status }));
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  try {
    say('which pages…');
    const plan = await answer(await fetch(APP + '/api/import?host=' + encodeURIComponent(location.host), { headers: auth }));
    if (!plan.urls.length) {
      // not a scraped board's site (Jobwatch, say): off to the one that blocks the server, for the second
      // click. The page may stay (an installed app opens the link in the browser): the box goes as below.
      if (!plan.open) throw new Error('no scraper reads ' + location.host + ', and no board is blocking Jobwatch now');
      say('opening ' + new URL(plan.open).host + '… click Jobwatch import again there');
      location.assign(plan.open);
    } else {
      await importPages(plan);
    }
  } catch (error) {
    say('failed: ' + error.message);
  }
  setTimeout(() => box.remove(), 10000);

  async function importPages(plan) {
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
  }
})`;

/** The bookmark's link: SCRIPT, called with this app's address and the token. */
export function bookmarklet(app: string, token: string) {
  return `javascript:${encodeURIComponent(`${SCRIPT}(${JSON.stringify(app)},${JSON.stringify(token)});void 0`)}`;
}
