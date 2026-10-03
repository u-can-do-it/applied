'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { notify } from '@/lib/listings/pipeline/notify';
import { requestOrigin } from '@/lib/listings/schedule';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import * as stateRepo from '@/lib/db/repos/scrape-state';
import { message } from '@/lib/shared/errors';
import { noInput } from '@/lib/shared/schemas/common';
import { mutedSchema, switchSchema } from '@/lib/shared/schemas/settings';
import { connectWebhook, disconnectWebhook, sendMessage, telegramReady } from '@/lib/telegram';

// The answers that say something ("Sent.") are their data; the rest answer with nothing.

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
  const sent: { sent: number; error?: string } =
    !muted && telegramReady()
      ? await notify({ manual: true }).catch((failure: unknown) => ({ sent: 0, error: message(failure) }))
      : { sent: 0 };
  refresh();
  if (sent.error) throw new Error(`Unmuted, but: ${sent.error}`);
  return muted ? 'Muted: new offers wait in the queue.' : sent.sent ? `Unmuted, sent ${sent.sent}.` : 'Unmuted.';
});

export const sendQueueAction = action(noInput, async () => {
  const sent = await notify({ manual: true });
  refresh();
  if (sent.error) throw new Error(sent.error);
  return sent.sent
    ? `Sent ${sent.sent}.`
    : sent.matched === 0
      ? 'Sent: none of them matched the AI profile.'
      : 'Nothing to send yet.';
});

export const telegramTestAction = action(noInput, async () => {
  await sendMessage('✅ Jobwatch can write to this chat.');
  return 'Sent – check Telegram.';
});

export const telegramConnectAction = action(noInput, async () => {
  await connectWebhook(`${await requestOrigin()}/api/telegram`);
  refresh();
  return 'Connected. Try /status in the chat.';
});

export const telegramDisconnectAction = action(noInput, async () => {
  await disconnectWebhook();
  refresh();
  return 'Disconnected.';
});
