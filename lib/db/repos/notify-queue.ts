import 'server-only';
import { asc, count } from 'drizzle-orm';
import { db } from '../client';
import { isOneOf } from '../rows';
import { notifyQueue, type NotifyQueueRow } from '../schema';

// New jobs waiting to be sent to Telegram; while muted, they pile up.

/** An offer to send (jobId: its job, whose AI verdict decides if it's sent). */
export type Queued = Omit<NotifyQueueRow, 'queuedAt'>;
export type QueuedAt = NotifyQueueRow;

/** Adds them; one already queued stays as it is. With queuedAt (put back after a failed send) it keeps that time. */
export async function enqueue(rows: (Queued & { queuedAt?: string })[]) {
  if (!rows.length) return;
  await db()
    .insert(notifyQueue)
    .values(rows)
    .onConflictDoNothing({ target: [notifyQueue.src, notifyQueue.id] });
}

/** Oldest first. */
export function list(): Promise<QueuedAt[]> {
  return db().select().from(notifyQueue).orderBy(asc(notifyQueue.queuedAt));
}

/**
 * Takes these offers out of the queue and returns the ones it got (oldest first): two senders at
 * once never get the same offer, so nothing is sent twice.
 */
export async function claim(rows: { src: string; id: string }[]): Promise<QueuedAt[]> {
  if (!rows.length) return [];
  const claimed = await db()
    .delete(notifyQueue)
    .where(isOneOf(notifyQueue.src, notifyQueue.id, rows))
    .returning();
  return claimed.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function size(): Promise<number> {
  const [{ queued }] = await db().select({ queued: count() }).from(notifyQueue);
  return queued;
}
