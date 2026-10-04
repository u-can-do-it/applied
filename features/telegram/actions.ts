'use server';

import { refresh } from 'next/cache';
import { action } from '@/server/action';
import { requestOrigin } from '@/lib/listings/schedule';
import { noInput } from '@/lib/shared/schemas/common';
import { connectWebhook, disconnectWebhook, sendMessage } from '@/lib/telegram';

// The Telegram panel's own: a test message and the bot's commands. What applies to every channel
// (sending on/off, mute, the queue, the AI filter) is in features/notifications/actions.ts.

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
