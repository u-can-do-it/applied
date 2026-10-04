import type { Queued } from '../../db/repos/notify-queue';
import { placeOf, titleTest } from '../match';
import type { ScrapeSettings } from '../settings';
import { offerKey, toNewOffer, type AddedOffer, type Owners } from './model';

// Step 4, selectAnnouncable (pure): which of the offers new to the database are worth a message.

/** The new offers to queue for the notifications (Telegram, push), one per job. */
export function selectAnnouncable(
  added: readonly AddedOffer[],
  owners: Owners,
  settings: Pick<ScrapeSettings, 'mute' | 'cities'>,
): Queued[] {
  const muted = titleTest(settings.mute);
  const titleKeys = new Set<string>();
  const fresh: Queued[] = [];
  for (const row of added) {
    const own = owners.get(offerKey(row));
    if (!own) continue;
    if (own.scraper.mark === null) continue; // the scraper's first run only saves
    if (own.offer.sort !== undefined && own.offer.sort <= own.scraper.mark) continue; // an old offer bumped up again
    if (row.seenBefore || titleKeys.has(row.titleKey)) continue; // the same job, already seen on another board
    if (muted(own.offer.title)) continue; // a stack you don't want to hear about
    titleKeys.add(row.titleKey);
    // a title key never seen before is its job's id
    fresh.push({ ...toNewOffer(own.offer), location: placeOf(own.offer, settings.cities), jobId: row.titleKey });
  }
  return fresh;
}

/**
 * The jobs (their ids) that get the AI's verdict: every new one (not another board's offer of a
 * known one), also the ones that aren't announced (a scraper's first run, a muted title): the AI
 * tab has them checked. A title key never seen before is its job's id.
 */
export const newJobs = (added: readonly AddedOffer[]): string[] => [
  ...new Set(added.filter((row) => !row.seenBefore).map((row) => row.titleKey)),
];
