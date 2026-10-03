import 'server-only';
import * as offersRepo from './db/repos/offers';
import * as queueRepo from './db/repos/notify-queue';
import * as runsRepo from './db/repos/scrape-runs';
import * as stateRepo from './db/repos/scrape-state';
import { first } from './db/rows';

// What the pages show that changes without you doing anything there: a scrape (its run, new
// offers), a Telegram command (mute, send). AutoRefresh asks for this once a minute and refreshes
// the page only when it differs. Your own changes refresh the page by themselves (server actions).

/** A fingerprint of that: equal = nothing new to show. */
export async function dataVersion(): Promise<string> {
  const [state, runs, newest, queued] = await Promise.all([
    stateRepo.get(),
    runsRepo.list(1),
    offersRepo.newestFirstSeen(),
    queueRepo.size(),
  ]);
  const run = first(runs);
  return JSON.stringify([
    { lastRunAt: state.lastRunAt, lockedUntil: state.lockedUntil, muted: state.muted },
    run
      ? { id: run.id, finishedAt: run.finishedAt, added: run.added, matched: run.matched, notified: run.notified }
      : null,
    newest,
    queued,
  ]);
}
