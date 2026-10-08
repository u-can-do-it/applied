import { NextResponse, type NextRequest } from 'next/server';
import * as z from 'zod/mini';
import { importPlan, isImportRequest } from '@/lib/listings/bookmarklet';
import { runAll } from '@/lib/listings/run';
import * as scrapersRepo from '@/lib/db/repos/scrapers';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { log } from '@/lib/log';
import { message } from '@/lib/shared/errors';
import { fail, ok } from '@/lib/shared/result';

// The bookmarklet's endpoint (lib/listings/bookmarklet.ts), called from a board's page with
// "Authorization: Bearer <token>":
//   GET  ?host=czyjesteldorado.pl  -> Result<{ scrapers, urls }>: the pages to fetch there
//   POST (gzipped JSON { host, pages: [{ url, body }] })  -> Result<RunSummary>: those scrapers, run on them
// Any origin may call it: the token is the gate, not a cookie, so CORS guards nothing here.
export const maxDuration = 300;

const ROUTE = '/api/import';
/** what a gzipped request may unpack to: a few listing pages, not more */
const MAX_BYTES = 50 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store',
};

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });

const importSchema = z.object({
  host: z.string().check(z.minLength(1)),
  pages: z.array(z.object({ url: z.string(), body: z.string() })),
});

async function plan(host: string) {
  const [settings, scrapers] = await Promise.all([settingsRepo.get(), scrapersRepo.list()]);
  return importPlan(scrapers, settings, host);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  if (!(await isImportRequest(request))) return reply(fail('Wrong or missing token'), 401);
  const host = request.nextUrl.searchParams.get('host');
  if (!host) return reply(fail('Bad request'), 400);
  try {
    const { scrapers, urls } = await plan(host);
    return reply(ok({ scrapers: scrapers.map((scraper) => scraper.name), urls }));
  } catch (error) {
    log.error('Bookmarklet: the plan failed', { route: ROUTE, error });
    return reply(fail(message(error)), 500);
  }
}

async function unzip(request: NextRequest) {
  if (!request.body) return null;
  const text = await new Response(request.body.pipeThrough(new DecompressionStream('gzip'))).text();
  return text.length > MAX_BYTES ? null : (JSON.parse(text) as unknown);
}

export async function POST(request: NextRequest) {
  if (!(await isImportRequest(request))) return reply(fail('Wrong or missing token'), 401);
  const parsed = importSchema.safeParse(await unzip(request).catch(() => null));
  if (!parsed.success) return reply(fail('Bad request'), 400);
  try {
    const { scrapers, urls } = await plan(parsed.data.host);
    if (!scrapers.length) return reply(fail(`No scraper reads ${parsed.data.host}`), 400);
    // only the pages those scrapers read: the rest of what was sent is left out
    const wanted = new Set(urls);
    const pages = new Map(
      parsed.data.pages.filter((page) => wanted.has(page.url)).map((page) => [page.url, page.body]),
    );
    const summary = await runAll('bookmarklet', {
      background: true,
      browser: { scrapers: scrapers.map((scraper) => scraper.id), pages },
    });
    return reply(ok(summary));
  } catch (error) {
    log.error('Bookmarklet run failed', { route: ROUTE, error });
    return reply(fail(message(error)), 500);
  }
}
