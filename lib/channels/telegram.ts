import 'server-only';
import * as settingsRepo from '../db/repos/scrape-settings';
import { env } from '../env';
import { offerKey } from '../listings/pipeline/model';
import { message } from '../shared/errors';
import { formatNotification, sendMessage, telegramReady } from '../telegram';
import { offersOf, type Channel } from './types';

/** the app's AI tab, to look at what didn't match (Telegram's messages only count those) */
const appLink = () =>
  env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}/ai?days=1&rejected=1` : null;

/**
 * Telegram: one block per board, five offers per message, a pause between messages. Ready when it's set
 * up and not switched off in Settings ("Send to Telegram").
 */
export const telegramChannel: Channel = {
  name: 'Telegram',
  ready: async () => telegramReady() && (await settingsRepo.get()).telegramEnabled,
  async send(batch) {
    const messages = formatNotification({ ...batch, link: appLink() });
    for (let i = 0; i < messages.length; i++) {
      try {
        await sendMessage(messages[i].text);
      } catch (error) {
        // this message and the ones after it didn't go out
        const left = new Set(messages.slice(i).flatMap((unsent) => unsent.offers.map(offerKey)));
        return { unsent: offersOf(batch).filter((offer) => left.has(offerKey(offer))), error: message(error) };
      }
      if (i < messages.length - 1) await new Promise((resolve) => setTimeout(resolve, 400)); // Telegram: about 1 message/s per chat
    }
    return { unsent: [] };
  },
};
