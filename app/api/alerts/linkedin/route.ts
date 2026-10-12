import { NextResponse, type NextRequest } from 'next/server';
import * as alertsRepo from '@/lib/db/repos/alert-jobs';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { linkedin } from '@/lib/boards/linkedin';
import { jobsInAlert } from '@/lib/listings/alert-email';
import { ALERTS_PATH, isAlertsRequest } from '@/lib/listings/gmail-alerts';
import { log } from '@/lib/log';

// POST /api/alerts/linkedin with "Authorization: Bearer <secret>" and {"html": "<one LinkedIn job alert
// email>"}: the Gmail script from Settings → LinkedIn alert emails sends each new one
// (lib/listings/gmail-alerts.ts). The jobs it links to wait in alert_jobs for the next scrape run, which
// reads and filters them like a scraper's offers (lib/listings/pipeline/alerts.ts). Every answer has
// "jobwatch" in it, as the cron's.

/** an email's HTML is ~100 kB; anything near this isn't one */
const MAX_HTML = 2_000_000;

export async function POST(request: NextRequest) {
  if (!(await isAlertsRequest(request))) return NextResponse.json({ jobwatch: 'unauthorized' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const html = body && typeof body === 'object' && 'html' in body ? body.html : null;
  if (typeof html !== 'string' || html.length > MAX_HTML)
    return NextResponse.json({ jobwatch: 'bad request', error: 'Send {"html": "<the email>"}.' }, { status: 400 });

  const jobs = jobsInAlert(html);
  try {
    const added = await alertsRepo.add(linkedin.id, jobs);
    await stateRepo.markAlertEmail(jobs.length);
    // a LinkedIn email with no job in it: another kind of email, or a layout jobsInAlert doesn't know
    if (!jobs.length) log.warn('A LinkedIn email with no jobs in it', { route: ALERTS_PATH });
    return NextResponse.json({ jobwatch: 'ok', jobs: jobs.length, new: added });
  } catch (error) {
    log.error('Saving a LinkedIn alert email failed', { route: ALERTS_PATH, error });
    // not 200: the script throws, and sends this email again next time
    return NextResponse.json({ jobwatch: 'error' }, { status: 500 });
  }
}
