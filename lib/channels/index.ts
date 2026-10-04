import 'server-only';
import { offerKey } from '../listings/pipeline/model';
import { log } from '../log';
import { message } from '../shared/errors';
import { pushChannel } from './push';
import { telegramChannel } from './telegram';
import { offersOf, type Batch, type Channel } from './types';

// The notification channels: where a batch of new offers goes. The queue, mute and the AI check
// (lib/listings/pipeline/notify.ts) decide what's in the batch; every ready channel gets the same one.

export type { Batch, Channel } from './types';

export const CHANNELS: readonly Channel[] = [telegramChannel, pushChannel];

/** The channels that are set up and have someone to send to (one that can't tell isn't). */
export async function activeChannels(channels: readonly Channel[] = CHANNELS): Promise<Channel[]> {
  const ready = await Promise.all(
    channels.map(async (channel) => {
      try {
        return await channel.ready();
      } catch (error) {
        log.warn('Notify: a channel couldn’t tell whether it is ready', { channel: channel.name, error });
        return false;
      }
    }),
  );
  return channels.filter((_, i) => ready[i]);
}

/**
 * Sends the batch through every channel at once; one failing (or throwing) doesn't stop the others.
 * `unsent`: what no channel got to you, to go back into the queue; `errors`: each failed channel's.
 */
export async function deliver(
  channels: readonly Channel[],
  batch: Batch,
): Promise<{ unsent: Batch['unmatched']; errors: string[] }> {
  const offers = offersOf(batch);
  const deliveries = await Promise.all(
    channels.map(async (channel) => {
      try {
        return await channel.send(batch);
      } catch (error) {
        return { unsent: offers, error: `${channel.name}: ${message(error)}` };
      }
    }),
  );
  const missed = deliveries.map((delivery) => new Set(delivery.unsent.map(offerKey)));
  return {
    unsent: offers.filter((offer) => missed.every((keys) => keys.has(offerKey(offer)))),
    errors: deliveries.flatMap((delivery) => (delivery.error ? [delivery.error] : [])),
  };
}
