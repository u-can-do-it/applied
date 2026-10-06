import 'server-only';
import * as settingsRepo from '../db/repos/scrape-settings';
import { env } from '../env';
import { message } from '../shared/errors';
import { formatNotification, sendMessage, telegramReady } from '../telegram';
import type { Channel } from './types';

/** "+ 12 more": only what the latest run brought */
const NEW_OFFERS_PATH = '/?new=1';

/** a page of the app, for the links in the message */
const appUrl = (path: string) =>
  env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}${path}` : null;

/**
 * Telegram: one message per batch, one block per board in it. Ready when it's set up and not switched
 * off in Settings ("Send to Telegram").
 */
export const telegramChannel: Channel = {
  name: 'Telegram',
  ready: async () => telegramReady() && (await settingsRepo.get()).telegramEnabled,
  async send(batch) {
    const notification = formatNotification({
      ...batch,
      link: appUrl('/?days=1&fit=rejected'), // the offers the AI rejected, to look at what didn't match (only counted here)
      more: appUrl(NEW_OFFERS_PATH),
    });
    if (!notification) return { unsent: [] };
    try {
      await sendMessage(notification.text);
    } catch (error) {
      return { unsent: notification.offers, error: message(error) };
    }
    return { unsent: [] };
  },
};
