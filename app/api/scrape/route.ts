import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { runAll } from '@/lib/listings/run';
import { log } from '@/lib/log';
import { message } from '@/lib/shared/errors';
import { fail, ok } from '@/lib/shared/result';
import { scraperIdSchema } from '@/lib/shared/schemas/scrapers';
import { AUTH_COOKIE, isValidToken } from '@/server/auth';

// POST /api/scrape -> Result<RunSummary>: the "Scrape now" button. A full run, whatever the schedule
// says; with {"id": …}, that scraper's only (its run button in Settings). The AI check and Telegram
// continue after the answer (after()), so the button doesn't wait for OpenAI. A route of its own, so
// the time a run may take is this operation's, not the page's that shows the button.
export const maxDuration = 300;

/**
 * Only this app's own pages may start a run. Server actions check the origin themselves; a route
 * doesn't, and the SameSite=Lax cookie alone doesn't cover every browser and setup.
 */
function sameOrigin(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  // older browsers: compare Origin with the host the request came to (Vercel forwards it)
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json(fail('Forbidden'), { status: 403 });
  // proxy.ts guards this route too; check again, like /api/application
  if (!(await isValidToken((await cookies()).get(AUTH_COOKIE)?.value))) {
    return NextResponse.json(fail('Not logged in'), { status: 401 });
  }
  // no body: every scraper
  const body: unknown = await request.json().catch(() => null);
  const one = body === null ? null : scraperIdSchema.safeParse(body);
  if (one && !one.success) return NextResponse.json(fail('Bad request'), { status: 400 });
  try {
    const summary = await runAll('manual', { background: true, ...(one && { scraper: one.data.id }) });
    return NextResponse.json(ok(summary), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // e.g. the database is down before the run starts (the lock): the button shows why
    log.error('Manual scrape run failed', { route: '/api/scrape', error });
    return NextResponse.json(fail(message(error)), { status: 500 });
  }
}
