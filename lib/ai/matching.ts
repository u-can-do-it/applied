// Which jobs in a list the AI is matching right now. A scrape run checks its new jobs against the active
// profile after saving them (lib/listings/run.ts, aiTail), and holds the scrape lock until that's done: so
// a job without a verdict that came in with the run still holding the lock is being matched. One left
// without a verdict once the lock is let go (its ad couldn't be read, OpenAI failed, the AI filter is off)
// isn't: nothing is matching it now, and the list mustn't wait for it.

type Checking = {
  /** the AI filter can work: on in Settings, a usable profile, an OpenAI key */
  aiOn: boolean;
  /** the scrape lock (scrape_state.locked_until): a run, or its AI check, is going on until then */
  lockedUntil: string | null;
  /** the latest scrape run: the one holding the lock, while it's held */
  run: { startedAt: string } | null;
  now: number;
};

/** When the scrape run whose AI check is still going started; null when none is. */
export function checkingSince({ aiOn, lockedUntil, run, now }: Checking): string | null {
  if (!aiOn || !run || !lockedUntil || Date.parse(lockedUntil) <= now) return null;
  return run.startedAt;
}

/** The job is being matched: no verdict yet, and it came in with the run still at its AI check. */
export const isMatching = (job: { firstSeen: string; ai?: unknown }, since: string | null): boolean =>
  !job.ai && since !== null && Date.parse(job.firstSeen) >= Date.parse(since);
