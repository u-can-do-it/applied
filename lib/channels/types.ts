import type { Queued } from '../db/repos/notify-queue';

// What a notification channel (Telegram, push) gets and answers. lib/channels/index.ts lists them.

/** An offer to announce; with the AI filter, its verdict. */
export type Outgoing = Queued & { verdict?: { score: number; summary: string | null } };

/** One send's worth of new offers, as every channel gets it. */
export type Batch = {
  matched: Outgoing[]; // everything new when the AI filter is off
  unmatched: Queued[];
  unchecked: Queued[]; // the AI couldn't check them in time
  profile: string | null; // the AI profile's name when the AI filter decided
  held: boolean; // sent by hand after a mute
};

/** What a channel couldn't get to you (it goes back into the queue unless another channel did), and why. */
export type Delivery = { unsent: Queued[]; error?: string };

export type Channel = {
  name: string;
  /** set up, and with someone to send to */
  ready: () => boolean | Promise<boolean>;
  send: (batch: Batch) => Promise<Delivery>;
};

/** Every offer in the batch. */
export const offersOf = (batch: Batch): Queued[] => [...batch.matched, ...batch.unmatched, ...batch.unchecked];
