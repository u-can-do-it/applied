import { offerKey, type Fetched, type Owned, type Owners } from './model';

// Step 2, pickOwners (pure).

/**
 * The first scraper that found an offer owns it (two searches on one board find the same ones):
 * it's saved once, and counted as new for that scraper only.
 */
export function pickOwners(fetched: readonly Fetched[]): Owners {
  const owners = new Map<string, Owned>();
  for (const { scraper, result } of fetched) {
    for (const offer of result.kept) {
      const key = offerKey(offer);
      const had = owners.get(key);
      if (!had) owners.set(key, { offer, scraper });
      // e.g. LinkedIn's "Warszawa" search doesn't say remote, its "remote only" one does
      else if (offer.remote && !had.offer.remote) owners.set(key, { ...had, offer: { ...had.offer, remote: true } });
    }
  }
  return owners;
}
