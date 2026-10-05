import type { AddedOffer, NewOffer } from '../../db/repos/offers';
import type { Scraper } from '../../db/repos/scrapers';
import type { Found } from '../types';
import type { ScrapeResult } from './fetch';

// What flows between the scrape pipeline's steps (lib/listings/run.ts puts them together):
//
//   fetchListings → pickOwners → ingest → selectAnnouncable → recordOutcomes → (run log) → aiFilter → notify
//
// The steps in between the I/O ones are pure: owners.ts, announce.ts, outcomes.ts.

/** One enabled scraper and what its pages gave. */
export type Fetched = { scraper: Scraper; result: ScrapeResult };

/** An offer and the scraper that found it first. */
export type Owned = { offer: Found; scraper: Scraper };

/** Each offer found in this run (by offerKey), with its owner. */
export type Owners = ReadonlyMap<string, Owned>;

/** An offer the database didn't have before this run (offers.ingest). */
export type { AddedOffer };

/** What went wrong in a run; `warning`: it went through all the same (a channel failed, another sent). */
export type RunError = { scraper: string; error: string; warning?: true };

export type RunSummary = {
  skipped?: string;
  found: number;
  kept: number;
  added: number;
  fresh: number;
  notified: number;
  /** the AI check and the notifications still run, in the background */
  notifyLater?: boolean;
  errors: RunError[];
  ms: number;
};

/** One offer on one board. */
export const offerKey = (offer: { src: string; id: string }) => `${offer.src}\n${offer.id}`;

const clean = (value: string | null | undefined) =>
  value == null ? null : value.replace(/\u0000/g, '').trim() || null;

/* eslint-disable @typescript-eslint/no-non-null-assertion -- parseBody keeps only offers with an id and a link */
/** The offer as offers.ingest saves it. */
export const toNewOffer = (offer: Found): NewOffer => ({
  src: offer.src,
  id: clean(offer.id)!,
  title: clean(offer.title) ?? '(no title)',
  company: clean(offer.company),
  seniority: clean(offer.seniority),
  remote: offer.remote,
  url: clean(offer.url)!,
});
/* eslint-enable @typescript-eslint/no-non-null-assertion */
