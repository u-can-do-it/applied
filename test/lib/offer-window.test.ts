import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as detailsRepo from '@/lib/db/repos/offer-details';
import * as jobNotesRepo from '@/lib/db/repos/job-notes';
import * as offersRepo from '@/lib/db/repos/offers';
import { scrapeOfferFull } from '@/lib/ads';
import { fitOf, getProfile, listProfiles } from '@/lib/ai/profiles';
import { assessOne } from '@/lib/ai/runs';
import { assessJobFit, getOfferWindow, setJobNote } from '@/lib/offer-window';
import { NOTE_CONFLICT } from '@/lib/shared/application-messages';

// An offer's window: its ad (saved complete, else fetched now and saved), your note, the fit check.

vi.mock('@/lib/db/repos/offer-details', () => ({ forOffers: vi.fn(), saveComplete: vi.fn() }));
vi.mock('@/lib/db/repos/job-notes', () => ({ get: vi.fn(), setIfUnchanged: vi.fn() }));
vi.mock('@/lib/db/repos/offers', () => ({ jobById: vi.fn() }));
vi.mock('@/lib/ads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ads')>()),
  scrapeOfferFull: vi.fn(),
}));
vi.mock('@/lib/ai/profiles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/profiles')>()),
  fitOf: vi.fn(),
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock('@/lib/ai/runs', () => ({ assessOne: vi.fn() }));

const forOffers = vi.mocked(detailsRepo.forOffers);
const saveComplete = vi.mocked(detailsRepo.saveComplete);
const scrape = vi.mocked(scrapeOfferFull);

const JOB = 'rossmannsdp|lidertechnologiczny';
const JUSTJOIN = { src: 'justjoin', id: 'jj-1', url: 'https://justjoin.it/job-offer/jj-1' };
const ELDORADO = { src: 'eldorado', id: '455630', url: 'https://czyjesteldorado.pl/praca/455630' };
const job = {
  src: 'justjoin',
  id: 'jj-1',
  title: 'Lider Technologiczny',
  company: 'Rossmann SDP',
  seniority: 'lead',
  remote: false,
  url: JUSTJOIN.url,
  firstSeen: '2026-10-10T09:00:00.000Z',
  jobId: JOB,
  offers: [JUSTJOIN, ELDORADO],
  appliedAt: null,
};
const AT = '2026-10-09T08:00:00.000Z';
const saved = (offer: { src: string; id: string }, fields: Partial<detailsRepo.CompleteDetails>) => ({
  src: offer.src,
  id: offer.id,
  status: 'ok' as const,
  description: 'the ad',
  details: null,
  complete: true,
  fetchedAt: AT,
  ...fields,
});
const fit = { match: true, score: 30, summary: 'ERP', checks: [], hadDescription: true, bodyLeasing: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(offersRepo.jobById).mockResolvedValue(job);
  vi.mocked(fitOf).mockResolvedValue(fit);
  vi.mocked(jobNotesRepo.get).mockResolvedValue({ note: 'Ask about .NET', noteUpdatedAt: AT });
  forOffers.mockResolvedValue([]);
});

describe('the ad in an offer window', () => {
  it('saved complete before: as it was, nothing fetched', async () => {
    forOffers.mockResolvedValue([saved(JUSTJOIN, { details: { salary: '30 000 PLN' } })]);
    expect(await getOfferWindow(JOB)).toEqual({
      content: 'the ad',
      contentStatus: 'ok',
      contentError: null,
      scrapedAt: AT,
      details: { salary: '30 000 PLN' },
      fit,
      note: 'Ask about .NET',
      noteUpdatedAt: AT,
    });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('else fetched now, complete, and saved: an offer that fails gives way to the next', async () => {
    scrape.mockRejectedValueOnce(new Error('HTTP 503'));
    scrape.mockResolvedValueOnce({ status: 'ok', text: 'the whole ad', details: { contract: 'B2B' } });
    const shown = await getOfferWindow(JOB);
    expect(shown).toMatchObject({ content: 'the whole ad', contentStatus: 'ok', details: { contract: 'B2B' } });
    expect(scrape.mock.calls.map(([offer]) => offer.src)).toEqual(['justjoin', 'eldorado']);
    expect(saveComplete).toHaveBeenCalledExactlyOnceWith({
      src: 'eldorado',
      id: '455630',
      status: 'ok',
      description: 'the whole ad',
      details: { contract: 'B2B' },
    });
  });

  it('a board page without text is saved as such, and the next offer is asked', async () => {
    forOffers.mockResolvedValue([saved(JUSTJOIN, { status: 'empty', description: null })]);
    scrape.mockResolvedValueOnce({ status: 'ok', text: 'from Eldorado', details: {} });
    expect(await getOfferWindow(JOB)).toMatchObject({ content: 'from Eldorado', contentStatus: 'ok' });
    expect(scrape).toHaveBeenCalledOnce(); // JustJoin's is known to be empty
  });

  it("fetching fails: an AI run's shorter copy, rather than nothing", async () => {
    forOffers.mockResolvedValue([saved(ELDORADO, { complete: false, description: 'the first 8000 characters' })]);
    scrape.mockRejectedValue(new Error('HTTP 403'));
    expect(await getOfferWindow(JOB)).toMatchObject({
      content: 'the first 8000 characters',
      contentStatus: 'ok',
      details: null,
    });
  });

  it('nothing at all: why, and nothing saved (the next opening tries again)', async () => {
    scrape.mockRejectedValue(new Error('HTTP 403'));
    expect(await getOfferWindow(JOB)).toMatchObject({
      content: null,
      contentStatus: 'failed',
      contentError: 'HTTP 403',
    });
    expect(saveComplete).not.toHaveBeenCalled();
  });

  it('a job no longer in the database: none', async () => {
    vi.mocked(offersRepo.jobById).mockResolvedValue(null);
    expect(await getOfferWindow(JOB)).toBeNull();
  });
});

describe('the note on a job', () => {
  it('saved over the version you saw; empty clears it', async () => {
    vi.mocked(jobNotesRepo.setIfUnchanged).mockResolvedValue('2026-10-10T10:00:00.000Z');
    expect(await setJobNote(JOB, '  ', AT)).toEqual({ noteUpdatedAt: '2026-10-10T10:00:00.000Z' });
    expect(jobNotesRepo.setIfUnchanged).toHaveBeenCalledWith(JOB, null, AT);
  });

  it('changed elsewhere since: not overwritten', async () => {
    vi.mocked(jobNotesRepo.setIfUnchanged).mockResolvedValue(null);
    await expect(setJobNote(JOB, 'mine', null)).rejects.toThrow(NOTE_CONFLICT);
  });
});

describe('the fit check from the window', () => {
  const profile = { id: 'p1', name: 'Default', prompt: 'React', fileName: null, version: 3 };

  it('judges the ad as the AI reads it (cut to an AI run’s length)', async () => {
    vi.mocked(listProfiles).mockResolvedValue([profile] as never);
    vi.mocked(getProfile).mockResolvedValue({ ...profile, fileText: null } as never);
    vi.mocked(assessOne).mockResolvedValue(fit);
    forOffers.mockResolvedValue([saved(JUSTJOIN, { description: 'x'.repeat(20_000) })]);
    expect(await assessJobFit(JOB)).toEqual(fit);
    const offer = vi.mocked(assessOne).mock.lastCall?.[2];
    expect(offer).toMatchObject({ title: 'Lider Technologiczny', company: 'Rossmann SDP', remote: false });
    expect(offer?.description).toHaveLength(8000);
  });

  it('no profile to judge it with: says where to set one up', async () => {
    vi.mocked(listProfiles).mockResolvedValue([]);
    await expect(assessJobFit(JOB)).rejects.toThrow('Settings → AI filter');
  });
});
