import 'server-only';
import * as detailsRepo from './db/repos/offer-details';
import * as jobNotesRepo from './db/repos/job-notes';
import * as offersRepo from './db/repos/offers';
import { adForAi, scrapeOfferFull } from './ads';
import { workModeOf, type JobDetails, type OfferLink } from './ads/details';
import { fitOf, getProfile, isUsable, listProfiles, type Fit } from './ai/profiles';
import { assessOne } from './ai/runs';
import { message } from './shared/errors';
import { NOTE_CONFLICT, NOTE_MAX } from './shared/schemas/applications';

// An offer's window (features/offers/offer-sheet.tsx): a job you haven't applied to, read like an
// application. Its ad complete, with the board's details: from offer_details when the window saved it
// before, else fetched now (its offers in order, earliest first, aggregators last) and saved, so the
// next opening and an AI run have it. Your note on it (job_notes), and the AI's verdict.

/** The ad as the window shows it: fields named as an application's, so the same parts show it. */
export type OfferAd = {
  content: string | null;
  contentStatus: 'ok' | 'empty' | 'failed';
  contentError: string | null;
  scrapedAt: string | null;
  details: JobDetails | null;
};
export type OfferWindow = OfferAd & { fit: Fit | null; note: string | null; noteUpdatedAt: string | null };

const NO_TEXT = 'The board page had no ad text.';

/** The job's ad: saved complete, else fetched now; an AI run's shorter copy when fetching fails. */
async function adOf(offers: OfferLink[]): Promise<OfferAd> {
  const saved = new Map((await detailsRepo.forOffers(offers)).map((row) => [`${row.src}\u0001${row.id}`, row]));
  let empty: OfferAd | null = null;
  let error: string | null = offers.length ? null : 'This job has no link.';
  for (const offer of offers) {
    const row = saved.get(`${offer.src}\u0001${offer.id}`);
    if (row?.complete) {
      const ad = { contentError: null, scrapedAt: row.fetchedAt, details: row.details };
      if (row.status === 'ok' && row.description) return { ...ad, content: row.description, contentStatus: 'ok' };
      empty ??= { ...ad, content: null, contentStatus: 'empty' };
      continue;
    }
    try {
      const scraped = await scrapeOfferFull(offer);
      const ok = scraped.status === 'ok';
      await detailsRepo.saveComplete({
        src: offer.src,
        id: offer.id,
        status: scraped.status,
        description: ok ? scraped.text : null,
        details: scraped.details,
      });
      const ad = { contentError: null, scrapedAt: new Date().toISOString(), details: scraped.details };
      if (ok) return { ...ad, content: scraped.text, contentStatus: 'ok' };
      empty ??= { ...ad, content: null, contentStatus: 'empty' };
    } catch (failure) {
      error = message(failure); // not saved: the next opening tries again
    }
  }
  const short = offers
    .map((offer) => saved.get(`${offer.src}\u0001${offer.id}`))
    .find((row) => row?.status === 'ok' && row.description);
  if (short?.description)
    return {
      content: short.description,
      contentStatus: 'ok',
      contentError: null,
      scrapedAt: short.fetchedAt,
      details: null,
    };
  return empty
    ? { ...empty, contentError: NO_TEXT }
    : { content: null, contentStatus: 'failed', contentError: error, scrapedAt: null, details: null };
}

/** What the window shows besides what the list has; null if the job is gone. */
export async function getOfferWindow(jobId: string): Promise<OfferWindow | null> {
  const job = await offersRepo.jobById(jobId);
  if (!job) return null;
  const [ad, fit, note] = await Promise.all([
    adOf(job.offers),
    fitOf(jobId).catch(() => null),
    jobNotesRepo.get(jobId),
  ]);
  return { ...ad, fit, note: note?.note ?? null, noteUpdatedAt: note?.noteUpdatedAt ?? null };
}

/**
 * Saves your note on the job ('' clears it), if nobody else changed it since you read it: `seenAt` is
 * the note_updated_at you saw. Answers with the new one, for the next save.
 */
export async function setJobNote(jobId: string, note: string, seenAt: string | null) {
  const text = note.trim() ? note.slice(0, NOTE_MAX) : null;
  const savedAt = await jobNotesRepo.setIfUnchanged(jobId, text, seenAt);
  if (savedAt) return { noteUpdatedAt: savedAt };
  throw new Error(NOTE_CONFLICT);
}

/**
 * Asks the AI how well the job fits the active profile, from its ad as the window has it (the title
 * alone without one). The verdict is kept like a run's, so the list has it too.
 */
export async function assessJobFit(jobId: string): Promise<Fit> {
  const [job, profiles] = await Promise.all([offersRepo.jobById(jobId), listProfiles()]);
  if (!job) throw new Error('That offer is no longer in the database.');
  const active = profiles.at(0);
  if (!isUsable(active)) throw new Error('No AI profile to check it with: set one up in Settings → AI filter.');
  const [profile, ad] = await Promise.all([getProfile(active.id), adOf(job.offers)]);
  if (!profile) throw new Error('That AI profile no longer exists.');
  const mode = workModeOf(ad.details);
  const fit = await assessOne(profile, jobId, {
    title: job.title,
    company: job.company,
    seniority: job.seniority,
    remote: mode ? mode === 'remote' : job.remote,
    description: ad.contentStatus === 'ok' && ad.content ? adForAi(ad.content) : null,
  });
  if (!fit) throw new Error('The AI gave no answer: try again.');
  return fit;
}
