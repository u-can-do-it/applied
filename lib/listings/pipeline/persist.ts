import 'server-only';
import * as offersRepo from '../../db/repos/offers';
import * as scrapersRepo from '../../db/repos/scrapers';
import { toNewOffer, type AddedOffer, type Owners } from './model';
import type { ScraperRunOutcome } from './outcomes';

// The pipeline's writes: step 3, ingest, and step 5, recordOutcomes.

/** Saves every owned offer; answers with the ones the database didn't have. */
export const ingest = (owners: Owners): Promise<AddedOffer[]> =>
  offersRepo.ingest([...owners.values()].map(({ offer }) => toNewOffer(offer)));

/** Each scraper's last-run status and watermark (Settings shows them; the next run reads the mark). */
export async function recordOutcomes(outcomes: readonly ScraperRunOutcome[]): Promise<void> {
  await Promise.all(outcomes.map(({ id, outcome }) => scrapersRepo.saveOutcome(id, outcome)));
}
