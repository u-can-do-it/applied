import { after, NextResponse, type NextRequest } from 'next/server';
import { LOCK_SECONDS, runAll } from '@/lib/scraping/run';
import { checkDue, isCronRequest } from '@/lib/scraping/schedule';
import { lock } from '@/lib/scraping/store';

// GET or POST /api/cron/scrape with "Authorization: Bearer <secret>" (see lib/scraping/schedule.ts).
// Supabase Cron calls it every 5 minutes (Settings → Scraping → Connect). Interval, hours and the
// pause come from Settings, so the caller just knocks.
//   ?force=1  run even if not due     ?wait=1  answer with the result instead of right away
// Every answer has "jobwatch" in it: Settings finds Supabase Cron's last call by that.
export const maxDuration = 300;

async function handle(request: NextRequest) {
  if (!(await isCronRequest(request))) return NextResponse.json({ jobwatch: 'unauthorized' }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const due = q.get('force') === '1' ? { due: true } : await checkDue();
  if (!due.due) return NextResponse.json({ jobwatch: 'skipped', reason: due.reason });
  if (!(await lock(LOCK_SECONDS))) return NextResponse.json({ jobwatch: 'busy', reason: 'another run is still going' });
  if (q.get('wait') === '1') return NextResponse.json({ jobwatch: 'done', ...(await runAll('cron', { locked: true })) });
  // answer at once (Supabase Cron waits only a few seconds), scrape after the response
  after(() => runAll('cron', { locked: true }));
  return NextResponse.json({ jobwatch: 'started' }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
