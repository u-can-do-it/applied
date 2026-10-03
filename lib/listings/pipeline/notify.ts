import 'server-only';
import { assessJobs, type Verdict } from '../../ai/runs';
import { AI_BUDGET_MS } from '../../budgets';
import * as queueRepo from '../../db/repos/notify-queue';
import * as settingsRepo from '../../db/repos/scrape-settings';
import * as stateRepo from '../../db/repos/scrape-state';
import { env } from '../../env';
import { message } from '../../shared/errors';
import { formatNotification, sendMessage, type Outgoing } from '../../telegram';
import { aiProfile } from './ai-filter';
import { offerKey } from './model';

type QueuedAt = queueRepo.QueuedAt;

// Step 7, notify: what waits in the queue goes to Telegram, the AI's matches listed. Also called on
// its own: "Send now" in Settings and /send in Telegram.

/** an offer the AI couldn't check for this long goes out anyway, marked, instead of waiting forever */
const UNCHECKED_AFTER_MS = 20 * 60_000;

type Notified = { sent: number; matched: number | null; error?: string };

const appLink = () =>
  env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}/ai?days=1&rejected=1` : null;

/**
 * Checks what's queued against the AI profile and sends what's ready: the matches listed, the
 * rest as a count. Offers still waiting for a verdict stay queued for the next run. While muted
 * (and not sent by hand) nothing is sent, but the verdicts are made, so /send is quick.
 */
export async function notify(opts: { manual?: boolean; deadline?: number } = {}): Promise<Notified> {
  const queued = await queueRepo.list();
  if (!queued.length) return { sent: 0, matched: null };
  const settings = await settingsRepo.get();
  let error: string | undefined;
  const profile = await aiProfile(settings).catch((failure: unknown) => ((error = message(failure)), null));
  let verdicts = new Map<string, Verdict>();
  if (profile) {
    try {
      const assessed = await assessJobs(
        profile,
        [...new Set(queued.flatMap((row) => row.jobId ?? []))],
        opts.deadline ?? Date.now() + AI_BUDGET_MS,
      );
      verdicts = assessed.verdicts;
      if (assessed.error) error = assessed.error;
    } catch (failure) {
      error = message(failure);
    }
  }
  const muted = (await stateRepo.get()).muted;
  if (muted && !opts.manual) return { sent: 0, matched: null, ...(error ? { error } : {}) };

  const waited = (row: QueuedAt) => Date.now() - Date.parse(row.queuedAt) > UNCHECKED_AFTER_MS;
  const ready = queued.filter((row) => !profile || !row.jobId || verdicts.has(row.jobId) || waited(row));
  // nothing decided yet (e.g. OpenAI is down): no "0 matched" in the log, just the error
  if (!ready.length) return { sent: 0, matched: null, ...(error ? { error } : {}) };
  const claimed = await queueRepo.claim(ready); // only the ones no other sender took meanwhile

  const matched: Outgoing[] = [];
  const unmatched: QueuedAt[] = [];
  const unchecked: QueuedAt[] = [];
  for (const row of claimed) {
    const verdict = profile && row.jobId ? verdicts.get(row.jobId) : undefined;
    if (!profile) matched.push(row);
    else if (!verdict) unchecked.push(row);
    else if (verdict.match) matched.push({ ...row, verdict: { score: verdict.score, summary: verdict.summary } });
    else unmatched.push(row);
  }
  const messages = formatNotification({
    matched,
    unmatched,
    unchecked,
    profile: profile?.name ?? null,
    held: Boolean(opts.manual && muted),
    link: appLink(),
  });
  let sent = 0;
  for (let i = 0; i < messages.length; i++) {
    try {
      await sendMessage(messages[i].text);
    } catch (sendError) {
      // back into the queue with their own time, so they're tried again (and still count as waiting)
      const left = new Set(messages.slice(i).flatMap((unsent) => unsent.offers.map(offerKey)));
      await queueRepo.enqueue(claimed.filter((row) => left.has(offerKey(row)))).catch(() => {});
      return { sent, matched: profile ? matched.length : null, error: message(sendError) };
    }
    sent += messages[i].offers.length;
    if (i < messages.length - 1) await new Promise((resolve) => setTimeout(resolve, 400)); // Telegram: about 1 message/s per chat
  }
  return {
    sent: matched.length + unchecked.length,
    matched: profile ? matched.length : null,
    ...(error ? { error } : {}),
  };
}
