import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '../client';
import { isOneOf } from '../rows';
import { offerDetails, type OfferDetailsRow } from '../schema';

// The full ad text of an offer, scraped once and reused by every profile.

export type Details = Pick<OfferDetailsRow, 'src' | 'id' | 'status' | 'description'>;

export async function forOffers(offers: { src: string; id: string }[]): Promise<Details[]> {
  if (!offers.length) return [];
  return db()
    .select({
      src: offerDetails.src,
      id: offerDetails.id,
      status: offerDetails.status,
      description: offerDetails.description,
    })
    .from(offerDetails)
    .where(isOneOf(offerDetails.src, offerDetails.id, offers));
}

/** Saves them; an offer scraped again gets the new text (fetched_at stays the first time's). */
export async function save(rows: Details[]) {
  if (!rows.length) return;
  await db()
    .insert(offerDetails)
    .values(rows)
    .onConflictDoUpdate({
      target: [offerDetails.src, offerDetails.id],
      set: { description: sql`excluded.description`, status: sql`excluded.status` },
    });
}
