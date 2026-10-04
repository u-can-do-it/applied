import 'server-only';
import { assessJobs, type Verdict } from '../../ai/runs';
import { AI_BUDGET_MS } from '../../budgets';
import { activeChannels, deliver } from '../../channels';
import type { Outgoing } from '../../channels/types';
import * as queueRepo from '../../db/repos/notify-queue';
import * as settingsRepo from '../../db/repos/scrape-settings';
import * as stateRepo from '../../db/repos/scrape-state';
import { log } from '../../log';
import { message } from '../../shared/errors';
import { aiProfile } from './ai-filter';
import { offerKey } from './model';

type QueuedAt = queueRepo.QueuedAt;

// Step 7, notify: what waits in the queue goes to every notification channel (Telegram, push;
// lib/channels), the AI's matches listed. Also called on its own: "Send now" in Settings and /send
// in Telegram.

/** an offer the AI couldn't check for this long goes out anyway, marked, instead of waiting forever */
const UNCHECKED_AFTER_MS = 20 * 60_000;

/**
 * `error`: nothing went out, or the AI check failed; `warning`: a channel failed but another delivered
 * (sent all the same); `noChannel`: nothing was sent because no channel is set up (or has a device).
 */
export type Notified = { sent: number; matched: number | null; error?: string; warning?: string; noChannel?: true };

/**
 * Checks what's queued against the AI profile and sends what's ready: the matches listed, the
 * rest as a count. Offers still waiting for a verdict stay queued for the next run. While muted
 * (and not sent by hand) nothing is sent, but the verdicts are made, so /send is quick.
 */
export async function notify(opts: { manual?: boolean; deadline?: number } = {}): Promise<Notified> {
  const queued = await queueRepo.list();
  if (!queued.length) return { sent: 0, matched: null };
  // no channel: the offers stay queued for when one is set up, and the AI isn't asked about them yet
  const channels = await activeChannels();
  if (!channels.length) return { sent: 0, matched: null, noChannel: true };
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
  const delivery = await deliver(channels, {
    matched,
    unmatched,
    unchecked,
    profile: profile?.name ?? null,
    held: Boolean(opts.manual && muted),
  });
  // what no channel got to you goes back into the queue with its own time, so it's tried again
  // (and still counts as waiting)
  const missed = new Set(delivery.unsent.map(offerKey));
  const unsent = claimed.filter((row) => missed.has(offerKey(row)));
  if (unsent.length)
    await queueRepo.enqueue(unsent).catch((failure: unknown) => {
      // they're lost to the channels (still in the database): say so where it can be seen
      log.error('Notify: putting unsent offers back in the queue failed', { offers: unsent.length, error: failure });
    });
  const sendError = delivery.errors.join('; ') || undefined;
  // a channel failed, but another got the offers to you: sent, with a warning
  const partly = sendError !== undefined && unsent.length < claimed.length;
  const failure = partly ? error : (sendError ?? error);
  return {
    sent: [...matched, ...unchecked].filter((row) => !missed.has(offerKey(row))).length,
    matched: profile ? matched.length : null,
    ...(partly ? { warning: sendError } : {}),
    ...(failure ? { error: failure } : {}),
  };
}
