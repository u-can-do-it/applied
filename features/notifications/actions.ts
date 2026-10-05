'use server';

import { headers } from 'next/headers';
import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { notify } from '@/lib/listings/pipeline/notify';
import * as pushRepo from '@/lib/db/repos/push-subscriptions';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { pushConfigured, sendPush } from '@/lib/push';
import { message } from '@/lib/shared/errors';
import { noInput } from '@/lib/shared/schemas/common';
import { endpointSchema, pushSubscriptionSchema } from '@/lib/shared/schemas/push';
import { mutedSchema, switchSchema } from '@/lib/shared/schemas/settings';

// Settings → Notifications: what goes to every channel (Telegram, push), and this device's push
// subscription. The answers that say something ("Sent.") are their data; the rest answer with nothing.

const NO_CHANNEL = 'Nothing to send it with: set up Telegram and switch it on, or enable notifications on a device.';

export const setNotifyAction = action(switchSchema, async ({ on }) => {
  await settingsRepo.save({ ...(await settingsRepo.get()), notify: on });
  refresh();
});

export const setAiFilterAction = action(switchSchema, async ({ on }) => {
  await settingsRepo.save({ ...(await settingsRepo.get()), aiFilter: on });
  refresh();
});

/** Unmuting sends what waited right away (not after the answer), so the page shows an empty queue. */
export const setMutedAction = action(mutedSchema, async ({ muted }) => {
  await stateRepo.setMuted(muted);
  const sent: { sent: number; error?: string; warning?: string } = muted
    ? { sent: 0 }
    : await notify({ manual: true }).catch((failure: unknown) => ({ sent: 0, error: message(failure) }));
  refresh();
  if (sent.error) throw new Error(`Unmuted, but: ${sent.error}`);
  if (muted) return 'Muted: new offers wait in the queue.';
  // a channel failed but another sent them: done, with what failed
  if (sent.warning) return { warning: `Unmuted, sent ${sent.sent}; ${sent.warning}` };
  return sent.sent ? `Unmuted, sent ${sent.sent}.` : 'Unmuted.';
});

export const sendQueueAction = action(noInput, async () => {
  const sent = await notify({ manual: true });
  refresh();
  if (sent.error) throw new Error(sent.error);
  if (sent.noChannel) throw new Error(NO_CHANNEL);
  if (sent.warning) return { warning: `Sent ${sent.sent}; ${sent.warning}` };
  return sent.sent
    ? `Sent ${sent.sent}.`
    : sent.matched === 0
      ? 'Sent: none of them matched the AI profile.'
      : 'Nothing to send yet.';
});

/** This browser said yes: keep its subscription (again, if it's there: the keys may have changed). */
export const pushSubscribeAction = action(pushSubscriptionSchema, async ({ endpoint, keys }) => {
  if (!pushConfigured()) throw new Error('Push isn’t set up on the server: VAPID keys are missing.');
  const userAgent = (await headers()).get('user-agent')?.slice(0, 300) ?? null;
  await pushRepo.save({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent });
  refresh();
  return 'Notifications are on for this device.';
});

export const pushUnsubscribeAction = action(endpointSchema, async ({ endpoint }) => {
  await pushRepo.remove(endpoint);
  refresh();
  return 'Notifications are off for this device.';
});

/** One notification to this device only. */
export const pushTestAction = action(endpointSchema, async ({ endpoint }) => {
  const device = await pushRepo.get(endpoint);
  if (!device) throw new Error('This device isn’t subscribed any more: enable it again.');
  const result = await sendPush({ title: 'Jobwatch', body: 'Notifications work on this device.', url: '/settings' }, [
    device,
  ]);
  if (result.removed) {
    refresh();
    throw new Error('The push service says this subscription expired: enable it again.');
  }
  if (!result.delivered) throw new Error(result.error ?? 'It wasn’t delivered.');
  return 'Sent: it should show in a moment.';
});
