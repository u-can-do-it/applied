import 'server-only';
import { scrapeOfferFull } from '../../ads';
import * as missesRepo from '../../db/repos/keyword-misses';
import * as offersRepo from '../../db/repos/offers';
import { Deferred } from '../../pace';
import { message } from '../../shared/errors';
import { fold, keywordTest } from '../match';
import type { Found } from '../types';

// Part of step 1 (fetch.ts), for a board whose search reads the whole ad while its cards have no skills
// (its listing's keywordsInAd: LinkedIn): an offer whose title names none of the keywords, and that passed
// the other filters, is kept when its ad names one. Each ad is read once: an offer kept before is in
// `offers` already, one whose ad named none is in keyword_misses (for these keywords).
// One read at a time, at most MAX_READS a run, and none after one that fails or comes back empty (the board
// is turning the server away: its login wall has no ad), nor past the deadline or the board's batch
// (lib/pace.ts): the rest wait for the scraper's follow-up (follow-up.ts), or the next run, whose {since}
// still reaches back to them, as this run doesn't count as complete.

/**
 * Ads read per scraper and run: LinkedIn served a login wall after some twenty in a row (Oct 2026), so a
 * morning's backlog is read over a few runs, not in one burst; a run between has a handful new.
 */
export const MAX_READS = 10;

export type AdCheck = {
  /** the ad names a keyword, or the offer was kept before */
  kept: Found[];
  /** the ad names none: read now, or before */
  missed: number;
  /** ads read now */
  read: number;
  /** not decided: they wait for later */
  left: number;
  /** those offers */
  unread: Found[];
  /** why the reads stopped before the deadline, MAX_READS or the board's batch */
  error: string | null;
};

/** The keywords as keyword_misses records them (folded, unique, sorted): a miss counts for the same ones only. */
export const keywordsKey = (keywords: string[]) =>
  [...new Set(keywords.map((keyword) => fold(keyword.trim())).filter(Boolean))].sort().join('\n');

/** `offers`: one board's, each once. Throws only when the database does. */
export async function checkAds(offers: Found[], keywords: string[], deadline: number): Promise<AdCheck> {
  if (!offers.length) return { kept: [], missed: 0, read: 0, left: 0, unread: [], error: null };
  const { src } = offers[0];
  const key = keywordsKey(keywords);
  const ids = offers.map((offer) => offer.id);
  const [known, missedBefore] = await Promise.all([offersRepo.knownIds(src, ids), missesRepo.find(src, ids, key)]);
  const kept = offers.filter((offer) => known.has(offer.id));
  const toRead = offers.filter((offer) => !known.has(offer.id) && !missedBefore.has(offer.id));
  const named = keywordTest(keywords);
  const missed: string[] = [];
  const decided = new Set<string>();
  let read = 0;
  let error: string | null = null;
  for (const offer of toRead.slice(0, MAX_READS)) {
    if (Date.now() >= deadline) break;
    try {
      const ad = await scrapeOfferFull(offer);
      if (ad.status === 'empty') throw new Error('it came back empty (a login wall?)');
      read++;
      decided.add(offer.id);
      if (named([ad.text])) kept.push(offer);
      else missed.push(offer.id);
    } catch (failure) {
      if (!(failure instanceof Deferred)) error = `"${offer.title}": ${message(failure)}`;
      break;
    }
  }
  await missesRepo.save(src, missed, key);
  return {
    kept,
    missed: missedBefore.size + missed.length,
    read,
    left: toRead.length - read,
    unread: toRead.filter((offer) => !decided.has(offer.id)),
    error,
  };
}
