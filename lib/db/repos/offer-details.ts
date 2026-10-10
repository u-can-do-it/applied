import 'server-only';
import { not, sql } from 'drizzle-orm';
import { db } from '../client';
import { isOneOf } from '../rows';
import { offerDetails, type OfferDetailsRow } from '../schema';

// An offer's ad text, scraped once and reused: by every profile's AI run (cut to what the AI reads)
// and by the offer's window (complete, with the board's details).

export type Details = Pick<OfferDetailsRow, 'src' | 'id' | 'status' | 'description'>;
export type CompleteDetails = Details & Pick<OfferDetailsRow, 'details' | 'complete' | 'fetchedAt'>;

export async function forOffers(offers: { src: string; id: string }[]): Promise<CompleteDetails[]> {
  if (!offers.length) return [];
  return db()
    .select({
      src: offerDetails.src,
      id: offerDetails.id,
      status: offerDetails.status,
      description: offerDetails.description,
      details: offerDetails.details,
      complete: offerDetails.complete,
      fetchedAt: offerDetails.fetchedAt,
    })
    .from(offerDetails)
    .where(isOneOf(offerDetails.src, offerDetails.id, offers));
}

/**
 * An AI run's: saves them; an offer scraped again gets the new text (fetched_at stays the first
 * time's), unless the window saved it complete meanwhile.
 */
export async function save(rows: Details[]) {
  if (!rows.length) return;
  await db()
    .insert(offerDetails)
    .values(rows)
    .onConflictDoUpdate({
      target: [offerDetails.src, offerDetails.id],
      set: { description: sql`excluded.description`, status: sql`excluded.status` },
      setWhere: not(offerDetails.complete),
    });
}

/** The window's: the complete ad and the board's details, fetched now. */
export async function saveComplete(row: Omit<CompleteDetails, 'complete' | 'fetchedAt'>) {
  const values = { ...row, complete: true, fetchedAt: sql`now()` };
  await db()
    .insert(offerDetails)
    .values(values)
    .onConflictDoUpdate({ target: [offerDetails.src, offerDetails.id], set: values });
}
