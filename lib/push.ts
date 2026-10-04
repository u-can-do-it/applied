import 'server-only';
import https from 'node:https';
import webpush from 'web-push';
import * as pushRepo from './db/repos/push-subscriptions';
import { env } from './env';
import { log } from './log';
import { checkedLookup } from './outbound';
import { message } from './shared/errors';
import { isPushEndpoint } from './shared/schemas/push';

// Web Push: notifications on the devices that said yes in Settings → Notifications (their browser
// subscribed with the push service and gave us its endpoint and keys, push_subscriptions). Each
// message is encrypted for the device and signed with the VAPID keys (VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT); public/sw.js shows it. Off while any of the three is unset.
//
// Where it sends: a subscription's endpoint, the URL the browser got from its push service. The
// browser sends it, so it's checked like any URL from outside (the SSRF policy, docs/OPERATIONS.md):
// it must be https on a known push service's host (isPushEndpoint, when subscribing and before every
// send; any other is deleted), and in production the connection only goes to an address
// lib/outbound.ts's checkedLookup lets through (no private, loopback or metadata address, also after
// a DNS change). web-push makes the request itself (node:https), so not fetchOutbound(); it gives up
// after PUSH_TIMEOUT_MS.

const PUSH_TIMEOUT_MS = 10_000;
const TIMED_OUT = `no answer within ${PUSH_TIMEOUT_MS / 1000} s`;
/** how long the push service keeps a message for a device that's offline: news older than a day isn't worth it */
const TTL_SECONDS = 24 * 3600;

export type PushPayload = {
  title: string;
  body: string;
  /** where tapping it opens the app (a path) */
  url: string;
};

/** What a send did: devices that got it, subscriptions removed (expired), devices that failed. */
export type PushResult = { delivered: number; removed: number; failed: number; error?: string };

/** The three VAPID variables, if they're all set and well-formed. */
function vapid(): { subject: string; publicKey: string; privateKey: string } | null {
  try {
    const { VAPID_SUBJECT: subject, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
    return subject && publicKey && privateKey ? { subject, publicKey, privateKey } : null;
  } catch {
    return null; // malformed: pushProblem() says which
  }
}

export const pushConfigured = () => vapid() !== null;

/** The key a browser subscribes with (it's public), or null when push is off. */
export const vapidPublicKey = () => vapid()?.publicKey ?? null;

/** Why push is off, for the Health card: a missing or malformed variable; null when it's on. */
export function pushProblem(): string | null {
  const names = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const;
  const missing: string[] = [];
  for (const name of names) {
    try {
      if (!env[name]) missing.push(name);
    } catch (error) {
      return message(error); // "VAPID_SUBJECT is not a mailto: address or an https:// URL"
    }
  }
  if (missing.length === names.length) return 'not set';
  return missing.length ? `${missing.join(', ')} not set` : null;
}

let agent: https.Agent | undefined;
/** In production, the connections check the addresses they connect to (as fetchOutbound()'s do). */
export function pushAgent(): https.Agent | undefined {
  if (env.NODE_ENV !== 'production') return undefined;
  return (agent ??= new https.Agent({ lookup: checkedLookup }));
}

/** the push service's host, what the logs say instead of the endpoint (which identifies the device) */
const serviceOf = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return '(not a URL)';
  }
};

/** the push service's answer to a failed send, if it gave one (web-push's WebPushError) */
const statusOf = (error: unknown) => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : null;
};

/** `error`: what the user may see (no network details); `detail`: what the log gets. */
type Outcome = { status: 'sent' } | { status: 'gone' } | { status: 'failed'; error: string; detail: string };

async function sendOne(
  subscription: pushRepo.PushSubscription,
  body: string,
  keys: NonNullable<ReturnType<typeof vapid>>,
): Promise<Outcome> {
  // not a push service's: never sent to, and deleted (saved before the check, or put there by hand)
  if (!isPushEndpoint(subscription.endpoint)) return { status: 'gone' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMED_OUT)), PUSH_TIMEOUT_MS);
  });
  const agent = pushAgent();
  try {
    await Promise.race([
      webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        body,
        {
          vapidDetails: keys,
          TTL: TTL_SECONDS,
          urgency: 'normal',
          timeout: PUSH_TIMEOUT_MS, // web-push's own: the socket's idle time
          ...(agent && { agent }),
        },
      ),
      late,
    ]);
    return { status: 'sent' };
  } catch (error) {
    const status = statusOf(error);
    // the subscription expired or was revoked (the app uninstalled, the site's data cleared): it's no more
    if (status === 404 || status === 410) return { status: 'gone' };
    if (status) return { status: 'failed', error: `the push service answered ${status}`, detail: `HTTP ${status}` };
    const detail = message(error);
    // a network error's words (ECONNREFUSED, ENOTFOUND, a refused address) stay in the log
    const shown =
      detail === TIMED_OUT ? 'the push service didn’t answer in time' : 'the push service couldn’t be reached';
    return { status: 'failed', error: shown, detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one notification to every subscribed device (or to these), at once. A subscription the push
 * service says is gone (404, 410) is removed; another failure is logged and counted.
 */
export async function sendPush(payload: PushPayload, subscriptions?: pushRepo.PushSubscription[]): Promise<PushResult> {
  const keys = vapid();
  if (!keys) return { delivered: 0, removed: 0, failed: 0, error: 'Push isn’t set up (VAPID keys).' };
  const devices = subscriptions ?? (await pushRepo.list());
  const body = JSON.stringify(payload);
  const outcomes = await Promise.all(devices.map((device) => sendOne(device, body, keys)));
  const result: PushResult = { delivered: 0, removed: 0, failed: 0 };
  for (const [i, outcome] of outcomes.entries()) {
    const pushService = serviceOf(devices[i].endpoint);
    if (outcome.status === 'sent') result.delivered++;
    else if (outcome.status === 'gone') {
      result.removed++;
      await pushRepo.remove(devices[i].endpoint).catch((error: unknown) => {
        log.error('Push: removing an expired subscription failed', { pushService, error });
      });
      log.info('Push: a subscription expired, removed it', { pushService });
    } else {
      result.failed++;
      result.error ??= `Push: ${outcome.error}`;
      log.warn('Push: sending failed', { pushService, error: outcome.detail });
    }
  }
  return result;
}
