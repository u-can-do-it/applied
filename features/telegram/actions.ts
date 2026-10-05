'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import * as settingsRepo from '@/lib/db/repos/scrape-settings';
import { requestOrigin } from '@/lib/listings/schedule';
import { noInput } from '@/lib/shared/schemas/common';
import { switchSchema } from '@/lib/shared/schemas/settings';
import { connectWebhook, disconnectWebhook, sendMessage } from '@/lib/telegram';

// The Telegram panel's own: Telegram on or off, a test message and the bot's commands. What applies to
// every channel (sending on/off, mute, the queue, the AI filter) is in features/notifications/actions.ts.

const TELEGRAM_OFF = 'Telegram is switched off: turn on “Send to Telegram” first.';

/** Off: no messages about new offers and commands ignored; the bot, its webhook and the env stay. */
export const setTelegramEnabledAction = action(switchSchema, async ({ on }) => {
  await settingsRepo.save({ ...(await settingsRepo.get()), telegramEnabled: on });
  refresh();
});

export const telegramTestAction = action(noInput, async () => {
  if (!(await settingsRepo.get()).telegramEnabled) throw new Error(TELEGRAM_OFF);
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
