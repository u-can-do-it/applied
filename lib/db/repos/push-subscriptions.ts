import 'server-only';
import { count, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { first } from '../rows';
import { pushSubscriptions, type PushSubscriptionRow } from '../schema';

// The browsers that get push notifications, one per push service endpoint.

export type PushSubscription = Pick<PushSubscriptionRow, 'endpoint' | 'p256dh' | 'auth'>;

/** Adds the browser, or updates its keys and device if it's there already (a re-subscribe). */
export async function save(subscription: PushSubscription & { userAgent: string | null }) {
  await db()
    .insert(pushSubscriptions)
    .values(subscription)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sql`excluded.p256dh`, auth: sql`excluded.auth`, userAgent: sql`excluded.user_agent` },
    });
}

export async function remove(endpoint: string) {
  await db().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export function list(): Promise<PushSubscription[]> {
  return db()
    .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions);
}

/** This browser's, or null. */
export async function get(endpoint: string): Promise<PushSubscription | null> {
  return first(
    await db()
      .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint)),
  );
}

export async function size(): Promise<number> {
  const [{ devices }] = await db().select({ devices: count() }).from(pushSubscriptions);
  return devices;
}
