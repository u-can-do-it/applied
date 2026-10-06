import 'server-only';
import * as pushRepo from '../db/repos/push-subscriptions';
import { pushConfigured, sendPush, type PushPayload } from '../push';
import { offersOf, type Batch, type Channel, type Outgoing } from './types';

/** where tapping a notification leads: the offers list, all of it, as the app opens (the new ones marked) */
export const OFFERS_PATH = '/';
const LISTED = 4; // offers named in the text; Android shows about that many lines expanded

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const named = (offer: Outgoing) => (offer.company ? `${offer.title} @ ${offer.company}` : offer.title);

/** "React Senior @ Acme, Frontend Dev @ Beta, … +3 more" */
function list(offers: Outgoing[]) {
  const names = offers.slice(0, LISTED).map((offer) => named(offer).slice(0, 80));
  const more = offers.length - names.length;
  return `${names.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
}

/**
 * One notification for the whole batch: how many new offers, the ones worth a look named (all of
 * them without the AI filter, its matches with it, and what it couldn't check), the rest counted.
 * Null when there's nothing in it.
 */
export function formatPush(batch: Batch): PushPayload | null {
  const total = offersOf(batch).length;
  if (!total) return null;
  const lines: string[] = [];
  let title = plural(total, 'new offer');
  if (batch.profile === null) lines.push(list(batch.matched));
  else {
    if (batch.matched.length) {
      title = `${title}, ${batch.matched.length} matching “${batch.profile}”`;
      lines.push(list(batch.matched));
    } else if (!batch.unchecked.length) lines.push(`None matched “${batch.profile}”.`);
    if (batch.unchecked.length) lines.push(`Not checked by the AI: ${list(batch.unchecked)}`);
  }
  if (batch.held) lines.push('Held while muted.');
  return { title, body: lines.join('\n'), url: OFFERS_PATH };
}

/** Web Push: one notification per batch, on every subscribed device. */
export const pushChannel: Channel = {
  name: 'Push',
  ready: async () => pushConfigured() && (await pushRepo.size()) > 0,
  async send(batch) {
    const payload = formatPush(batch);
    if (!payload) return { unsent: [] };
    const result = await sendPush(payload);
    // one device that got it is enough: the others failing is in the logs
    if (result.delivered) return { unsent: [] };
    return { unsent: offersOf(batch), error: result.error ?? 'Push: no subscribed device got it.' };
  },
};
