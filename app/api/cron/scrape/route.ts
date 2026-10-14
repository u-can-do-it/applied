import { after, NextResponse, type NextRequest } from 'next/server';
import { continueWaitingRuns } from '@/lib/ai/runs';
import { SCRAPE_LOCK_SECONDS, SLICE_MS } from '@/lib/budgets';
import { runAll } from '@/lib/listings/run';
import { checkDue, isCronRequest } from '@/lib/listings/schedule';
import { lock } from '@/lib/db/repos/scrape-state';
import { log } from '@/lib/log';

// GET or POST /api/cron/scrape with "Authorization: Bearer <secret>" (see lib/listings/schedule.ts).
// Supabase Cron calls it on the schedule Settings makes (the interval within the hours; paused =
// no calls), and the app checks again whether a run is due (lib/listings/schedule.ts).
//   ?force=1  run even if not due     ?wait=1  answer with the result instead of right away
// A knock between the runs may start a follow-up instead: what LinkedIn's scrapers couldn't read in the
// run before (lib/listings/pipeline/follow-up.ts); it doesn't move the schedule.
// Every answer has "jobwatch" in it: Settings finds Supabase Cron's last call by that.
//
// After the scrape (or instead of it, when none is due), the same call continues the open AI runs
// no slice is working on, in what's left of this function's time: a run goes on without Settings open.
export const maxDuration = 300;

const ROUTE = '/api/cron/scrape';

async function handle(request: NextRequest) {
  const startedAt = Date.now();
  if (!(await isCronRequest(request))) return NextResponse.json({ jobwatch: 'unauthorized' }, { status: 401 });

  // no new AI round after SLICE_MS from this call's start: the last one and the wrap-up still fit
  const continueAi = () =>
    continueWaitingRuns(startedAt + SLICE_MS).then(
      (continued) => {
        if (continued) log.info('AI runs continued by the cron', { route: ROUTE, continued });
      },
      (error: unknown) => log.error('Continuing AI runs failed', { route: ROUTE, error }),
    );
  const params = request.nextUrl.searchParams;
  const due: Awaited<ReturnType<typeof checkDue>> = params.get('force') === '1' ? { due: true } : await checkDue();
  const followUp = due.followUp === true;
  const run = () => (followUp ? runAll('follow-up', { locked: true, followUp }) : runAll('cron', { locked: true }));
  const scrape = () =>
    run().catch((error: unknown) => {
      log.error('Cron scrape run failed', { route: ROUTE, error });
      return null;
    });

  if (!due.due) {
    after(continueAi);
    return NextResponse.json({ jobwatch: 'skipped', reason: due.reason });
  }
  if (!(await lock(SCRAPE_LOCK_SECONDS, !followUp))) {
    after(continueAi);
    return NextResponse.json({ jobwatch: 'busy', reason: 'another run is still going' });
  }
  if (params.get('wait') === '1') {
    const summary = await run();
    after(continueAi);
    return NextResponse.json({ jobwatch: 'done', ...(followUp && { followUp }), ...summary });
  }
  // answer at once (Supabase Cron waits only a few seconds), scrape after the response, then the AI runs
  after(async () => {
    await scrape();
    await continueAi();
  });
  return NextResponse.json({ jobwatch: 'started', ...(followUp && { followUp }) }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
